import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for POST /api/transfer/accept — realtime publish assertions.
 *
 * Mocks the auth boundary, db, rate-limit, and realtime publisher so no
 * live services are needed. Verifies that after a successful transfer all
 * four publish calls are made with the correct arguments, that a 503 is
 * returned when either critical publish throws RealtimeUnavailableError,
 * and that the X-Device-Id header is forwarded to all calls.
 */

const publishCriticalToUser = vi.fn()
const publishToUser = vi.fn()

class RealtimeUnavailableError extends Error {
  constructor(msg?: string) {
    super(msg ?? 'realtime unavailable')
    this.name = 'RealtimeUnavailableError'
  }
}

vi.mock('@/lib/realtime', async (orig) => {
  const real = await orig<typeof import('@/lib/realtime')>()
  return {
    ...real,
    publishCriticalToUser,
    publishToUser,
    RealtimeUnavailableError,
  }
})

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => ({
        user: {
          id: 'user-new-owner',
          email: 'newowner@example.com',
          emailVerified: true,
        },
      })),
    },
  },
}))

vi.mock('@/lib/server-logger', () => ({ logServerError: vi.fn() }))

const transferRow = {
  id: 'transfer-1',
  code: 'ABC123',
  status: 'pending',
  toEmail: 'newowner@example.com',
  expiresAt: new Date(Date.now() + 3_600_000),
  businessId: 'biz-001',
  fromUser: 'user-former-owner',
}

// Drizzle mocks
const selectResults: unknown[] = []
const updateReturnValues: unknown[][] = []
const transactionImpl = vi.fn()

function selectBuilder() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {}
  b.from = vi.fn(() => b)
  b.where = vi.fn(() => b)
  b.get = vi.fn(() => Promise.resolve(selectResults.shift() ?? null))
  b.limit = vi.fn(() => Promise.resolve(selectResults.shift() ?? []))
  return b
}

function updateBuilder() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {}
  b.set = vi.fn(() => b)
  b.where = vi.fn(() => b)
  b.returning = vi.fn(() => Promise.resolve(updateReturnValues.shift() ?? [{ id: 'bu-1' }]))
  return b
}

const selectImpl = vi.fn(() => selectBuilder())
const updateImpl = vi.fn(() => updateBuilder())
const insertImpl = vi.fn(() => ({
  values: vi.fn(() => Promise.resolve(undefined)),
}))

vi.mock('@/db', () => ({
  db: {
    select: () => selectImpl(),
    update: () => updateImpl(),
    insert: () => insertImpl(),
    transaction: (...args: unknown[]) => transactionImpl(...args),
  },
  ownershipTransfers: {
    id: 'ot.id',
    code: 'ot.code',
    status: 'ot.status',
    toEmail: 'ot.to_email',
    expiresAt: 'ot.expires_at',
    businessId: 'ot.business_id',
    fromUser: 'ot.from_user',
  },
  businessUsers: {
    id: 'bu.id',
    userId: 'bu.user_id',
    businessId: 'bu.business_id',
    role: 'bu.role',
    status: 'bu.status',
  },
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => ({ success: true, resetAt: Date.now() + 60_000 })),
  getClientIp: () => '127.0.0.1',
  RateLimits: { codeValidation: { window: 60, max: 10 } },
}))

vi.mock('@/lib/business-auth', () => ({
  invalidateAccessCache: vi.fn(),
}))

vi.mock('@/lib/api-middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-middleware')>('@/lib/api-middleware')
  return {
    ...actual,
    enforceMaxContentLength: vi.fn(() => null),
  }
})

const NEW_OWNER_ID = 'user-new-owner'
const FORMER_OWNER_ID = 'user-former-owner'
const BUSINESS_ID = 'biz-001'

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  const json = JSON.stringify(body)
  return new Request('http://localhost:3000/api/transfer/accept', {
    method: 'POST',
    body: json,
    headers: {
      'content-type': 'application/json',
      'content-length': String(new TextEncoder().encode(json).length),
      origin: 'http://localhost:3000',
      host: 'localhost:3000',
      ...headers,
    },
  })
}

function setupHappyPath() {
  // transfer lookup
  selectResults.push(transferRow)
  // Inside transaction: existingMembership lookup returns null (new member)
  transactionImpl.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
    return cb({
      update: () => updateBuilder(),
      select: () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b: any = {}
        b.from = vi.fn(() => b)
        b.where = vi.fn(() => b)
        b.limit = vi.fn(() => Promise.resolve([]))
        return b
      },
      insert: () => ({ values: vi.fn(() => Promise.resolve(undefined)) }),
    })
  })
}

