import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for PATCH and DELETE /api/businesses/[businessId]/orders/[id] —
 * realtime publish assertions for `order.updated` (with field tracking)
 * and `order.deleted`.
 */

const publishToBusiness = vi.fn()

vi.mock('@/lib/realtime', async (orig) => {
  const real = await orig<typeof import('@/lib/realtime')>()
  return { ...real, publishToBusiness }
})

const requireBusinessAccess = vi.fn()
const assertProductsInBusiness = vi.fn(async () => true)
const assertProviderInBusiness = vi.fn(async () => true)

vi.mock('@/lib/business-auth', async (orig) => {
  const real = await orig<typeof import('@/lib/business-auth')>()
  return {
    ...real,
    requireBusinessAccess,
    assertProductsInBusiness,
    assertProviderInBusiness,
  }
})

// Drizzle mocks.
//   PATCH:
//     db.select().from().where().limit() -> [existingOrder]
//     db.batch([...]) -> resolved with each statement result
//   DELETE:
//     db.select().from().where().limit() -> [existingOrder]
//     db.delete().where() -> resolved
const selectResults: unknown[] = []

function selectBuilder() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {}
  b.from = vi.fn(() => b)
  b.where = vi.fn(() => b)
  b.limit = vi.fn(() => Promise.resolve(selectResults.shift() ?? []))
  return b
}

const dbMock = {
  select: vi.fn(() => selectBuilder()),
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(undefined)),
    })),
  })),
  delete: vi.fn(() => ({
    where: vi.fn(() => Promise.resolve(undefined)),
  })),
  insert: vi.fn(() => ({
    values: vi.fn(() => Promise.resolve(undefined)),
  })),
  batch: vi.fn(async () => []),
}

