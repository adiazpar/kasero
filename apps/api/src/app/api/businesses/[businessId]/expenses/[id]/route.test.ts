import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Integration-style tests for expenses/[id] routes (GET, PATCH, DELETE).
 * Mocks db and auth at module level so no real SQLite is needed.
 */

// --- nanoid mock ---
const EXPENSE_ID = 'exp-id-test-001'
vi.mock('nanoid', () => ({ nanoid: vi.fn(() => EXPENSE_ID) }))

// --- realtime mock ---
const publishToBusiness = vi.fn()
vi.mock('@/lib/realtime', async (orig) => {
  const real = await orig<typeof import('@/lib/realtime')>()
  return { ...real, publishToBusiness }
})

// --- auth mock ---
const requireBusinessAccess = vi.fn()
vi.mock('@/lib/business-auth', async (orig) => {
  const real = await orig<typeof import('@/lib/business-auth')>()
  return { ...real, requireBusinessAccess }
})

// --- db mock ---

let selectRows: unknown[] = []

const dbMock = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}

function resetDbMock() {
  dbMock.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue(
        Object.assign(Promise.resolve(selectRows), {
          orderBy: vi.fn().mockReturnValue(Promise.resolve(selectRows)),
          limit: vi.fn().mockReturnValue(Promise.resolve(selectRows)),
          get: vi.fn().mockResolvedValue(selectRows[0] ?? null),
        }),
      ),
      get: vi.fn().mockResolvedValue(selectRows[0] ?? null),
    }),
  })

  dbMock.insert.mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined),
  })

  dbMock.update.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  })

  dbMock.delete.mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  })
}

vi.mock('@/db', () => ({
  db: dbMock,
  expenses: {
    id: 'expenses.id',
    businessId: 'expenses.business_id',
    createdByUserId: 'expenses.created_by_user_id',
    expenseNumber: 'expenses.expense_number',
    date: 'expenses.date',
    amount: 'expenses.amount',
    categoryId: 'expenses.category_id',
    note: 'expenses.note',
    photoUrl: 'expenses.photo_url',
    createdAt: 'expenses.created_at',
    updatedAt: 'expenses.updated_at',
  },
}))

vi.mock('@/lib/api-middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-middleware')>('@/lib/api-middleware')
  return {
    ...actual,
    enforceMaxContentLength: vi.fn(() => null),
    applyRateLimit: vi.fn(async () => null),
  }
})

// --- Constants ---
const BUSINESS_ID = 'biz-expid-test-01'
const USER_ID = 'user-expid-test-01'

const ACCESS = {
  userId: USER_ID,
  businessId: BUSINESS_ID,
  businessName: 'Test Biz',
  businessIcon: null,
  businessLocale: 'en-US',
  businessCurrency: 'USD',
  role: 'owner' as const,
}

