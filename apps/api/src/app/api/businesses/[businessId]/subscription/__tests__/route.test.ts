import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Tests for GET /subscription (current plan state). Mocks db and auth at
 * module level so no real SQLite is needed — same pattern as the
 * expenses route tests.
 */

// --- auth mock ---
const requireBusinessAccess = vi.fn()
vi.mock('@/lib/business-auth', async (orig) => {
  const real = await orig<typeof import('@/lib/business-auth')>()
  return { ...real, requireBusinessAccess }
})

// --- db mock ---
let selectRow: unknown = null

const dbMock = {
  select: vi.fn(),
}

function resetDbMock() {
  dbMock.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue(selectRow),
      }),
    }),
  })
}

vi.mock('@/db', () => ({
  db: dbMock,
  businesses: {
    id: 'businesses.id',
    plan: 'businesses.plan',
    planExpiresAt: 'businesses.plan_expires_at',
    planSource: 'businesses.plan_source',
  },
}))

// --- Constants ---
const BUSINESS_ID = 'biz-sub-test-0001'
const USER_ID = 'user-sub-test-01'

const ACCESS = {
  userId: USER_ID,
  businessId: BUSINESS_ID,
  businessName: 'Test Biz',
  businessIcon: null,
  businessLocale: 'en-US',
  businessCurrency: 'USD',
  businessTaxRate: 0,
  businessTaxMode: 'none' as const,
  plan: 'free' as const,
  planExpiresAt: null,
  role: 'employee' as const,
}

function makeRequest(): Request {
  return new Request(
    `http://localhost:8000/api/businesses/${BUSINESS_ID}/subscription`,
    {
      method: 'GET',
      headers: { host: 'localhost:8000' },
    },
  )
}

const ROUTE_PARAMS = { params: Promise.resolve({ businessId: BUSINESS_ID }) }

beforeEach(() => {
  requireBusinessAccess.mockReset().mockResolvedValue(ACCESS)
  selectRow = null
  resetDbMock()
})

describe('GET /subscription', () => {
  it('returns the free-tier state for any member (employee)', async () => {
    selectRow = { plan: 'free', planExpiresAt: null, planSource: 'none' }
    resetDbMock()

    const { GET } = await import('../route')
    const res = await GET(makeRequest() as Parameters<typeof GET>[0], ROUTE_PARAMS)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.plan).toBe('free')
    expect(body.expiresAt).toBeNull()
    expect(body.source).toBe('none')
  })

  it('returns the pro state with expiry and source', async () => {
    const expiry = new Date('2027-07-06T00:00:00Z')
    selectRow = { plan: 'pro', planExpiresAt: expiry, planSource: 'promo' }
    resetDbMock()

    const { GET } = await import('../route')
    const res = await GET(makeRequest() as Parameters<typeof GET>[0], ROUTE_PARAMS)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.plan).toBe('pro')
    expect(body.expiresAt).toBe(expiry.toISOString())
    expect(body.source).toBe('promo')
  })

  it('404s when the business row is gone', async () => {
    selectRow = null
    resetDbMock()

    const { GET } = await import('../route')
    const res = await GET(makeRequest() as Parameters<typeof GET>[0], ROUTE_PARAMS)
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.messageCode).toBe('BUSINESS_NOT_FOUND')
  })
})
