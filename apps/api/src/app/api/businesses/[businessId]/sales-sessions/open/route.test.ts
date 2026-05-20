import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for POST /api/businesses/[businessId]/sales-sessions/open —
 * realtime publish assertions for `sales_session.opened`.
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

// Drizzle insert mock — happy path resolves; the route returns 200.
const insertImpl = vi.fn(() => ({
  values: vi.fn(() => Promise.resolve(undefined)),
}))

const dbMock = {
  insert: vi.fn(() => insertImpl()),
}

vi.mock('@/db', () => ({
  db: dbMock,
  salesSessions: {
    id: 'sales_sessions.id',
    businessId: 'sales_sessions.business_id',
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

const SESSION_ID = 'sess-open-test-01'
vi.mock('nanoid', () => ({ nanoid: vi.fn(() => SESSION_ID) }))

const BUSINESS_ID = 'biz-sess-open-01'
const CALLER_ID = 'user-owner-sess-01'

const OWNER_ACCESS = {
  userId: CALLER_ID,
  businessId: BUSINESS_ID,
  role: 'owner' as const,
  status: 'active' as const,
}

function makePostRequest(body: unknown, headers: Record<string, string> = {}): Request {
  const json = JSON.stringify(body)
  return new Request(
    `http://localhost:3000/api/businesses/${BUSINESS_ID}/sales-sessions/open`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(json.length),
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        ...headers,
      },
      body: json,
    },
  )
}

beforeEach(() => {
  publishToBusiness.mockReset()
  dbMock.insert.mockImplementation(() => insertImpl())
  insertImpl.mockClear()
  requireBusinessAccess.mockResolvedValue(OWNER_ACCESS)
  publishToBusiness.mockResolvedValue(undefined)
})

describe('POST /api/businesses/[businessId]/sales-sessions/open — realtime publishes', () => {
  it('publishes sales_session.opened on happy path', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      makePostRequest({ startingCash: 100 }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledTimes(1)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'sales_session.opened', sessionId: SESSION_ID }),
      undefined,
    )
  })

  it('forwards X-Device-Id to publishToBusiness', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      makePostRequest({ startingCash: 50 }, { 'x-device-id': 'dev-sess-abc' }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'sales_session.opened' }),
      'dev-sess-abc',
    )
  })

  it('does not publish when another session is already open (409)', async () => {
    // Mimic the SQLite UNIQUE constraint that fires when a second open
    // session is inserted; route catches and returns 409.
    insertImpl.mockImplementationOnce(() => ({
      values: vi.fn(() =>
        Promise.reject(new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed')),
      ),
    }))

    const { POST } = await import('./route')
    const res = await POST(
      makePostRequest({ startingCash: 100 }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(409)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })

  it('does not publish when caller is not a manager (403)', async () => {
    requireBusinessAccess.mockResolvedValueOnce({
      ...OWNER_ACCESS,
      role: 'employee' as const,
    })

    const { POST } = await import('./route')
    const res = await POST(
      makePostRequest({ startingCash: 100 }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(403)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })
})
