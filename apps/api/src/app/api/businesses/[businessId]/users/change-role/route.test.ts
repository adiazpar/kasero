import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for POST /api/businesses/[businessId]/users/change-role — realtime
 * publish assertions.
 *
 * Covers:
 *   - happy path: publishToBusiness called with team.member.role_changed
 *   - X-Device-Id forwarded
 */

const publishToBusiness = vi.fn()

vi.mock('@/lib/realtime', async (orig) => {
  const real = await orig<typeof import('@/lib/realtime')>()
  return { ...real, publishToBusiness }
})

const requireBusinessAccess = vi.fn()

vi.mock('@/lib/business-auth', async (orig) => {
  const real = await orig<typeof import('@/lib/business-auth')>()
  return { ...real, requireBusinessAccess }
})

// Drizzle mock — the route calls:
//   db.select().from().where().limit()  -> [{ role, status, ... }]  (target lookup)
//   db.update().set().where()           -> void
const selectResults: unknown[] = []

function selectBuilder() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {}
  b.from = vi.fn(() => b)
  b.where = vi.fn(() => b)
  b.limit = vi.fn(() => Promise.resolve(selectResults.shift() ?? []))
  return b
}

function updateBuilder() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {}
  b.set = vi.fn(() => b)
  b.where = vi.fn(() => Promise.resolve([]))
  return b
}

const dbMock = {
  select: vi.fn(() => selectBuilder()),
  update: vi.fn(() => updateBuilder()),
}

vi.mock('@/db', () => ({
  db: dbMock,
  businessUsers: {
    userId: 'business_users.user_id',
    businessId: 'business_users.business_id',
    role: 'business_users.role',
    status: 'business_users.status',
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

const BUSINESS_ID = 'biz-changerole-0001'
const CALLER_ID = 'user-owner-chgrole01'
const TARGET_ID = 'user-target-chgrole1'

const OWNER_ACCESS = {
  userId: CALLER_ID,
  businessId: BUSINESS_ID,
  role: 'owner' as const,
  status: 'active' as const,
}

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  const json = JSON.stringify(body)
  return new Request(`http://localhost:3000/api/businesses/${BUSINESS_ID}/users/change-role`, {
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
  selectResults.length = 0
  dbMock.select.mockImplementation(() => selectBuilder())
  dbMock.update.mockImplementation(() => updateBuilder())
  requireBusinessAccess.mockResolvedValue(OWNER_ACCESS)
  publishToBusiness.mockResolvedValue(undefined)
})

describe('POST /api/businesses/[businessId]/users/change-role — realtime publishes', () => {
  it('publishes team.member.role_changed on happy path', async () => {
    // Target is an employee; owner is changing to partner
    selectResults.push([{ role: 'employee', status: 'active' }])

    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ userId: TARGET_ID, role: 'partner' }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledTimes(1)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({
        type: 'team.member.role_changed',
        memberId: TARGET_ID,
        role: 'partner',
      }),
      undefined,
    )
  })

  it('forwards X-Device-Id to publishToBusiness', async () => {
    selectResults.push([{ role: 'employee', status: 'active' }])

    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ userId: TARGET_ID, role: 'employee' }, { 'x-device-id': 'dev-role-xyz' }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'team.member.role_changed', memberId: TARGET_ID }),
      'dev-role-xyz',
    )
  })

  it('does not publish when validation fails', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ userId: TARGET_ID, role: 'owner' }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(400)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })
})
