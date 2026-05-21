import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Unit tests for POST /api/businesses/[businessId]/transfer/initiate.
 *
 * Following the established pattern from /api/account/delete (no real-DB
 * harness yet — see route.test.ts there for the full reasoning), this
 * file mocks the auth + db boundary and exercises every branch of the
 * OTP-step-up route.
 *
 * Branches covered:
 *   - no session                                    -> 401 UNAUTHORIZED
 *   - non-owner caller                              -> 403 TRANSFER_FORBIDDEN_NOT_OWNER
 *   - missing otp / missing toEmail                 -> 400 validation
 *   - verifyEmailOTP rejects                        -> 401 OTP_INVALID
 *   - recipient email not found                     -> 400 TRANSFER_RECIPIENT_NOT_FOUND
 *   - recipient === caller (self-transfer)          -> 400 TRANSFER_CANNOT_SELF
 *   - already a pending transfer                    -> 400 TRANSFER_PENDING_EXISTS
 *   - happy path                                    -> 200 with code + expiresAt,
 *                                                       verifyEmailOTP called once,
 *                                                       ownershipTransfers.insert called once
 *
 * We mock `@/lib/business-auth.requireBusinessAccess` outright so the
 * test never reaches the `headers()` boundary or the cached-access
 * lookup — both are tested in lib/business-auth.test.ts. Each test
 * either makes that call throw (no session / no access) or returns a
 * scripted BusinessAccess.
 */

const verifyEmailOTP = vi.fn()
const requireBusinessAccess = vi.fn()

// Drizzle query-builder mocks. The route uses chainable .select / .insert;
// each method returns a builder object whose terminal call (.limit /
// .values) resolves to a queued result. We push results in call order
// so each .from(...).where(...).limit(...) consumes one entry.
const selectResults: unknown[] = []
const insertCalls: unknown[] = []

function selectBuilder() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {}
  b.from = vi.fn(() => b)
  b.innerJoin = vi.fn(() => b)
  b.where = vi.fn(() => b)
  b.limit = vi.fn(() => Promise.resolve(selectResults.shift() ?? []))
  b.get = vi.fn(() => Promise.resolve(selectResults.shift() ?? null))
  return b
}

const selectImpl = vi.fn(() => selectBuilder())
const insertImpl = vi.fn(() => ({
  values: vi.fn((row: unknown) => {
    insertCalls.push(row)
    return Promise.resolve(undefined)
  }),
}))

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      verifyEmailOTP: (...args: unknown[]) => verifyEmailOTP(...args),
    },
  },
}))

vi.mock('@/lib/business-auth', async () => {
  // Pull isOwner from the real module so the route's role check stays
  // honest; only requireBusinessAccess (which hits headers() + cache +
  // db) is replaced.
  const actual = await vi.importActual<typeof import('@kasero/shared/business-role')>(
    '@kasero/shared/business-role',
  )
  return {
    requireBusinessAccess: (...args: unknown[]) => requireBusinessAccess(...args),
    isOwner: actual.isOwner,
    invalidateAccessCache: vi.fn(),
    invalidateAccessCacheForBusiness: vi.fn(),
    invalidateAccessCacheForUser: vi.fn(),
  }
})

vi.mock('@/db', () => ({
  db: {
    select: () => selectImpl(),
    insert: () => insertImpl(),
  },
  // The route imports `users` and `ownershipTransfers` as drizzle tables;
  // the mock builders ignore the table reference so any truthy value works.
  users: {
    id: 'users.id',
    email: 'users.email',
  },
  ownershipTransfers: {
    id: 'ownership_transfers.id',
    businessId: 'ownership_transfers.business_id',
    code: 'ownership_transfers.code',
    fromUser: 'ownership_transfers.from_user',
    toEmail: 'ownership_transfers.to_email',
    status: 'ownership_transfers.status',
    expiresAt: 'ownership_transfers.expires_at',
  },
}))

