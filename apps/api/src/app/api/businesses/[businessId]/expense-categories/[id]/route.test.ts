import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Integration-style tests for expense-categories/[id] routes (PATCH, DELETE).
 * Mocks db and auth at module level so no real SQLite is needed.
 */

// --- nanoid mock ---
const CATEGORY_ID = 'cat-test-001-nanoid'
vi.mock('nanoid', () => ({ nanoid: vi.fn(() => CATEGORY_ID) }))

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

// Rows returned from select queries. Tests override these per-scenario.
let selectRows: unknown[] = []

const dbMock = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}

// Default chain implementations.
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
      orderBy: vi.fn().mockReturnValue(Promise.resolve(selectRows)),
      get: vi.fn().mockResolvedValue(selectRows[0] ?? null),
    }),
  })

  // insert chain: .values() -> resolves
  dbMock.insert.mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined),
  })

  // update chain: .set().where() -> resolves
  dbMock.update.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  })

  // delete chain: .where() -> resolves
  dbMock.delete.mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  })
}

vi.mock('@/db', () => ({
  db: dbMock,
  expenseCategories: {
    id: 'expense_categories.id',
    businessId: 'expense_categories.business_id',
    name: 'expense_categories.name',
    sortOrder: 'expense_categories.sort_order',
    createdAt: 'expense_categories.created_at',
  },
  expenses: {
    id: 'expenses.id',
    businessId: 'expenses.business_id',
    categoryId: 'expenses.category_id',
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
const BUSINESS_ID = 'biz-cat-test-01'
const USER_ID = 'user-cat-test-01'

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
  const url = new URL(`http://localhost:8000/api/businesses/${BUSINESS_ID}/expense-categories`)
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

const ID_PARAMS = { params: Promise.resolve({ businessId: BUSINESS_ID, id: CATEGORY_ID }) }

beforeEach(() => {
  publishToBusiness.mockReset().mockResolvedValue(undefined)
  requireBusinessAccess.mockReset().mockResolvedValue(ACCESS)
  selectRows = []
  resetDbMock()
})

// ===========================================================================
// PATCH /expense-categories/:id
// ===========================================================================

describe('PATCH /expense-categories/:id', () => {
  const EXISTING_CAT = {
    id: CATEGORY_ID,
    businessId: BUSINESS_ID,
    name: 'Old Name',
    sortOrder: 0,
    createdAt: 1000,
  }

  it('renames a category and returns updated row', async () => {
    const updated = { ...EXISTING_CAT, name: 'New Name' }
    // First select resolves to existing row; second (re-fetch after update) resolves to updated.
    let callCount = 0
    dbMock.select.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue(
          Object.assign(
            Promise.resolve(callCount++ === 0 ? [EXISTING_CAT] : [updated]),
            {
              orderBy: vi.fn().mockReturnValue(Promise.resolve([EXISTING_CAT])),
              limit: vi.fn().mockReturnValue(Promise.resolve([EXISTING_CAT])),
              get: vi.fn().mockResolvedValue(EXISTING_CAT),
            },
          ),
        ),
      }),
    }))

    const { PATCH } = await import('./route')
    const res = await PATCH(
      makeRequest('PATCH', { name: 'New Name' }) as Parameters<typeof PATCH>[0],
      ID_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.messageCode).toBe('EXPENSE_CATEGORY_UPDATED')
    expect(body.data.name).toBe('New Name')
  })

  it('returns 404 when category not in business', async () => {
    // select returns empty (category not found)
    selectRows = []
    resetDbMock()

    const { PATCH } = await import('./route')
    const res = await PATCH(
      makeRequest('PATCH', { name: 'X' }) as Parameters<typeof PATCH>[0],
      ID_PARAMS,
    )
    expect(res.status).toBe(404)
  })

  it('returns 403 when caller is not a manager', async () => {
    requireBusinessAccess.mockResolvedValue({ ...ACCESS, role: 'employee' as const })

    const { PATCH } = await import('./route')
    const res = await PATCH(
      makeRequest('PATCH', { name: 'X' }) as Parameters<typeof PATCH>[0],
      ID_PARAMS,
    )
    expect(res.status).toBe(403)
  })

  it('publishes expense_category.updated event', async () => {
    const updated = { ...EXISTING_CAT, name: 'Renamed' }
    let callCount2 = 0
    dbMock.select.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue(
          Object.assign(
            Promise.resolve(callCount2++ === 0 ? [EXISTING_CAT] : [updated]),
            {
              orderBy: vi.fn().mockReturnValue(Promise.resolve([EXISTING_CAT])),
              limit: vi.fn().mockReturnValue(Promise.resolve([EXISTING_CAT])),
              get: vi.fn().mockResolvedValue(EXISTING_CAT),
            },
          ),
        ),
      }),
    }))

    const { PATCH } = await import('./route')
    await PATCH(
      makeRequest('PATCH', { name: 'Renamed' }) as Parameters<typeof PATCH>[0],
      ID_PARAMS,
    )

    await new Promise((r) => setTimeout(r, 0))
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'expense_category.updated', categoryId: CATEGORY_ID }),
      undefined,
    )
  })
})

