import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for POST /api/businesses/[businessId]/orders/[id]/receive —
 * realtime publish assertions for `order.received`.
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

// Drizzle mocks. The route:
//   db.select().from().where().limit() -> [existingOrder]
//   db.select().from().where()         -> items list (then-able)
//   db.transaction(cb)                 -> happy: returns; throws OrderAlreadyReceivedError on race
const selectResults: unknown[] = []

function selectBuilder() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {}
  b.from = vi.fn(() => b)
  b.where = vi.fn(() => b)
  b.limit = vi.fn(() => Promise.resolve(selectResults.shift() ?? []))
  b.then = vi.fn((resolve: (v: unknown) => void) => resolve(selectResults.shift() ?? []))
  return b
}

const dbMock = {
  select: vi.fn(() => selectBuilder()),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transaction: vi.fn(async (cb: (tx: any) => Promise<unknown>) => {
    // Provide a tx that lets the route's atomic claim + stock bumps run.
    // claimRows is set per-test to control the receive vs already-received branch.
    return cb({
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(() => ({
              all: vi.fn(() => Promise.resolve(claimRows)),
            })),
          })),
        })),
      })),
    })
  }),
}

let claimRows: Array<{ id: string }> = []

vi.mock('@/db', () => ({
  db: dbMock,
  orders: {
    id: 'orders.id',
    businessId: 'orders.business_id',
    status: 'orders.status',
  },
  orderItems: {
    id: 'order_items.id',
    orderId: 'order_items.order_id',
    productId: 'order_items.product_id',
  },
  products: {
    id: 'products.id',
    businessId: 'products.business_id',
    stock: 'products.stock',
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

const BUSINESS_ID = 'biz-orderrcv-01'
const ORDER_ID = 'order-rcv-test-001'
const CALLER_ID = 'user-staff-rcv-01'

const ACCESS = {
  userId: CALLER_ID,
  businessId: BUSINESS_ID,
  role: 'employee' as const,
  status: 'active' as const,
}

function makePostRequest(body: unknown, headers: Record<string, string> = {}): Request {
  const json = JSON.stringify(body)
  return new Request(
    `http://localhost:3000/api/businesses/${BUSINESS_ID}/orders/${ORDER_ID}/receive`,
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
  requireBusinessAccess.mockReset()
  selectResults.length = 0
  claimRows = [{ id: ORDER_ID }]
  dbMock.select.mockImplementation(() => selectBuilder())
  requireBusinessAccess.mockResolvedValue(ACCESS)
  publishToBusiness.mockResolvedValue(undefined)
})

const VALID_BODY = { receivedQuantities: { 'item-1': 5 } }

describe('POST /api/businesses/[businessId]/orders/[id]/receive — realtime publishes', () => {
  it('publishes order.received on happy path', async () => {
    selectResults.push([{ id: ORDER_ID, businessId: BUSINESS_ID, status: 'pending' }])
    selectResults.push([{ id: 'item-1', orderId: ORDER_ID, productId: 'prod-1', quantity: 5 }])

    const { POST } = await import('./route')
    const res = await POST(
      makePostRequest(VALID_BODY) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID, id: ORDER_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledTimes(1)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'order.received', orderId: ORDER_ID }),
      undefined,
    )
  })

  it('forwards X-Device-Id to publishToBusiness', async () => {
    selectResults.push([{ id: ORDER_ID, businessId: BUSINESS_ID, status: 'pending' }])
    selectResults.push([])

    const { POST } = await import('./route')
    const res = await POST(
      makePostRequest(VALID_BODY, { 'x-device-id': 'dev-rcv-xyz' }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID, id: ORDER_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'order.received', orderId: ORDER_ID }),
      'dev-rcv-xyz',
    )
  })

  it('does not publish when order is not found (404)', async () => {
    selectResults.push([])

    const { POST } = await import('./route')
    const res = await POST(
      makePostRequest(VALID_BODY) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID, id: ORDER_ID }) },
    )

    expect(res.status).toBe(404)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })

  it('does not publish when the atomic claim fails (409 — already received)', async () => {
    selectResults.push([{ id: ORDER_ID, businessId: BUSINESS_ID, status: 'pending' }])
    selectResults.push([])
    // Empty claim -> route throws OrderAlreadyReceivedError -> 409
    claimRows = []

    const { POST } = await import('./route')
    const res = await POST(
      makePostRequest(VALID_BODY) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID, id: ORDER_ID }) },
    )

    expect(res.status).toBe(409)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })
})
