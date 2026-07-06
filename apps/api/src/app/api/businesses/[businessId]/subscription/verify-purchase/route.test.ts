import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Tests for POST /subscription/verify-purchase (store-receipt Pro
 * grants). The billing adapters are unconfigured in every environment
 * until the owner wires store credentials, so the route's contract today
 * is: owner-only, validated body, 503 SUBSCRIPTION_NOT_CONFIGURED.
 */

// --- realtime mock ---
const publishToBusiness = vi.fn()
vi.mock('@/lib/realtime', async (orig) => {
  const real = await orig<typeof import('@/lib/realtime')>()
  return { ...real, publishToBusiness }
})

// --- auth mock ---
const requireBusinessAccess = vi.fn()
const invalidateAccessCacheForBusiness = vi.fn()
vi.mock('@/lib/business-auth', async (orig) => {
  const real = await orig<typeof import('@/lib/business-auth')>()
  return { ...real, requireBusinessAccess, invalidateAccessCacheForBusiness }
})

vi.mock('@/lib/api-middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-middleware')>(
    '@/lib/api-middleware',
  )
  return {
    ...actual,
    enforceMaxContentLength: vi.fn(() => null),
    applyRateLimit: vi.fn(async () => null),
  }
})

// --- db mock ---
const updateSet = vi.fn()
const dbMock = { update: vi.fn() }

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
const BUSINESS_ID = 'biz-verify-test-01'
const USER_ID = 'user-verify-test1'

const OWNER_ACCESS = {
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
  role: 'owner' as const,
}

function makeRequest(body: unknown): Request {
  const json = JSON.stringify(body)
  return new Request(
    `http://localhost:8000/api/businesses/${BUSINESS_ID}/subscription/verify-purchase`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(json.length),
        origin: 'http://localhost:8000',
        host: 'localhost:8000',
      },
      body: json,
    },
  )
}

const ROUTE_PARAMS = { params: Promise.resolve({ businessId: BUSINESS_ID }) }

beforeEach(() => {
  publishToBusiness.mockReset().mockResolvedValue(undefined)
  requireBusinessAccess.mockReset().mockResolvedValue(OWNER_ACCESS)
  invalidateAccessCacheForBusiness.mockReset()
  updateSet.mockReset().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
  dbMock.update.mockReset().mockReturnValue({ set: updateSet })
  // The adapter env vars are never set in the test environment; assert
  // that anyway so a leaked local env can't silently change the branch
  // under test.
  delete process.env.APPLE_IAP_KEY_ID
  delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON
})

describe('POST /subscription/verify-purchase', () => {
  it('returns 503 SUBSCRIPTION_NOT_CONFIGURED while the apple adapter is unwired', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ platform: 'apple', receipt: 'signed-transaction-jws' }) as Parameters<
        typeof POST
      >[0],
      ROUTE_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.messageCode).toBe('SUBSCRIPTION_NOT_CONFIGURED')
    // Never grant pro on the unconfigured path.
    expect(dbMock.update).not.toHaveBeenCalled()
    expect(publishToBusiness).not.toHaveBeenCalled()
  })

  it('returns 503 SUBSCRIPTION_NOT_CONFIGURED while the google adapter is unwired', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ platform: 'google', receipt: 'play-purchase-token' }) as Parameters<
        typeof POST
      >[0],
      ROUTE_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.messageCode).toBe('SUBSCRIPTION_NOT_CONFIGURED')
  })

  it('blocks non-owner roles with 403 SUBSCRIPTION_OWNER_ONLY', async () => {
    requireBusinessAccess.mockResolvedValue({
      ...OWNER_ACCESS,
      role: 'employee' as const,
    })

    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ platform: 'apple', receipt: 'x' }) as Parameters<typeof POST>[0],
      ROUTE_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.messageCode).toBe('SUBSCRIPTION_OWNER_ONLY')
  })

  it('rejects an unknown platform with a validation error', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ platform: 'amazon', receipt: 'x' }) as Parameters<typeof POST>[0],
      ROUTE_PARAMS,
    )
    expect(res.status).toBe(400)
    expect(dbMock.update).not.toHaveBeenCalled()
  })
})
