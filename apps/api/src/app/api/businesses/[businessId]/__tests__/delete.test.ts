import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for DELETE /api/businesses/[businessId] — realtime publish assertions.
 *
 * Mocks auth, db, and the realtime publishers. Covers:
 *   - happy path: publishCriticalToUser called per member, publishBatchedToUsers called once
 *   - 503 when publishCriticalToUser throws RealtimeUnavailableError
 *   - publishBatchedToUsers not called if critical publish fails (503 short-circuits)
 */

const publishCriticalToUser = vi.fn()
const publishBatchedToUsers = vi.fn()

vi.mock('@/lib/realtime', async (orig) => {
  const real = await orig<typeof import('@/lib/realtime')>()
  return { ...real, publishCriticalToUser, publishBatchedToUsers }
})

const requireBusinessAccess = vi.fn()

vi.mock('@/lib/business-auth', async (orig) => {
  const real = await orig<typeof import('@/lib/business-auth')>()
  return { ...real, requireBusinessAccess }
})

// Drizzle mock — the DELETE handler calls:
//   db.select().from().where().get()        -> existing business check
//   db.select().from().where() (thenable)   -> member userIds query
//   db.transaction(fn)                      -> runs fn with tx stub
const selectResults: unknown[] = []

function selectBuilder() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {}
  b.from = vi.fn(() => b)
  b.where = vi.fn(() => b)
  b.get = vi.fn(() => Promise.resolve(selectResults.shift() ?? null))
  b.then = vi.fn((resolve: (v: unknown) => void) =>
    resolve(selectResults.shift() ?? []),
  )
  return b
}

// Minimal transaction stub: just calls the callback with a tx object that
// mirrors the db stub (same select/delete chains). The DELETE handler only
// needs delete chains inside the tx.
function makeTxStub() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx: any = {}
  const deleteBuilder = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {}
    b.where = vi.fn(() => Promise.resolve([]))
    return b
  }
  const txSelectBuilder = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {}
    b.from = vi.fn(() => b)
    b.where = vi.fn(() => Promise.resolve([]))
    return b
  }
  tx.select = vi.fn(() => txSelectBuilder())
  tx.delete = vi.fn(() => deleteBuilder())
  return tx
}

const dbMock = {
  select: vi.fn(() => selectBuilder()),
  transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    return fn(makeTxStub())
  }),
}

vi.mock('@/db', () => ({
  db: dbMock,
  businesses: { id: 'businesses.id' },
  businessUsers: { userId: 'business_users.user_id', businessId: 'business_users.business_id' },
  products: { businessId: 'products.business_id' },
  productCategories: { businessId: 'product_categories.business_id' },
  providers: { businessId: 'providers.business_id' },
  providerNotes: { businessId: 'provider_notes.business_id' },
  orders: { id: 'orders.id', businessId: 'orders.business_id' },
  orderItems: { orderId: 'order_items.order_id' },
  sales: { id: 'sales.id', businessId: 'sales.business_id' },
  saleItems: { saleId: 'sale_items.sale_id' },
  salesSessions: { businessId: 'sales_sessions.business_id' },
  inviteCodes: { businessId: 'invite_codes.business_id' },
  ownershipTransfers: { businessId: 'ownership_transfers.business_id' },
}))

vi.mock('@/lib/api-middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-middleware')>('@/lib/api-middleware')
  return {
    ...actual,
    applyRateLimit: vi.fn(async () => null),
  }
})

vi.mock('@/lib/server-logger', () => ({ logServerError: vi.fn() }))

const BUSINESS_ID = 'biz-delete-realtime-001'
const MEMBER_IDS = ['user-owner-del01', 'user-member-a01', 'user-member-b01']

const OWNER_ACCESS = {
  userId: MEMBER_IDS[0],
  businessId: BUSINESS_ID,
  role: 'owner' as const,
  status: 'active' as const,
}

