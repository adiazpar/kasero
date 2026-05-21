import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Integration-style tests for expenses routes (POST + GET list).
 * Mocks db and auth at module level so no real SQLite is needed.
 */

// --- nanoid mock ---
const EXPENSE_ID = 'exp-test-001-nanoid'
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
let updateReturning: unknown[] = [{ reserved: 1 }]

const dbMock = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  transaction: vi.fn(),
}

function resetDbMock() {
  dbMock.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue(
        Object.assign(Promise.resolve(selectRows), {
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue(Promise.resolve(selectRows)),
          }),
          limit: vi.fn().mockReturnValue(Promise.resolve(selectRows)),
          get: vi.fn().mockResolvedValue(selectRows[0] ?? null),
        }),
      ),
      orderBy: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue(Promise.resolve(selectRows)),
      }),
      get: vi.fn().mockResolvedValue(selectRows[0] ?? null),
    }),
  })

  dbMock.insert.mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined),
  })

  dbMock.update.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(updateReturning),
      }),
    }),
  })

  dbMock.delete.mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  })

  // transaction: pass a real-ish tx object that mirrors dbMock
  dbMock.transaction.mockImplementation(async (fn: (tx: typeof dbMock) => Promise<unknown>) => {
    return fn(dbMock)
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
  businesses: {
    id: 'businesses.id',
    nextExpenseNumber: 'businesses.next_expense_number',
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
const BUSINESS_ID = 'biz-exp-test-01'
const USER_ID = 'user-exp-test-01'

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
  searchParams?: Record<string, string>,
): Request {
  const url = new URL(`http://localhost:8000/api/businesses/${BUSINESS_ID}/expenses`)
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
  }
  const json = body !== undefined ? JSON.stringify(body) : undefined
  return new Request(url.toString(), {
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

const ROUTE_PARAMS = { params: Promise.resolve({ businessId: BUSINESS_ID }) }

const NOW = new Date()
const CREATED_ROW = {
  id: EXPENSE_ID,
  businessId: BUSINESS_ID,
  createdByUserId: USER_ID,
  expenseNumber: 1,
  date: NOW,
  amount: 49.99,
  categoryId: null,
  note: 'gas',
  photoUrl: null,
  createdAt: Math.floor(Date.now() / 1000),
  updatedAt: Math.floor(Date.now() / 1000),
}

beforeEach(() => {
  publishToBusiness.mockReset().mockResolvedValue(undefined)
  requireBusinessAccess.mockReset().mockResolvedValue(ACCESS)
  selectRows = []
  updateReturning = [{ reserved: 1 }]
  resetDbMock()
})

// ===========================================================================
// POST /expenses
// ===========================================================================

describe('POST /expenses', () => {
  it('creates an expense with required fields', async () => {
    selectRows = [CREATED_ROW]
    resetDbMock()

    const { POST } = await import('../route')
    const res = await POST(
      makeRequest('POST', { amount: 49.99, note: 'gas' }) as Parameters<typeof POST>[0],
      ROUTE_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.messageCode).toBe('EXPENSE_CREATED')
    expect(body.data.amount).toBeCloseTo(49.99)
    expect(body.data.expenseNumber).toBe(1)
  })

  it('assigns sequential expense numbers per business', async () => {
    const row2 = { ...CREATED_ROW, expenseNumber: 2, amount: 2 }
    updateReturning = [{ reserved: 2 }]
    selectRows = [row2]
    resetDbMock()

    const { POST } = await import('../route')
    const res = await POST(
      makeRequest('POST', { amount: 2 }) as Parameters<typeof POST>[0],
      ROUTE_PARAMS,
    )
    const body = await res.json()

    expect(body.data.expenseNumber).toBe(2)
  })

  it('rejects negative or zero amounts with 400', async () => {
    const { POST } = await import('../route')
    const res = await POST(
      makeRequest('POST', { amount: -1 }) as Parameters<typeof POST>[0],
      ROUTE_PARAMS,
    )
    expect(res.status).toBe(400)
  })

  it('rejects future date beyond 1 minute', async () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString()

    const { POST } = await import('../route')
    const res = await POST(
      makeRequest('POST', { amount: 1, date: future }) as Parameters<typeof POST>[0],
      ROUTE_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.messageCode).toBe('EXPENSE_INVALID_DATE')
  })

  it('blocks non-manager roles with 403', async () => {
    requireBusinessAccess.mockResolvedValue({ ...ACCESS, role: 'employee' as const })

    const { POST } = await import('../route')
    const res = await POST(
      makeRequest('POST', { amount: 5 }) as Parameters<typeof POST>[0],
      ROUTE_PARAMS,
    )
    expect(res.status).toBe(403)
  })

  it('publishes expense.created event', async () => {
    selectRows = [CREATED_ROW]
    resetDbMock()

    const { POST } = await import('../route')
    await POST(
      makeRequest('POST', { amount: 49.99 }) as Parameters<typeof POST>[0],
      ROUTE_PARAMS,
    )

    await new Promise((r) => setTimeout(r, 0))
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'expense.created', expenseId: EXPENSE_ID }),
      undefined,
    )
  })
})

// ===========================================================================
// GET /expenses
// ===========================================================================

describe('GET /expenses', () => {
  it('lists newest-first, paginated (200)', async () => {
    selectRows = [
      { ...CREATED_ROW, expenseNumber: 3, amount: 3 },
      { ...CREATED_ROW, expenseNumber: 2, amount: 2 },
      { ...CREATED_ROW, expenseNumber: 1, amount: 1 },
    ]
    resetDbMock()

    const { GET } = await import('../route')
    const res = await GET(
      makeRequest('GET', undefined, { limit: '50' }) as Parameters<typeof GET>[0],
      ROUTE_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.length).toBe(3)
    expect(body.data[0].expenseNumber).toBe(3)
  })

  it('returns empty array when no expenses exist', async () => {
    selectRows = []
    resetDbMock()

    const { GET } = await import('../route')
    const res = await GET(
      makeRequest('GET') as Parameters<typeof GET>[0],
      ROUTE_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual([])
  })
})
