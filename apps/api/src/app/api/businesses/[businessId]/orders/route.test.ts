import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for POST /api/businesses/[businessId]/orders — realtime
 * publish assertions for `order.created`.
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

const ORDER_ID = 'order-new-test-001'

vi.mock('nanoid', () => ({ nanoid: vi.fn(() => ORDER_ID) }))

// Drizzle stubs. The route:
//   db.update(businesses).set(...).where(...).returning(...) -> [{reserved}]
//   db.batch([...]) -> resolved
//   db.select().from().where().get() -> provider | createdByUser
const dbMock = {
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([{ reserved: 1 }])),
      })),
    })),
  })),
  batch: vi.fn(async () => []),
  insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve(undefined)) })),
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        get: vi.fn(() => Promise.resolve(null)),
      })),
    })),
  })),
}

vi.mock('@/db', () => ({
  db: dbMock,
  orders: {
    id: 'orders.id',
    businessId: 'orders.business_id',
    providerId: 'orders.provider_id',
    date: 'orders.date',
  },
  orderItems: { id: 'order_items.id', orderId: 'order_items.order_id' },
  providers: { id: 'providers.id', businessId: 'providers.business_id' },
  products: {
    id: 'products.id',
    businessId: 'products.business_id',
    name: 'products.name',
    price: 'products.price',
    costPrice: 'products.cost_price',
    stock: 'products.stock',
    active: 'products.active',
  },
  businesses: {
    id: 'businesses.id',
    nextOrderNumber: 'businesses.next_order_number',
  },
  users: {
    id: 'users.id',
    name: 'users.name',
    email: 'users.email',
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

const BUSINESS_ID = 'biz-orderpost-01'
const CALLER_ID = 'user-owner-op-01'

const OWNER_ACCESS = {
  userId: CALLER_ID,
  businessId: BUSINESS_ID,
  role: 'owner' as const,
  status: 'active' as const,
}

function makePostRequest(form: Record<string, string>, headers: Record<string, string> = {}): Request {
  const fd = new FormData()
  for (const [k, v] of Object.entries(form)) fd.append(k, v)
  return new Request(
    `http://localhost:3000/api/businesses/${BUSINESS_ID}/orders`,
    {
      method: 'POST',
      headers: {
        'content-length': '200',
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        ...headers,
      },
      body: fd,
    },
  )
}

beforeEach(() => {
  publishToBusiness.mockReset()
  requireBusinessAccess.mockReset()
  assertProductsInBusiness.mockReset()
  assertProviderInBusiness.mockReset()
  requireBusinessAccess.mockResolvedValue(OWNER_ACCESS)
  publishToBusiness.mockResolvedValue(undefined)
  assertProductsInBusiness.mockResolvedValue(true)
  assertProviderInBusiness.mockResolvedValue(true)
})

const VALID_FORM = {
  date: '2026-05-19T10:00:00Z',
  total: '50.00',
  status: 'pending',
  items: JSON.stringify([
    { productId: 'prod-1', productName: 'Item A', quantity: 2, unitCost: 25 },
  ]),
}

describe('POST /api/businesses/[businessId]/orders — realtime publishes', () => {
  it('publishes order.created on happy path', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      makePostRequest(VALID_FORM) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledTimes(1)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'order.created', orderId: ORDER_ID }),
      undefined,
    )
  })

  it('forwards X-Device-Id to publishToBusiness', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      makePostRequest(VALID_FORM, { 'x-device-id': 'dev-order-new-1' }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'order.created' }),
      'dev-order-new-1',
    )
  })

  it('does not publish when caller cannot manage (403)', async () => {
    requireBusinessAccess.mockResolvedValueOnce({
      ...OWNER_ACCESS,
      role: 'employee' as const,
    })

    const { POST } = await import('./route')
    const res = await POST(
      makePostRequest(VALID_FORM) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(403)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })

  it('does not publish when items JSON is invalid (400)', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      makePostRequest({ ...VALID_FORM, items: 'not-valid-json' }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(400)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })
})