// ===========================================================================
// DELETE /expense-categories/:id
// ===========================================================================

describe('DELETE /expense-categories/:id', () => {
  it('deletes category when no expenses reference it', async () => {
    // First select: category found. Second select: no referencing expenses.
    let callCount = 0
    dbMock.select.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue(
          Object.assign(
            Promise.resolve(callCount++ === 0 ? [{ id: CATEGORY_ID }] : []),
            {
              limit: vi.fn().mockReturnValue(
                Promise.resolve(callCount <= 1 ? [{ id: CATEGORY_ID }] : []),
              ),
              orderBy: vi.fn().mockReturnValue(Promise.resolve([])),
              get: vi.fn().mockResolvedValue(null),
            },
          ),
        ),
      }),
    }))

    const { DELETE } = await import('./route')
    const res = await DELETE(
      makeRequest('DELETE') as Parameters<typeof DELETE>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID, id: CATEGORY_ID }) },
    )
    expect(res.status).toBe(200)
    expect(dbMock.delete).toHaveBeenCalled()
  })

  it('blocks deletion with 409 when expenses reference the category', async () => {
    let callCount = 0
    dbMock.select.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue(
          Object.assign(
            // First: category found; Second: expense in use found
            Promise.resolve(callCount++ === 0 ? [{ id: CATEGORY_ID }] : [{ id: 'expense-1' }]),
            {
              limit: vi.fn().mockReturnValue(
                Promise.resolve(callCount <= 1 ? [{ id: CATEGORY_ID }] : [{ id: 'expense-1' }]),
              ),
              orderBy: vi.fn().mockReturnValue(Promise.resolve([])),
              get: vi.fn().mockResolvedValue(null),
            },
          ),
        ),
      }),
    }))

    const { DELETE } = await import('./route')
    const res = await DELETE(
      makeRequest('DELETE') as Parameters<typeof DELETE>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID, id: CATEGORY_ID }) },
    )
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.messageCode).toBe('EXPENSE_CATEGORY_IN_USE')
  })

  it('returns 404 when category not in business', async () => {
    selectRows = []
    resetDbMock()

    const { DELETE } = await import('./route')
    const res = await DELETE(
      makeRequest('DELETE') as Parameters<typeof DELETE>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID, id: CATEGORY_ID }) },
    )
    expect(res.status).toBe(404)
  })

  it('publishes expense_category.deleted event', async () => {
    let callCount2 = 0
    dbMock.select.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue(
          Object.assign(
            Promise.resolve(callCount2++ === 0 ? [{ id: CATEGORY_ID }] : []),
            {
              limit: vi.fn().mockReturnValue(
                Promise.resolve(callCount2 <= 1 ? [{ id: CATEGORY_ID }] : []),
              ),
              orderBy: vi.fn().mockReturnValue(Promise.resolve([])),
              get: vi.fn().mockResolvedValue(null),
            },
          ),
        ),
      }),
    }))

    const { DELETE } = await import('./route')
    await DELETE(
      makeRequest('DELETE') as Parameters<typeof DELETE>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID, id: CATEGORY_ID }) },
    )

    await new Promise((r) => setTimeout(r, 0))
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'expense_category.deleted', categoryId: CATEGORY_ID }),
      undefined,
    )
  })
})
