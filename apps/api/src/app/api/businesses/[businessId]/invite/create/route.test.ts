import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for POST /api/businesses/[businessId]/invite/create — realtime
 * publish assertions.
 *
 * Covers:
 *   - happy path: publishToBusiness called with team.invite.created
 *   - X-Device-Id forwarded
 *   - no publish when cap exceeded
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
//   db.select().from().where() (thenable) -> [{ count }]  (active code count)
//   db.insert().values()                  -> void (insert new code, may throw on collision)
const selectResults: unknown[] = []
let insertShouldThrow = false

function selectBuilder() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {}
  b.from = vi.fn(() => b)
  b.where = vi.fn(() => b)
  b.then = vi.fn((resolve: (v: unknown) => void) =>
    resolve(selectResults.shift() ?? [{ count: 0 }]),
  )
  return b
}

const insertImpl = vi.fn(() => ({
  values: vi.fn(async () => {
    if (insertShouldThrow) throw new Error('unique constraint')
    return undefined
  }),
}))

const dbMock = {
  select: vi.fn(() => selectBuilder()),
  insert: vi.fn(() => insertImpl()),
}

vi.mock('@/db', () => ({
  db: dbMock,
  inviteCodes: {
    id: 'invite_codes.id',
    businessId: 'invite_codes.business_id',
    code: 'invite_codes.code',
    role: 'invite_codes.role',
    expiresAt: 'invite_codes.expires_at',
    usedBy: 'invite_codes.used_by',
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

vi.mock('@/lib/server-logger', () => ({ logServerError: vi.fn() }))

vi.mock('@/lib/invite-expiry', () => ({
  isExpiryWithinBounds: vi.fn(() => true),
}))

vi.mock('@kasero/shared/auth', () => ({
  generateInviteCode: vi.fn(() => 'ABC123'),
}))

const BUSINESS_ID = 'biz-invite-create01'
const CALLER_ID = 'user-owner-invcrt01'

const OWNER_ACCESS = {
  userId: CALLER_ID,
  businessId: BUSINESS_ID,
  role: 'owner' as const,
  status: 'active' as const,
}

const FUTURE_DATE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  const json = JSON.stringify(body)
  return new Request(`http://localhost:3000/api/businesses/${BUSINESS_ID}/invite/create`, {
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
  insertShouldThrow = false
  dbMock.select.mockImplementation(() => selectBuilder())
  insertImpl.mockClear()
  requireBusinessAccess.mockResolvedValue(OWNER_ACCESS)
  publishToBusiness.mockResolvedValue(undefined)
})

describe('POST /api/businesses/[businessId]/invite/create — realtime publishes', () => {
  it('publishes team.invite.created on happy path', async () => {
    selectResults.push([{ count: 0 }])

    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ role: 'employee', expiresAt: FUTURE_DATE }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledTimes(1)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'team.invite.created', inviteId: expect.any(String) }),
      undefined,
    )
  })

  it('forwards X-Device-Id to publishToBusiness', async () => {
    selectResults.push([{ count: 0 }])

    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ role: 'partner', expiresAt: FUTURE_DATE }, { 'x-device-id': 'dev-invite-xyz' }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'team.invite.created' }),
      'dev-invite-xyz',
    )
  })

  it('does not publish when cap is exceeded', async () => {
    selectResults.push([{ count: 10 }])

    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ role: 'employee', expiresAt: FUTURE_DATE }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(409)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })
})
