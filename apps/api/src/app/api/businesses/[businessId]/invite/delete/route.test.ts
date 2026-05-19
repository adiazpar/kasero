import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for POST /api/businesses/[businessId]/invite/delete — realtime
 * publish assertions.
 *
 * Covers:
 *   - happy path: publishToBusiness called with team.invite.deleted
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
//   db.delete().where()  -> void
const deleteImpl = vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) }))

const dbMock = {
  delete: vi.fn(() => deleteImpl()),
}

vi.mock('@/db', () => ({
  db: dbMock,
  inviteCodes: {
    id: 'invite_codes.id',
    businessId: 'invite_codes.business_id',
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

const BUSINESS_ID = 'biz-invite-delete01'
const CALLER_ID = 'user-owner-invdel01'
const INVITE_ID = 'invite-to-delete-001'

const OWNER_ACCESS = {
  userId: CALLER_ID,
  businessId: BUSINESS_ID,
  role: 'owner' as const,
  status: 'active' as const,
}

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  const json = JSON.stringify(body)
  return new Request(`http://localhost:3000/api/businesses/${BUSINESS_ID}/invite/delete`, {
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
  requireBusinessAccess.mockResolvedValue(OWNER_ACCESS)
  publishToBusiness.mockResolvedValue(undefined)
})

describe('POST /api/businesses/[businessId]/invite/delete — realtime publishes', () => {
  it('publishes team.invite.deleted on happy path', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ id: INVITE_ID }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledTimes(1)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'team.invite.deleted', inviteId: INVITE_ID }),
      undefined,
    )
  })

  it('forwards X-Device-Id to publishToBusiness', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ id: INVITE_ID }, { 'x-device-id': 'dev-del-xyz' }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'team.invite.deleted', inviteId: INVITE_ID }),
      'dev-del-xyz',
    )
  })

  it('does not publish when validation fails', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({}) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(400)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })
})
