import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Integration-style tests for GET /expenses/summary.
 * Mocks db and auth so no real SQLite is needed.
 */

// --- realtime mock ---
vi.mock('@/lib/realtime', async (orig) => {
  const real = await orig<typeof import('@/lib/realtime')>()
  return { ...real }
})

// --- auth mock ---
const requireBusinessAccess = vi.fn()
vi.mock('@/lib/business-auth', async (orig) => {
  const real = await orig<typeof import('@/lib/business-auth')>()
  return { ...real, requireBusinessAccess }
})

// --- db mock ---
// The summary route issues two sequential selects: first for sales, then for
// expenses. We track call order so we can return different values for each.
let selectCallIndex = 0
let salesTotal: string | null = null
let expensesTotal: string | null = null

const dbMock = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}

function resetDbMock() {
  selectCallIndex = 0
  dbMock.select.mockImplementation(() => {
    const callIndex = selectCallIndex++
    const total = callIndex === 0 ? salesTotal : expensesTotal
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue(Promise.resolve([{ total }])),
      }),
    }
  })
}

vi.mock('@/db', () => ({
  db: dbMock,
  sales: {
    businessId: 'sales.business_id',
    date: 'sales.date',
    total: 'sales.total',
  },
  expenses: {
    businessId: 'expenses.business_id',
    date: 'expenses.date',
    amount: 'expenses.amount',
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
const BUSINESS_ID = 'biz-summary-test-01'
const USER_ID = 'user-summary-test-01'

const ACCESS = {
  userId: USER_ID,
  businessId: BUSINESS_ID,
  businessName: 'Test Biz',
  businessIcon: null,
  businessLocale: 'en-US',
  businessCurrency: 'USD',
  role: 'owner' as const,
}

function makeRequest(searchParams?: Record<string, string>): Request {
  const url = new URL(`http://localhost:8000/api/businesses/${BUSINESS_ID}/expenses/summary`)
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
  }
  return new Request(url.toString(), {
    method: 'GET',
    headers: {
      origin: 'http://localhost:8000',
      host: 'localhost:8000',
    },
  })
}

const ROUTE_PARAMS = { params: Promise.resolve({ businessId: BUSINESS_ID }) }

beforeEach(() => {
  requireBusinessAccess.mockReset().mockResolvedValue(ACCESS)
  salesTotal = null
  expensesTotal = null
  resetDbMock()
})

// ===========================================================================
// GET /expenses/summary
// ===========================================================================

describe('GET /expenses/summary', () => {
  it('returns zeros for an empty business', async () => {
    salesTotal = null
    expensesTotal = null
    resetDbMock()

    const { GET } = await import('./route')
    const res = await GET(
      makeRequest() as Parameters<typeof GET>[0],
      ROUTE_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.totalIncome).toBe(0)
    expect(body.data.totalExpenses).toBe(0)
    expect(body.data.net).toBe(0)
    expect(body.data.month).toMatch(/^\d{4}-\d{2}$/)
  })

  it('sums sales and expenses correctly', async () => {
    salesTotal = '150'
    expensesTotal = '30'
    resetDbMock()

    const { GET } = await import('./route')
    const res = await GET(
      makeRequest() as Parameters<typeof GET>[0],
      ROUTE_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.totalIncome).toBeCloseTo(150)
    expect(body.data.totalExpenses).toBeCloseTo(30)
    expect(body.data.net).toBeCloseTo(120)
  })

  it('respects the ?month query param for historical lookback', async () => {
    salesTotal = '200'
    expensesTotal = '50'
    resetDbMock()

    const { GET } = await import('./route')
    const res = await GET(
      makeRequest({ month: '2025-01-15' }) as Parameters<typeof GET>[0],
      ROUTE_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.month).toBe('2025-01')
    expect(body.data.totalIncome).toBeCloseTo(200)
    expect(body.data.net).toBeCloseTo(150)
  })
})
