import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextResponse } from 'next/server'

/**
 * Tests for POST /subscription/redeem (promo-code Pro grants). Mocks db,
 * auth, realtime and the rate limiter at module level — same pattern as
 * the expenses route tests.
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

// --- rate-limit mock (middleware level) ---
// NOTE: withBusinessAuth also calls applyRateLimit (businessMutation,
// key `mutate:...`) before the handler runs. Tests that simulate an
// exhausted promo bucket must key the mock on the `promo:` prefix so
// the wrapper's own check still passes.
const applyRateLimit = vi.fn(
  async (_id: string, _config: unknown): Promise<NextResponse | null> => null,
)
vi.mock('@/lib/api-middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-middleware')>(
    '@/lib/api-middleware',
  )
  return {
    ...actual,
    enforceMaxContentLength: vi.fn(() => null),
    applyRateLimit,
  }
})

// --- db mock ---
let selectRow: unknown = null
const updateSet = vi.fn()

const dbMock = {
  select: vi.fn(),
  update: vi.fn(),
}

function resetDbMock() {
  dbMock.select.mockReset()
  dbMock.update.mockReset()
  updateSet.mockReset()
  dbMock.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue(selectRow),
      }),
    }),
  })
  updateSet.mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  })
  dbMock.update.mockReturnValue({ set: updateSet })
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
const BUSINESS_ID = 'biz-redeem-test-01'
const USER_ID = 'user-redeem-test1'

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
    `http://localhost:8000/api/businesses/${BUSINESS_ID}/subscription/redeem`,
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

const ORIGINAL_PROMO_ENV = process.env.PRO_PROMO_CODES

beforeEach(() => {
  publishToBusiness.mockReset().mockResolvedValue(undefined)
  requireBusinessAccess.mockReset().mockResolvedValue(OWNER_ACCESS)
  invalidateAccessCacheForBusiness.mockReset()
  applyRateLimit.mockReset().mockResolvedValue(null)
  selectRow = { plan: 'free', planExpiresAt: null }
  resetDbMock()
  process.env.PRO_PROMO_CODES = 'LAUNCHCREW:12,BETATHANKS:3'
})

afterEach(() => {
  if (ORIGINAL_PROMO_ENV === undefined) {
    delete process.env.PRO_PROMO_CODES
  } else {
    process.env.PRO_PROMO_CODES = ORIGINAL_PROMO_ENV
  }
})

describe('POST /subscription/redeem', () => {
  it('grants pro from a valid code (case-insensitive, trimmed) and publishes the plan change', async () => {
    const { POST } = await import('./route')
    const before = Date.now()
    const res = await POST(
      makeRequest({ code: '  launchcrew ' }) as Parameters<typeof POST>[0],
      ROUTE_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.messageCode).toBe('SUBSCRIPTION_REDEEM_SUCCESS')
    expect(body.plan).toBe('pro')

    // The persisted row flips to a promo-sourced pro grant ~12 calendar
    // months out.
    expect(updateSet).toHaveBeenCalledTimes(1)
    const setArg = updateSet.mock.calls[0][0] as {
      plan: string
      planSource: string
      planExpiresAt: Date
    }
    expect(setArg.plan).toBe('pro')
    expect(setArg.planSource).toBe('promo')
    const expectedMin = new Date(before)
    expectedMin.setUTCMonth(expectedMin.getUTCMonth() + 12)
    expect(setArg.planExpiresAt.getTime()).toBeGreaterThanOrEqual(
      expectedMin.getTime() - 5_000,
    )

    expect(invalidateAccessCacheForBusiness).toHaveBeenCalledWith(BUSINESS_ID)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'business.updated', fields: ['plan'] }),
      undefined,
    )
  })

  it('extends the expiry when the business is already pro', async () => {
    const currentExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    selectRow = { plan: 'pro', planExpiresAt: currentExpiry }
    resetDbMock()

    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ code: 'BETATHANKS' }) as Parameters<typeof POST>[0],
      ROUTE_PARAMS,
    )

    expect(res.status).toBe(200)
    const setArg = updateSet.mock.calls[0][0] as { planExpiresAt: Date }
    // 3 months are added on top of the CURRENT expiry, not on top of now.
    const expected = new Date(currentExpiry.getTime())
    expected.setUTCMonth(expected.getUTCMonth() + 3)
    expect(Math.abs(setArg.planExpiresAt.getTime() - expected.getTime())).toBeLessThan(
      4 * 24 * 60 * 60 * 1000, // day-clamp tolerance at month boundaries
    )
    expect(setArg.planExpiresAt.getTime()).toBeGreaterThan(currentExpiry.getTime())
  })

  it('never shortens a non-expiring pro grant', async () => {
    selectRow = { plan: 'pro', planExpiresAt: null }
    resetDbMock()

    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ code: 'BETATHANKS' }) as Parameters<typeof POST>[0],
      ROUTE_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.expiresAt).toBeNull()
    const setArg = updateSet.mock.calls[0][0] as { planExpiresAt: Date | null }
    expect(setArg.planExpiresAt).toBeNull()
  })

  it('rejects an unknown code with 400 SUBSCRIPTION_INVALID_CODE', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ code: 'WRONGGUESS' }) as Parameters<typeof POST>[0],
      ROUTE_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.messageCode).toBe('SUBSCRIPTION_INVALID_CODE')
    expect(updateSet).not.toHaveBeenCalled()
    expect(publishToBusiness).not.toHaveBeenCalled()
  })

  it('treats an unset PRO_PROMO_CODES env as invalid code (no config leak)', async () => {
    delete process.env.PRO_PROMO_CODES

    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ code: 'LAUNCHCREW' }) as Parameters<typeof POST>[0],
      ROUTE_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.messageCode).toBe('SUBSCRIPTION_INVALID_CODE')
  })

  it('blocks non-owner roles with 403 SUBSCRIPTION_OWNER_ONLY', async () => {
    requireBusinessAccess.mockResolvedValue({
      ...OWNER_ACCESS,
      role: 'partner' as const,
    })

    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ code: 'LAUNCHCREW' }) as Parameters<typeof POST>[0],
      ROUTE_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.messageCode).toBe('SUBSCRIPTION_OWNER_ONLY')
    expect(updateSet).not.toHaveBeenCalled()
  })

  it('returns the limiter response when the promo bucket is exhausted, before validating the code', async () => {
    applyRateLimit.mockImplementation(async (id: string) =>
      id.startsWith('promo:')
        ? NextResponse.json(
            { messageCode: 'RATE_LIMITED' },
            { status: 429, headers: { 'Retry-After': '3600' } },
          )
        : null,
    )

    const { POST } = await import('./route')
    // A VALID code must still 429 — the budget burns before validation.
    const res = await POST(
      makeRequest({ code: 'LAUNCHCREW' }) as Parameters<typeof POST>[0],
      ROUTE_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(429)
    expect(body.messageCode).toBe('RATE_LIMITED')
    expect(applyRateLimit).toHaveBeenCalledWith(
      `promo:${USER_ID}`,
      expect.objectContaining({ limit: 5, windowSeconds: 3600, failClosed: true }),
    )
    expect(updateSet).not.toHaveBeenCalled()
  })

  it('consumes the rate-limit budget even for invalid guesses', async () => {
    const { POST } = await import('./route')
    await POST(
      makeRequest({ code: 'WRONGGUESS' }) as Parameters<typeof POST>[0],
      ROUTE_PARAMS,
    )
    expect(applyRateLimit).toHaveBeenCalledWith(
      `promo:${USER_ID}`,
      expect.objectContaining({ limit: 5 }),
    )
  })

  it('rejects a missing code with a validation error', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({}) as Parameters<typeof POST>[0],
      ROUTE_PARAMS,
    )
    expect(res.status).toBe(400)
  })
})