function makeDeleteRequest(headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost:3000/api/businesses/${BUSINESS_ID}`, {
    method: 'DELETE',
    headers: {
      'content-length': '0',
      origin: 'http://localhost:3000',
      host: 'localhost:3000',
      ...headers,
    },
  })
}

beforeEach(() => {
  publishCriticalToUser.mockReset()
  publishBatchedToUsers.mockReset()
  selectResults.length = 0
  dbMock.select.mockImplementation(() => selectBuilder())
  dbMock.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    return fn(makeTxStub())
  })
  requireBusinessAccess.mockResolvedValue(OWNER_ACCESS)

  // Default: publishCriticalToUser resolves (no error)
  publishCriticalToUser.mockResolvedValue(undefined)
  publishBatchedToUsers.mockResolvedValue(undefined)
})

describe('DELETE /api/businesses/[businessId] — realtime publishes', () => {
  it('calls publishCriticalToUser once per member with session.revoked on happy path', async () => {
    // First select: existing business check
    selectResults.push({ id: BUSINESS_ID })
    // Second select (thenable): member userIds
    selectResults.push(MEMBER_IDS.map((id) => ({ userId: id })))

    const { DELETE } = await import('../route')
    const res = await DELETE(
      makeDeleteRequest() as Parameters<typeof DELETE>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishCriticalToUser).toHaveBeenCalledTimes(MEMBER_IDS.length)
    for (const userId of MEMBER_IDS) {
      expect(publishCriticalToUser).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          type: 'session.revoked',
          businessId: BUSINESS_ID,
          reason: 'business_deleted',
        }),
        undefined,
      )
    }
  })

  it('calls publishBatchedToUsers once with all member IDs on happy path', async () => {
    selectResults.push({ id: BUSINESS_ID })
    selectResults.push(MEMBER_IDS.map((id) => ({ userId: id })))

    const { DELETE } = await import('../route')
    const res = await DELETE(
      makeDeleteRequest() as Parameters<typeof DELETE>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishBatchedToUsers).toHaveBeenCalledTimes(1)
    expect(publishBatchedToUsers).toHaveBeenCalledWith(
      expect.arrayContaining(MEMBER_IDS),
      expect.objectContaining({ type: 'business.list.changed', reason: 'removed' }),
      undefined,
    )
  })

  it('forwards X-Device-Id to publishCriticalToUser and publishBatchedToUsers', async () => {
    selectResults.push({ id: BUSINESS_ID })
    selectResults.push([{ userId: 'user-owner' }])

    const { DELETE } = await import('../route')
    const res = await DELETE(
      makeDeleteRequest({ 'x-device-id': 'dev-xyz' }) as Parameters<typeof DELETE>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishCriticalToUser).toHaveBeenCalledWith(
      'user-owner',
      expect.objectContaining({ type: 'session.revoked' }),
      'dev-xyz',
    )
    expect(publishBatchedToUsers).toHaveBeenCalledWith(
      expect.arrayContaining(['user-owner']),
      expect.objectContaining({ type: 'business.list.changed', reason: 'removed' }),
      'dev-xyz',
    )
  })

  it('returns 503 REALTIME_PUBLISH_UNAVAILABLE when publishCriticalToUser throws', async () => {
    const { RealtimeUnavailableError } = await import('@/lib/realtime')

    selectResults.push({ id: BUSINESS_ID })
    selectResults.push(MEMBER_IDS.map((id) => ({ userId: id })))

    publishCriticalToUser.mockRejectedValue(new RealtimeUnavailableError('redis down'))

    const { DELETE } = await import('../route')
    const res = await DELETE(
      makeDeleteRequest() as Parameters<typeof DELETE>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(503)
    const body = await res.json() as { messageCode: string }
    expect(body.messageCode).toBe('REALTIME_PUBLISH_UNAVAILABLE')
  })

  it('does NOT call publishBatchedToUsers when critical publish fails', async () => {
    const { RealtimeUnavailableError } = await import('@/lib/realtime')

    selectResults.push({ id: BUSINESS_ID })
    selectResults.push([{ userId: 'user-owner' }])

    publishCriticalToUser.mockRejectedValue(new RealtimeUnavailableError('redis down'))

    const { DELETE } = await import('../route')
    await DELETE(
      makeDeleteRequest() as Parameters<typeof DELETE>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(publishBatchedToUsers).not.toHaveBeenCalled()
  })
})
