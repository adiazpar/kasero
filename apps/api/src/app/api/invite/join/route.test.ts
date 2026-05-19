import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for POST /api/invite/join — realtime publish assertions.
 *
 * We mock the auth boundary, db, rate-limit, and realtime publisher
 * so no live services are needed. The happy path verifies that all
 * three publish calls are made with the correct arguments after the
 * membership row is written.
 */

const publishToBusiness = vi.fn()
const publishToUser = vi.fn()

vi.mock('@/lib/realtime', async (orig) => {
  const real = await orig<typeof import('@/lib/realtime')>()
  return { ...real, publishToBusiness, publishToUser }
})

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => ({
        user: {
          id: 'user-joiner-001',
          emailVerified: true,
          name: 'Alice Joiner',
        },
      })),
    },
  },
}))

// Drizzle builder mocks. The route uses:
//   db.select().from().innerJoin().where().get()   (invite lookup)
//   db.select().from().where().get()               (membership lookup)
//   db.update().set().where().returning()           (atomic claim)
//   db.insert().values()                            (membership insert)
const selectResults: unknown[] = []
const insertCalls: unknown[] = []
const updateReturnValues: unknown[][] = []

function selectBuilder() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {}
  b.from = vi.fn(() => b)
  b.innerJoin = vi.fn(() => b)
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
  b.returning = vi.fn(() => Promise.resolve(updateReturnValues.shift() ?? []))
  return b
}

const selectImpl = vi.fn(() => selectBuilder())
const updateImpl = vi.fn(() => updateBuilder())
const insertImpl = vi.fn(() => ({
  values: vi.fn((row: unknown) => {
    insertCalls.push(row)
    return Promise.resolve(undefined)
  }),
}))

vi.mock('@/db', () => ({
  db: {
    select: (...args: unknown[]) => selectImpl(...args),
    update: (...args: unknown[]) => updateImpl(...args),
    insert: (...args: unknown[]) => insertImpl(...args),
  },
  inviteCodes: {
    id: 'invite_codes.id',
    code: 'invite_codes.code',
    role: 'invite_codes.role',
    expiresAt: 'invite_codes.expires_at',
    businessId: 'invite_codes.business_id',
    usedBy: 'invite_codes.used_by',
  },
  businesses: {
    id: 'businesses.id',
    name: 'businesses.name',
  },
  businessUsers: {
    id: 'business_users.id',
    userId: 'business_users.user_id',
    businessId: 'business_users.business_id',
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

vi.mock('@/lib/server-logger', () => ({
  logServerError: vi.fn(),
}))

const JOINER_ID = 'user-joiner-001'
const BUSINESS_ID = 'biz-test-0000000001'
const INVITE_ID = 'invite-id-001'

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  const json = JSON.stringify(body)
  return new Request('http://localhost:3000/api/invite/join', {
    method: 'POST',
    body: json,
    headers: {
      'content-type': 'application/json',
      'content-length': String(new TextEncoder().encode(json).length),
      ...headers,
    },
  })
}

function queueSelects(...results: unknown[]) {
  selectResults.length = 0
  selectResults.push(...results)
}

function queueUpdateReturn(rows: unknown[]) {
  updateReturnValues.length = 0
  updateReturnValues.push(rows)
}

beforeEach(() => {
  publishToBusiness.mockReset()
  publishToUser.mockReset()
  selectResults.length = 0
  insertCalls.length = 0
  updateReturnValues.length = 0
  selectImpl.mockClear()
  insertImpl.mockClear()
  updateImpl.mockClear()
})

describe('POST /api/invite/join — realtime publishes', () => {
  it('emits team.member.joined, team.invite.consumed on business channel and business.list.changed on user channel on happy path', async () => {
    // invite lookup: returns a valid invite
    queueSelects(
      {
        id: INVITE_ID,
        code: 'abc123',
        role: 'partner',
        expiresAt: new Date(Date.now() + 3600_000),
        businessId: BUSINESS_ID,
        businessName: 'My Shop',
      },
      // membership lookup: no existing membership
      null,
    )
    // atomic claim succeeds
    queueUpdateReturn([{ id: INVITE_ID }])

    const { POST } = await import('./route')
    const res = await POST(makeRequest({ code: 'abc123' }) as Parameters<typeof POST>[0])

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)

    expect(publishToBusiness).toHaveBeenCalledTimes(2)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'team.member.joined', memberId: JOINER_ID }),
      undefined,
    )
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({
        type: 'team.invite.consumed',
        inviteId: INVITE_ID,
        consumedByName: 'Alice Joiner',
      }),
      undefined,
    )
    expect(publishToUser).toHaveBeenCalledTimes(1)
    expect(publishToUser).toHaveBeenCalledWith(
      JOINER_ID,
      expect.objectContaining({ type: 'business.list.changed', reason: 'added' }),
      undefined,
    )
  })

  it('forwards the X-Device-Id header to all publish calls', async () => {
    queueSelects(
      {
        id: INVITE_ID,
        code: 'abc123',
        role: 'partner',
        expiresAt: new Date(Date.now() + 3600_000),
        businessId: BUSINESS_ID,
        businessName: 'My Shop',
      },
      null,
    )
    queueUpdateReturn([{ id: INVITE_ID }])

    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ code: 'abc123' }, { 'x-device-id': 'dev-xyz' }) as Parameters<typeof POST>[0],
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'team.member.joined' }),
      'dev-xyz',
    )
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'team.invite.consumed' }),
      'dev-xyz',
    )
    expect(publishToUser).toHaveBeenCalledWith(
      JOINER_ID,
      expect.objectContaining({ type: 'business.list.changed' }),
      'dev-xyz',
    )
  })

  it('does not publish when invite is not found in the database', async () => {
    // invite lookup returns nothing (valid format code, but no DB match)
    queueSelects(null)

    const { POST } = await import('./route')
    const res = await POST(makeRequest({ code: 'ABC123' }) as Parameters<typeof POST>[0])

    const body = await res.json()
    expect(body.messageCode).toBe('INVITE_INVALID_OR_EXPIRED')
    expect(publishToBusiness).not.toHaveBeenCalled()
    expect(publishToUser).not.toHaveBeenCalled()
  })

  it('does not publish when the atomic claim is lost (race condition)', async () => {
    queueSelects(
      {
        id: INVITE_ID,
        code: 'abc123',
        role: 'partner',
        expiresAt: new Date(Date.now() + 3600_000),
        businessId: BUSINESS_ID,
        businessName: 'My Shop',
      },
      null,
    )
    // claim fails — 0 rows returned
    queueUpdateReturn([])

    const { POST } = await import('./route')
    const res = await POST(makeRequest({ code: 'abc123' }) as Parameters<typeof POST>[0])

    const body = await res.json()
    expect(body.success).toBe(false)
    expect(publishToBusiness).not.toHaveBeenCalled()
    expect(publishToUser).not.toHaveBeenCalled()
  })
})