vi.mock('@/lib/rate-limit', async () => {
  return {
    checkRateLimit: vi.fn(async () => ({ success: true, resetAt: Date.now() + 60_000 })),
    getClientIp: () => '127.0.0.1',
    RateLimits: {
      userMutation: { limit: 30, windowSeconds: 60 },
      ipMutation: { limit: 600, windowSeconds: 60 },
      transferInitiate: { limit: 5, windowSeconds: 15 * 60 },
      businessMutation: { limit: 200, windowSeconds: 60 },
    },
    UpstashUnavailableError: class UpstashUnavailableError extends Error {},
  }
})

const CALLER_ID = 'user-owner-0000000001'
const CALLER_EMAIL = 'owner@x.com'

// businessId must satisfy api-middleware's URL-segment guard
// (^[A-Za-z0-9_-]{12,64}$). Anything shorter falls out as 404
// BUSINESS_NOT_FOUND before the handler is invoked.
const BUSINESS_ID = 'biz-test-0000000001'

const OWNER_ACCESS = {
  userId: CALLER_ID,
  businessId: BUSINESS_ID,
  businessName: 'My Shop',
  businessIcon: null,
  businessLocale: 'en-US',
  businessCurrency: 'USD',
  role: 'owner' as const,
}

const PARTNER_ACCESS = {
  ...OWNER_ACCESS,
  role: 'partner' as const,
}

function makeRequest(body: unknown): Request {
  const json = JSON.stringify(body)
  return new Request(
    `http://localhost:3000/api/businesses/${BUSINESS_ID}/transfer/initiate`,
    {
      method: 'POST',
      body: json,
      headers: {
        'content-type': 'application/json',
        'content-length': String(new TextEncoder().encode(json).length),
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
      },
    },
  )
}

function makeParams() {
  return { params: Promise.resolve({ businessId: BUSINESS_ID }) }
}

function queueSelects(...results: unknown[]) {
  selectResults.length = 0
  selectResults.push(...results)
}

beforeEach(() => {
  verifyEmailOTP.mockReset()
  requireBusinessAccess.mockReset()
  selectResults.length = 0
  insertCalls.length = 0
  selectImpl.mockClear()
  insertImpl.mockClear()
})