function makeRequest(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Request {
  const url = `http://localhost:8000/api/businesses/${BUSINESS_ID}/expenses/${EXPENSE_ID}`
  const json = body !== undefined ? JSON.stringify(body) : undefined
  return new Request(url, {
    method,
    headers: {
      'content-type': 'application/json',
      'content-length': json ? String(json.length) : '0',
      origin: 'http://localhost:8000',
      host: 'localhost:8000',
    },
    body: json,
  })
}

const ID_PARAMS = { params: Promise.resolve({ businessId: BUSINESS_ID, id: EXPENSE_ID }) }

const NOW = new Date()
const EXISTING_ROW = {
  id: EXPENSE_ID,
  businessId: BUSINESS_ID,
  createdByUserId: USER_ID,
  expenseNumber: 1,
  date: NOW,
  amount: 5,
  categoryId: null,
  note: null,
  photoUrl: null,
  createdAt: Math.floor(Date.now() / 1000),
  updatedAt: Math.floor(Date.now() / 1000),
}

beforeEach(() => {
  publishToBusiness.mockReset().mockResolvedValue(undefined)
  requireBusinessAccess.mockReset().mockResolvedValue(ACCESS)
  selectRows = []
  resetDbMock()
})

// ===========================================================================
// GET /expenses/:id
// ===========================================================================

describe('GET /expenses/:id', () => {
  it('returns the expense (200)', async () => {
    selectRows = [EXISTING_ROW]
    resetDbMock()

    const { GET } = await import('./route')
    const res = await GET(
      makeRequest('GET') as Parameters<typeof GET>[0],
      ID_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.id).toBe(EXPENSE_ID)
  })

  it('returns 404 when not in business', async () => {
    selectRows = []
    resetDbMock()

    const { GET } = await import('./route')
    const res = await GET(
      makeRequest('GET') as Parameters<typeof GET>[0],
      ID_PARAMS,
    )
    expect(res.status).toBe(404)
  })
})

// ===========================================================================
// PATCH /expenses/:id
// ===========================================================================

describe('PATCH /expenses/:id', () => {
  it('updates fields and returns updated row', async () => {
    const updatedRow = { ...EXISTING_ROW, amount: 7, note: 'updated' }
    let callCount = 0
    dbMock.select.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue(
          Object.assign(
            Promise.resolve(callCount++ === 0 ? [EXISTING_ROW] : [updatedRow]),
            {
              orderBy: vi.fn().mockReturnValue(Promise.resolve([EXISTING_ROW])),
              limit: vi.fn().mockReturnValue(Promise.resolve([EXISTING_ROW])),
              get: vi.fn().mockResolvedValue(EXISTING_ROW),
            },
          ),
        ),
      }),
    }))

    const { PATCH } = await import('./route')
    const res = await PATCH(
      makeRequest('PATCH', { amount: 7, note: 'updated' }) as Parameters<typeof PATCH>[0],
      ID_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.messageCode).toBe('EXPENSE_UPDATED')
    expect(body.data.amount).toBe(7)
    expect(body.data.note).toBe('updated')
  })

  it('returns 404 when not in business', async () => {
    selectRows = []
    resetDbMock()

    const { PATCH } = await import('./route')
    const res = await PATCH(
      makeRequest('PATCH', { amount: 9 }) as Parameters<typeof PATCH>[0],
      ID_PARAMS,
    )
    expect(res.status).toBe(404)
  })

  it('returns 403 when caller is not a manager', async () => {
    requireBusinessAccess.mockResolvedValue({ ...ACCESS, role: 'employee' as const })

    const { PATCH } = await import('./route')
    const res = await PATCH(
      makeRequest('PATCH', { amount: 9 }) as Parameters<typeof PATCH>[0],
      ID_PARAMS,
    )
    expect(res.status).toBe(403)
  })

  it('rejects future date beyond 1 minute with 400', async () => {
    selectRows = [EXISTING_ROW]
    resetDbMock()

    const future = new Date(Date.now() + 10 * 60_000).toISOString()

    const { PATCH } = await import('./route')
    const res = await PATCH(
      makeRequest('PATCH', { date: future }) as Parameters<typeof PATCH>[0],
      ID_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.messageCode).toBe('EXPENSE_INVALID_DATE')
  })

  it('publishes expense.updated event', async () => {
    const updatedRow = { ...EXISTING_ROW, amount: 7 }
    let callCount2 = 0
    dbMock.select.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue(
          Object.assign(
            Promise.resolve(callCount2++ === 0 ? [EXISTING_ROW] : [updatedRow]),
            {
              orderBy: vi.fn().mockReturnValue(Promise.resolve([EXISTING_ROW])),
              limit: vi.fn().mockReturnValue(Promise.resolve([EXISTING_ROW])),
              get: vi.fn().mockResolvedValue(EXISTING_ROW),
            },
          ),
        ),
      }),
    }))

    const { PATCH } = await import('./route')
    await PATCH(
      makeRequest('PATCH', { amount: 7 }) as Parameters<typeof PATCH>[0],
      ID_PARAMS,
    )

    await new Promise((r) => setTimeout(r, 0))
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'expense.updated', expenseId: EXPENSE_ID }),
      undefined,
    )
  })
})

// ===========================================================================
// DELETE /expenses/:id
// ===========================================================================

describe('DELETE /expenses/:id', () => {
  it('deletes the expense (200)', async () => {
    selectRows = [{ id: EXPENSE_ID }]
    resetDbMock()

    const { DELETE } = await import('./route')
    const res = await DELETE(
      makeRequest('DELETE') as Parameters<typeof DELETE>[0],
      ID_PARAMS,
    )
    expect(res.status).toBe(200)
    expect(dbMock.delete).toHaveBeenCalled()
  })

  it('returns 404 when not in business', async () => {
    selectRows = []
    resetDbMock()

    const { DELETE } = await import('./route')
    const res = await DELETE(
      makeRequest('DELETE') as Parameters<typeof DELETE>[0],
      ID_PARAMS,
    )
    expect(res.status).toBe(404)
  })

  it('returns 403 when caller is not a manager', async () => {
    requireBusinessAccess.mockResolvedValue({ ...ACCESS, role: 'employee' as const })

    const { DELETE } = await import('./route')
    const res = await DELETE(
      makeRequest('DELETE') as Parameters<typeof DELETE>[0],
      ID_PARAMS,
    )
    expect(res.status).toBe(403)
  })

  it('publishes expense.deleted event', async () => {
    selectRows = [{ id: EXPENSE_ID }]
    resetDbMock()

    const { DELETE } = await import('./route')
    await DELETE(
      makeRequest('DELETE') as Parameters<typeof DELETE>[0],
      ID_PARAMS,
    )

    await new Promise((r) => setTimeout(r, 0))
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'expense.deleted', expenseId: EXPENSE_ID }),
      undefined,
    )
  })
})