vi.mock('@/db', () => ({
  db: dbMock,
  orders: {
    id: 'orders.id',
    businessId: 'orders.business_id',
  },
  orderItems: {
    id: 'order_items.id',
    orderId: 'order_items.order_id',
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

vi.mock('nanoid', () => ({ nanoid: vi.fn(() => 'item-nanoid-fixed') }))

const BUSINESS_ID = 'biz-orders-pdtest-01'
const ORDER_ID = 'order-pd-test-001'
const CALLER_ID = 'user-owner-od-01'

const OWNER_ACCESS = {
  userId: CALLER_ID,
  businessId: BUSINESS_ID,
  role: 'owner' as const,
  status: 'active' as const,
}

const EXISTING_ORDER_ROW = {
  id: ORDER_ID,
  businessId: BUSINESS_ID,
  status: 'pending',
  total: 100,
  providerId: null,
  estimatedArrival: null,
}

function makePatchRequest(form: Record<string, string>, headers: Record<string, string> = {}): Request {
  const fd = new FormData()
  for (const [k, v] of Object.entries(form)) fd.append(k, v)
  return new Request(
    `http://localhost:3000/api/businesses/${BUSINESS_ID}/orders/${ORDER_ID}`,
    {
      method: 'PATCH',
      headers: {
        // Required by withBusinessAuth's enforceContentLength on non-GET
        // requests. The exact value doesn't matter for these unit tests —
        // the middleware just needs the header to be present.
        'content-length': '100',
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        ...headers,
      },
      body: fd,
    },
  )
}

function makeDeleteRequest(headers: Record<string, string> = {}): Request {
  return new Request(
    `http://localhost:3000/api/businesses/${BUSINESS_ID}/orders/${ORDER_ID}`,
    {
      method: 'DELETE',
      headers: {
        'content-length': '0',
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        ...headers,
      },
    },
  )
}

beforeEach(() => {
  publishToBusiness.mockReset()
  requireBusinessAccess.mockReset()
  assertProductsInBusiness.mockReset()
  assertProviderInBusiness.mockReset()
  selectResults.length = 0
  dbMock.select.mockImplementation(() => selectBuilder())
  dbMock.batch.mockClear()
  requireBusinessAccess.mockResolvedValue(OWNER_ACCESS)
  publishToBusiness.mockResolvedValue(undefined)
  assertProductsInBusiness.mockResolvedValue(true)
  assertProviderInBusiness.mockResolvedValue(true)
})

describe('PATCH /api/businesses/[businessId]/orders/[id] — realtime publishes', () => {
  it('publishes order.updated with the touched fields on happy path', async () => {
    selectResults.push([EXISTING_ORDER_ROW])

    const { PATCH } = await import('./route')
    const res = await PATCH(
      makePatchRequest({ total: '150', estimatedArrival: '2026-06-01' }) as Parameters<typeof PATCH>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID, id: ORDER_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledTimes(1)
    const [, payload, originDeviceId] = publishToBusiness.mock.calls[0]
    expect(payload).toMatchObject({
      type: 'order.updated',
      orderId: ORDER_ID,
    })
    expect(payload.fields).toEqual(expect.arrayContaining(['total', 'estimatedArrival']))
    expect(originDeviceId).toBeUndefined()
  })

  it('forwards X-Device-Id to publishToBusiness', async () => {
    selectResults.push([EXISTING_ORDER_ROW])

    const { PATCH } = await import('./route')
    const res = await PATCH(
      makePatchRequest({ total: '200' }, { 'x-device-id': 'dev-orderupd-1' }) as Parameters<typeof PATCH>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID, id: ORDER_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'order.updated', orderId: ORDER_ID }),
      'dev-orderupd-1',
    )
  })

  it('does not publish when order is not found (404)', async () => {
    selectResults.push([])

    const { PATCH } = await import('./route')
    const res = await PATCH(
      makePatchRequest({ total: '200' }) as Parameters<typeof PATCH>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID, id: ORDER_ID }) },
    )

    expect(res.status).toBe(404)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })

  it('does not publish when caller cannot manage (403)', async () => {
    requireBusinessAccess.mockResolvedValueOnce({
      ...OWNER_ACCESS,
      role: 'employee' as const,
    })

    const { PATCH } = await import('./route')
    const res = await PATCH(
      makePatchRequest({ total: '200' }) as Parameters<typeof PATCH>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID, id: ORDER_ID }) },
    )

    expect(res.status).toBe(403)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })

  it('does not publish when the order has already been received (400)', async () => {
    selectResults.push([{ ...EXISTING_ORDER_ROW, status: 'received' }])

    const { PATCH } = await import('./route')
    const res = await PATCH(
      makePatchRequest({ total: '200' }) as Parameters<typeof PATCH>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID, id: ORDER_ID }) },
    )

    expect(res.status).toBe(400)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })

  it('does not publish when the PATCH body changes nothing (no fields)', async () => {
    selectResults.push([EXISTING_ORDER_ROW])

    const { PATCH } = await import('./route')
    const res = await PATCH(
      makePatchRequest({}) as Parameters<typeof PATCH>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID, id: ORDER_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/businesses/[businessId]/orders/[id] — realtime publishes', () => {
  it('publishes order.deleted on happy path', async () => {
    selectResults.push([EXISTING_ORDER_ROW])

    const { DELETE } = await import('./route')
    const res = await DELETE(
      makeDeleteRequest() as Parameters<typeof DELETE>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID, id: ORDER_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledTimes(1)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'order.deleted', orderId: ORDER_ID }),
      undefined,
    )
  })

  it('forwards X-Device-Id to publishToBusiness', async () => {
    selectResults.push([EXISTING_ORDER_ROW])

    const { DELETE } = await import('./route')
    const res = await DELETE(
      makeDeleteRequest({ 'x-device-id': 'dev-orderdel-1' }) as Parameters<typeof DELETE>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID, id: ORDER_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'order.deleted', orderId: ORDER_ID }),
      'dev-orderdel-1',
    )
  })

  it('does not publish when order is not found (404)', async () => {
    selectResults.push([])

    const { DELETE } = await import('./route')
    const res = await DELETE(
      makeDeleteRequest() as Parameters<typeof DELETE>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID, id: ORDER_ID }) },
    )

    expect(res.status).toBe(404)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })

  it('does not publish when caller cannot manage (403)', async () => {
    requireBusinessAccess.mockResolvedValueOnce({
      ...OWNER_ACCESS,
      role: 'employee' as const,
    })

    const { DELETE } = await import('./route')
    const res = await DELETE(
      makeDeleteRequest() as Parameters<typeof DELETE>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID, id: ORDER_ID }) },
    )

    expect(res.status).toBe(403)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })
})