describe('POST /api/businesses/[businessId]/transfer/initiate', () => {
  it('rejects without an active session', async () => {
    requireBusinessAccess.mockRejectedValueOnce(
      new Error('Unauthorized: Not authenticated'),
    )
    const { POST } = await import('./route')
    const res = await POST(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeRequest({ toEmail: 'recipient@x.com', otp: '123456' }) as any,
      makeParams(),
    )
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.messageCode).toBe('UNAUTHORIZED')
    expect(verifyEmailOTP).not.toHaveBeenCalled()
  })

  it('rejects a non-owner caller', async () => {
    requireBusinessAccess.mockResolvedValueOnce(PARTNER_ACCESS)
    const { POST } = await import('./route')
    const res = await POST(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeRequest({ toEmail: 'recipient@x.com', otp: '123456' }) as any,
      makeParams(),
    )
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.messageCode).toBe('TRANSFER_FORBIDDEN_NOT_OWNER')
    expect(verifyEmailOTP).not.toHaveBeenCalled()
  })

  it('rejects when otp field is missing', async () => {
    requireBusinessAccess.mockResolvedValueOnce(OWNER_ACCESS)
    const { POST } = await import('./route')
    const res = await POST(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeRequest({ toEmail: 'recipient@x.com' }) as any,
      makeParams(),
    )
    expect(res.status).toBe(400)
    expect(verifyEmailOTP).not.toHaveBeenCalled()
  })

  it('rejects when toEmail field is missing', async () => {
    requireBusinessAccess.mockResolvedValueOnce(OWNER_ACCESS)
    const { POST } = await import('./route')
    const res = await POST(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeRequest({ otp: '123456' }) as any,
      makeParams(),
    )
    expect(res.status).toBe(400)
    expect(verifyEmailOTP).not.toHaveBeenCalled()
  })

  it('rejects when otp does not match the stored verification', async () => {
    requireBusinessAccess.mockResolvedValueOnce(OWNER_ACCESS)
    // caller email lookup
    queueSelects([{ email: CALLER_EMAIL }])
    verifyEmailOTP.mockRejectedValueOnce(new Error('INVALID_OTP'))
    const { POST } = await import('./route')
    const res = await POST(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeRequest({ toEmail: 'recipient@x.com', otp: '000000' }) as any,
      makeParams(),
    )
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.messageCode).toBe('OTP_INVALID')
    expect(insertImpl).not.toHaveBeenCalled()
  })

  it('rejects when recipient email is not a registered user', async () => {
    requireBusinessAccess.mockResolvedValueOnce(OWNER_ACCESS)
    queueSelects(
      [{ email: CALLER_EMAIL }], // caller email lookup
      [], // recipient lookup -> not found
    )
    verifyEmailOTP.mockResolvedValueOnce({ status: true })
    const { POST } = await import('./route')
    const res = await POST(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeRequest({ toEmail: 'ghost@x.com', otp: '123456' }) as any,
      makeParams(),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.messageCode).toBe('TRANSFER_RECIPIENT_NOT_FOUND')
    expect(insertImpl).not.toHaveBeenCalled()
  })

  it('rejects a self-transfer attempt', async () => {
    requireBusinessAccess.mockResolvedValueOnce(OWNER_ACCESS)
    queueSelects(
      [{ email: CALLER_EMAIL }],
      [{ id: CALLER_ID }], // recipient is the caller themselves
    )
    verifyEmailOTP.mockResolvedValueOnce({ status: true })
    const { POST } = await import('./route')
    const res = await POST(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeRequest({ toEmail: CALLER_EMAIL, otp: '123456' }) as any,
      makeParams(),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.messageCode).toBe('TRANSFER_CANNOT_SELF')
    expect(insertImpl).not.toHaveBeenCalled()
  })

  it('rejects when a pending transfer already exists', async () => {
    requireBusinessAccess.mockResolvedValueOnce(OWNER_ACCESS)
    queueSelects(
      [{ email: CALLER_EMAIL }],
      [{ id: 'user-recipient' }],
      [{ id: 'existing-transfer' }], // pending-transfer lookup -> exists
    )
    verifyEmailOTP.mockResolvedValueOnce({ status: true })
    const { POST } = await import('./route')
    const res = await POST(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeRequest({ toEmail: 'recipient@x.com', otp: '123456' }) as any,
      makeParams(),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.messageCode).toBe('TRANSFER_PENDING_EXISTS')
    expect(insertImpl).not.toHaveBeenCalled()
  })

  it('creates the transfer on the happy path', async () => {
    requireBusinessAccess.mockResolvedValueOnce(OWNER_ACCESS)
    queueSelects(
      [{ email: CALLER_EMAIL }],
      [{ id: 'user-recipient' }],
      [], // no pending transfer
      [], // first unique-code lookup -> not taken
    )
    verifyEmailOTP.mockResolvedValueOnce({ status: true })
    const { POST } = await import('./route')
    const res = await POST(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeRequest({ toEmail: 'recipient@x.com', otp: '123456' }) as any,
      makeParams(),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.code).toBe('string')
    expect(body.code).toMatch(/^[A-Z0-9]{6}$/)
    expect(typeof body.expiresAt).toBe('string')
    expect(verifyEmailOTP).toHaveBeenCalledOnce()
    expect(verifyEmailOTP).toHaveBeenCalledWith({
      body: { email: CALLER_EMAIL, otp: '123456' },
      headers: expect.any(Headers),
    })
    expect(insertImpl).toHaveBeenCalledOnce()
    expect(insertCalls).toHaveLength(1)
    const inserted = insertCalls[0] as Record<string, unknown>
    expect(inserted.businessId).toBe(BUSINESS_ID)
    expect(inserted.fromUser).toBe(CALLER_ID)
    expect(inserted.toEmail).toBe('recipient@x.com')
    expect(inserted.status).toBe('pending')
  })
})
