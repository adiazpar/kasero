import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Integration-style tests for expense-categories routes.
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
  // select chain: .from().where() is itself awaitable (returns array),
  // and also exposes .orderBy() / .limit() / .get() for chained queries.
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

const ROUTE_PARAMS = { params: Promise.resolve({ businessId: BUSINESS_ID }) }

beforeEach(() => {
  publishToBusiness.mockReset().mockResolvedValue(undefined)
  requireBusinessAccess.mockReset().mockResolvedValue(ACCESS)
  selectRows = []
  resetDbMock()
})

// ===========================================================================
// POST /expense-categories
// ===========================================================================

describe('POST /expense-categories', () => {
  it('creates a category with a trimmed name', async () => {
    const created = { id: CATEGORY_ID, businessId: BUSINESS_ID, name: 'Supplies', sortOrder: 0, createdAt: 1000 }
    // First select (re-fetch after insert) returns the created row.
    selectRows = [created]
    resetDbMock()

    const { POST } = await import('../route')
    const res = await POST(
      makeRequest('POST', { name: '  Supplies  ' }) as Parameters<typeof POST>[0],
      ROUTE_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.messageCode).toBe('EXPENSE_CATEGORY_CREATED')
    expect(body.data.name).toBe('Supplies')
  })

  it('rejects empty / whitespace-only name with 400', async () => {
    const { POST } = await import('../route')
    const res = await POST(
      makeRequest('POST', { name: '   ' }) as Parameters<typeof POST>[0],
      ROUTE_PARAMS,
    )
    expect(res.status).toBe(400)
  })

  it('publishes expense_category.created event', async () => {
    const created = { id: CATEGORY_ID, businessId: BUSINESS_ID, name: 'Fees', sortOrder: 0, createdAt: 1000 }
    selectRows = [created]
    resetDbMock()

    const { POST } = await import('../route')
    await POST(
      makeRequest('POST', { name: 'Fees' }) as Parameters<typeof POST>[0],
      ROUTE_PARAMS,
    )

    // Give void publish a tick to fire
    await new Promise((r) => setTimeout(r, 0))
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'expense_category.created', categoryId: CATEGORY_ID }),
      undefined,
    )
  })

  it('blocks non-manager roles with 403', async () => {
    requireBusinessAccess.mockResolvedValue({ ...ACCESS, role: 'employee' as const })

    const { POST } = await import('../route')
    const res = await POST(
      makeRequest('POST', { name: 'X' }) as Parameters<typeof POST>[0],
      ROUTE_PARAMS,
    )
    expect(res.status).toBe(403)
  })
})

// ===========================================================================
// GET /expense-categories
// ===========================================================================

describe('GET /expense-categories', () => {
  it('lists business categories (200)', async () => {
    selectRows = [
      { id: 'cat-1', businessId: BUSINESS_ID, name: 'Fees', sortOrder: 0, createdAt: 1000 },
      { id: 'cat-2', businessId: BUSINESS_ID, name: 'Supplies', sortOrder: 1, createdAt: 1001 },
    ]
    resetDbMock()

    const { GET } = await import('../route')
    const res = await GET(
      makeRequest('GET') as Parameters<typeof GET>[0],
      ROUTE_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.length).toBe(2)
  })

  it('returns empty array when no categories exist', async () => {
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

