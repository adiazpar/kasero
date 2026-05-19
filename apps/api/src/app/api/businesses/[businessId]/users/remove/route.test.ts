import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for POST /api/businesses/[businessId]/users/remove — realtime
 * publish assertions.
 *
 * Covers:
 *   - happy path: publishToBusiness, publishCriticalToUser, publishToUser all called
 *   - 503 when publishCriticalToUser throws RealtimeUnavailableError
 *   - publishToUser not called when critical publish fails
 *   - X-Device-Id forwarded to all publishers
 */

const publishToBusiness = vi.fn()
const publishCriticalToUser = vi.fn()
const publishToUser = vi.fn()

vi.mock('@/lib/realtime', async (orig) => {
  const real = await orig<typeof import('@/lib/realtime')>()
  return { ...real, publishToBusiness, publishCriticalToUser, publishToUser }
})

const requireBusinessAccess = vi.fn()

vi.mock('@/lib/business-auth', async (orig) => {
  const real = await orig<typeof import('@/lib/business-auth')>()
  return { ...real, requireBusinessAccess }
})

// Drizzle mock — the route calls:
//   db.select().from().where().limit()  -> [{ role }]  (target lookup)
//   db.delete().where()                 -> void
const selectResults: unknown[] = []

function selectBuilder() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {}
  b.from = vi.fn(() => b)
  b.where = vi.fn(() => b)
  b.limit = vi.fn(() => Promise.resolve(selectResults.shift() ?? []))
  return b
}

function deleteBuilder() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {}
  b.where = vi.fn(() => Promise.resolve([]))
  return b
}

const dbMock = {
  select: vi.fn(() => selectBuilder()),
  delete: vi.fn(() => deleteBuilder()),
}

vi.mock('@/db', () => ({
  db: dbMock,
  businessUsers: {
    userId: 'business_users.user_id',
    businessId: 'business_users.business_id',
    role: 'business_users.role',
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

const BUSINESS_ID = 'biz-remove-test-0001'
const CALLER_ID = 'user-owner-remove-01'
const TARGET_ID = 'user-target-remove01'

const OWNER_ACCESS = {
  userId: CALLER_ID,
  businessId: BUSINESS_ID,
  role: 'owner' as const,
  status: 'active' as const,
}

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  const json = JSON.stringify(body)
  return new Request(`http://localhost:3000/api/businesses/${BUSINESS_ID}/users/remove`, {
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

beforeEach(() => {
  publishToBusiness.mockReset()
  publishCriticalToUser.mockReset()
  publishToUser.mockReset()
  selectResults.length = 0
  dbMock.select.mockImplementation(() => selectBuilder())
  dbMock.delete.mockImplementation(() => deleteBuilder())
  requireBusinessAccess.mockResolvedValue(OWNER_ACCESS)
  publishToBusiness.mockResolvedValue(undefined)
  publishCriticalToUser.mockResolvedValue(undefined)
  publishToUser.mockResolvedValue(undefined)
})

describe('POST /api/businesses/[businessId]/users/remove — realtime publishes', () => {
  it('publishes team.member.removed, session.revoked, and business.list.changed on happy path', async () => {
    // Target is an employee
    selectResults.push([{ role: 'employee' }])

    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ userId: TARGET_ID }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)

    expect(publishToBusiness).toHaveBeenCalledTimes(1)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'team.member.removed', memberId: TARGET_ID }),
      undefined,
    )

    expect(publishCriticalToUser).toHaveBeenCalledTimes(1)
    expect(publishCriticalToUser).toHaveBeenCalledWith(
      TARGET_ID,
      expect.objectContaining({ type: 'session.revoked', businessId: BUSINESS_ID, reason: 'removed' }),
      undefined,
    )

    expect(publishToUser).toHaveBeenCalledTimes(1)
    expect(publishToUser).toHaveBeenCalledWith(
      TARGET_ID,
      expect.objectContaining({ type: 'business.list.changed', reason: 'removed' }),
      undefined,
    )
  })

  it('forwards X-Device-Id to all three publishers', async () => {
    selectResults.push([{ role: 'employee' }])

    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ userId: TARGET_ID }, { 'x-device-id': 'dev-remove-xyz' }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'team.member.removed' }),
      'dev-remove-xyz',
    )
    expect(publishCriticalToUser).toHaveBeenCalledWith(
      TARGET_ID,
      expect.objectContaining({ type: 'session.revoked' }),
      'dev-remove-xyz',
    )
    expect(publishToUser).toHaveBeenCalledWith(
      TARGET_ID,
      expect.objectContaining({ type: 'business.list.changed' }),
      'dev-remove-xyz',
    )
  })

  it('returns 503 REALTIME_PUBLISH_UNAVAILABLE when publishCriticalToUser throws', async () => {
    const { RealtimeUnavailableError } = await import('@/lib/realtime')

    selectResults.push([{ role: 'employee' }])
    publishCriticalToUser.mockRejectedValue(new RealtimeUnavailableError('redis down'))

    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ userId: TARGET_ID }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(503)
    const body = await res.json() as { messageCode: string }
    expect(body.messageCode).toBe('REALTIME_PUBLISH_UNAVAILABLE')
  })

  it('does NOT call publishToUser when critical publish fails', async () => {
    const { RealtimeUnavailableError } = await import('@/lib/realtime')

    selectResults.push([{ role: 'employee' }])
    publishCriticalToUser.mockRejectedValue(new RealtimeUnavailableError('redis down'))

    const { POST } = await import('./route')
    await POST(
      makeRequest({ userId: TARGET_ID }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(publishToUser).not.toHaveBeenCalled()
  })
})