beforeEach(() => {
  publishCriticalToUser.mockReset()
  publishToUser.mockReset()
  selectResults.length = 0
  updateReturnValues.length = 0
  selectImpl.mockClear()
  updateImpl.mockClear()
  insertImpl.mockClear()
  transactionImpl.mockReset()
  publishCriticalToUser.mockResolvedValue(undefined)
  publishToUser.mockResolvedValue(undefined)
})

describe('POST /api/transfer/accept — realtime publishes', () => {
  it('publishes all four events on happy path', async () => {
    setupHappyPath()
    const { POST } = await import('./route')
    const res = await POST(makeRequest({ code: 'ABC123' }) as Parameters<typeof POST>[0])

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)

    // Two critical publishes
    expect(publishCriticalToUser).toHaveBeenCalledTimes(2)
    expect(publishCriticalToUser).toHaveBeenCalledWith(
      NEW_OWNER_ID,
      expect.objectContaining({ type: 'ownership.transferred', businessId: BUSINESS_ID, role: 'new_owner' }),
      undefined,
    )
    expect(publishCriticalToUser).toHaveBeenCalledWith(
      FORMER_OWNER_ID,
      expect.objectContaining({ type: 'session.revoked', businessId: BUSINESS_ID, reason: 'ownership_transferred' }),
      undefined,
    )

    // Two non-critical publishes
    expect(publishToUser).toHaveBeenCalledTimes(2)
    expect(publishToUser).toHaveBeenCalledWith(
      NEW_OWNER_ID,
      expect.objectContaining({ type: 'business.list.changed', reason: 'added' }),
      undefined,
    )
    expect(publishToUser).toHaveBeenCalledWith(
      FORMER_OWNER_ID,
      expect.objectContaining({ type: 'business.list.changed', reason: 'removed' }),
      undefined,
    )
  })

  it('forwards X-Device-Id header to all publish calls', async () => {
    setupHappyPath()
    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ code: 'ABC123' }, { 'x-device-id': 'dev-abc' }) as Parameters<typeof POST>[0],
    )

    expect(res.status).toBe(200)
    expect(publishCriticalToUser).toHaveBeenCalledWith(
      NEW_OWNER_ID,
      expect.objectContaining({ type: 'ownership.transferred' }),
      'dev-abc',
    )
    expect(publishCriticalToUser).toHaveBeenCalledWith(
      FORMER_OWNER_ID,
      expect.objectContaining({ type: 'session.revoked' }),
      'dev-abc',
    )
    expect(publishToUser).toHaveBeenCalledWith(
      NEW_OWNER_ID,
      expect.objectContaining({ type: 'business.list.changed', reason: 'added' }),
      'dev-abc',
    )
    expect(publishToUser).toHaveBeenCalledWith(
      FORMER_OWNER_ID,
      expect.objectContaining({ type: 'business.list.changed', reason: 'removed' }),
      'dev-abc',
    )
  })

  it('returns 503 REALTIME_PUBLISH_UNAVAILABLE when new-owner critical publish fails', async () => {
    setupHappyPath()
    publishCriticalToUser.mockImplementation((userId: string) => {
      if (userId === NEW_OWNER_ID) {
        return Promise.reject(new RealtimeUnavailableError())
      }
      return Promise.resolve()
    })

    const { POST } = await import('./route')
    const res = await POST(makeRequest({ code: 'ABC123' }) as Parameters<typeof POST>[0])

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.messageCode).toBe('REALTIME_PUBLISH_UNAVAILABLE')
  })

  it('returns 503 REALTIME_PUBLISH_UNAVAILABLE when former-owner critical publish fails', async () => {
    setupHappyPath()
    publishCriticalToUser.mockImplementation((userId: string) => {
      if (userId === FORMER_OWNER_ID) {
        return Promise.reject(new RealtimeUnavailableError())
      }
      return Promise.resolve()
    })

    const { POST } = await import('./route')
    const res = await POST(makeRequest({ code: 'ABC123' }) as Parameters<typeof POST>[0])

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.messageCode).toBe('REALTIME_PUBLISH_UNAVAILABLE')
  })

  it('does not publish when transfer code is not found in the database', async () => {
    // transfer lookup returns null — valid format code but no DB row
    selectResults.push(null)

    const { POST } = await import('./route')
    const res = await POST(makeRequest({ code: 'XYZ123' }) as Parameters<typeof POST>[0])

    const body = await res.json()
    expect(body.messageCode).toBe('TRANSFER_INVALID_OR_EXPIRED')
    expect(publishCriticalToUser).not.toHaveBeenCalled()
    expect(publishToUser).not.toHaveBeenCalled()
  })
})
