import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for POST /api/businesses/[businessId]/invite/regenerate — realtime
 * publish assertions.
 *
 * Covers:
 *   - happy path: publishToBusiness called with team.invite.regenerated
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
//   db.delete().where()    -> void (delete old code)
//   db.insert().values()   -> void (insert new code)
const deleteImpl = vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) }))
const insertImpl = vi.fn(() => ({
  values: vi.fn(async () => undefined),
}))

const dbMock = {
  delete: (...args: unknown[]) => deleteImpl(...args),
  insert: (...args: unknown[]) => insertImpl(...args),
}

vi.mock('@/db', () => ({
  db: dbMock,
  inviteCodes: {
    id: 'invite_codes.id',
    businessId: 'invite_codes.business_id',
    code: 'invite_codes.code',
    role: 'invite_codes.role',
    expiresAt: 'invite_codes.expires_at',
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
  generateInviteCode: vi.fn(() => 'XYZ789'),
}))

const BUSINESS_ID = 'biz-invite-regen001'
const CALLER_ID = 'user-owner-invreg01'
const OLD_CODE_ID = 'old-invite-code-001'

const OWNER_ACCESS = {
  userId: CALLER_ID,
  businessId: BUSINESS_ID,
  role: 'owner' as const,
  status: 'active' as const,
}

const FUTURE_DATE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  const json = JSON.stringify(body)
  return new Request(`http://localhost:3000/api/businesses/${BUSINESS_ID}/invite/regenerate`, {
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
  deleteImpl.mockClear()
  insertImpl.mockClear()
  requireBusinessAccess.mockResolvedValue(OWNER_ACCESS)
  publishToBusiness.mockResolvedValue(undefined)
})

describe('POST /api/businesses/[businessId]/invite/regenerate — realtime publishes', () => {
  it('publishes team.invite.regenerated on happy path', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ oldCodeId: OLD_CODE_ID, role: 'employee', expiresAt: FUTURE_DATE }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledTimes(1)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'team.invite.regenerated', inviteId: expect.any(String) }),
      undefined,
    )
  })

  it('forwards X-Device-Id to publishToBusiness', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      makeRequest(
        { oldCodeId: OLD_CODE_ID, role: 'partner', expiresAt: FUTURE_DATE },
        { 'x-device-id': 'dev-regen-xyz' },
      ) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'team.invite.regenerated' }),
      'dev-regen-xyz',
    )
  })
})
