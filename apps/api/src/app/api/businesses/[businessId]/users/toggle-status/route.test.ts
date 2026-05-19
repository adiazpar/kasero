import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for POST /api/businesses/[businessId]/users/toggle-status — realtime
 * publish assertions.
 *
 * Covers:
 *   - happy path: publishToBusiness called with team.member.status_changed
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
//   db.select().from().where().limit()  -> [{ role }]  (target membership lookup)
//   db.transaction(fn)                  -> calls fn with tx stub
const selectResults: unknown[] = []

function selectBuilder() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {}
  b.from = vi.fn(() => b)
  b.where = vi.fn(() => b)
  b.limit = vi.fn(() => Promise.resolve(selectResults.shift() ?? []))
  return b
}

function makeTxStub() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx: any = {}
  const updateBuilder = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {}
    b.set = vi.fn(() => b)
    b.where = vi.fn(() => Promise.resolve([]))
    return b
  }
  const txSelectBuilder = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {}
    b.from = vi.fn(() => b)
    b.where = vi.fn(() => b)
    // Route does .select({ email }).from(users).where(...).limit(1) inside tx
    b.limit = vi.fn(() => Promise.resolve([{ email: 'target@example.com' }]))
    return b
  }
  tx.select = vi.fn(() => txSelectBuilder())
  tx.update = vi.fn(() => updateBuilder())
  tx.delete = vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) }))
  return tx
}

const dbMock = {
  select: vi.fn(() => selectBuilder()),
  transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(makeTxStub())),
}

vi.mock('@/db', () => ({
  db: dbMock,
  businessUsers: {
    userId: 'business_users.user_id',
    businessId: 'business_users.business_id',
    role: 'business_users.role',
    status: 'business_users.status',
  },
  users: { id: 'users.id', email: 'users.email' },
  ownershipTransfers: {
    toEmail: 'ownership_transfers.to_email',
    status: 'ownership_transfers.status',
  },
}))

vi.mock('@kasero/shared/db/schema', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kasero/shared/db/schema')>()
  return { ...actual }
})

vi.mock('@/lib/api-middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-middleware')>('@/lib/api-middleware')
  return {
    ...actual,
    enforceMaxContentLength: vi.fn(() => null),
    applyRateLimit: vi.fn(async () => null),
  }
})

const BUSINESS_ID = 'biz-togglestatus001'
const CALLER_ID = 'user-owner-toggle001'
const TARGET_ID = 'user-target-toggle01'

const OWNER_ACCESS = {
  userId: CALLER_ID,
  businessId: BUSINESS_ID,
  role: 'owner' as const,
  status: 'active' as const,
}

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  const json = JSON.stringify(body)
  return new Request(`http://localhost:3000/api/businesses/${BUSINESS_ID}/users/toggle-status`, {
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
  dbMock.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(makeTxStub()))
  requireBusinessAccess.mockResolvedValue(OWNER_ACCESS)
  publishToBusiness.mockResolvedValue(undefined)
})

describe('POST /api/businesses/[businessId]/users/toggle-status — realtime publishes', () => {
  it('publishes team.member.status_changed on happy path (disable)', async () => {
    selectResults.push([{ role: 'employee' }])

    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ userId: TARGET_ID, status: 'disabled' }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledTimes(1)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({
        type: 'team.member.status_changed',
        memberId: TARGET_ID,
        status: 'disabled',
      }),
      undefined,
    )
  })

  it('publishes team.member.status_changed on happy path (activate)', async () => {
    selectResults.push([{ role: 'employee' }])

    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ userId: TARGET_ID, status: 'active' }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'team.member.status_changed', status: 'active' }),
      undefined,
    )
  })

  it('forwards X-Device-Id to publishToBusiness', async () => {
    selectResults.push([{ role: 'employee' }])

    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ userId: TARGET_ID, status: 'active' }, { 'x-device-id': 'dev-toggle-xyz' }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'team.member.status_changed' }),
      'dev-toggle-xyz',
    )
  })
})
