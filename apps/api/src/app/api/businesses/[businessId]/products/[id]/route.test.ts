import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for /api/businesses/[businessId]/products/[id] — realtime
 * publish assertions for DELETE.
 *
 * PATCH is covered by an integration-style happy-path assertion; the
 * FormData parsing + barcode cascade + icon-sniff stack makes exhaustive
 * unit coverage of PATCH-with-realtime impractical here, so we rely on
 * the route-level type safety of the publishToBusiness call. DELETE is
 * straightforward and gets the standard treatment.
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

// Storage mock — DELETE calls deleteProductIcon.
vi.mock('@/lib/storage', () => ({
  uploadProductIcon: vi.fn(),
  deleteProductIcon: vi.fn(async () => undefined),
  validateIconSize: vi.fn(() => ({ valid: true })),
}))

// Drizzle mocks. DELETE path:
//   db.select().from().where().limit() -> [{ ... existing product ... }]
//   db.delete().where() -> void
const selectResults: unknown[] = []

function selectBuilder() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {}
  b.from = vi.fn(() => b)
  b.innerJoin = vi.fn(() => b)
  b.where = vi.fn(() => b)
  b.limit = vi.fn(() => Promise.resolve(selectResults.shift() ?? []))
  return b
}

const deleteImpl = vi.fn(() => ({
  where: vi.fn(() => Promise.resolve([])),
}))

const dbMock = {
  select: vi.fn(() => selectBuilder()),
  delete: vi.fn(() => deleteImpl()),
}

vi.mock('@/db', () => ({
  db: dbMock,
  products: {
    id: 'products.id',
    businessId: 'products.business_id',
    icon: 'products.icon',
  },
  orderItems: {
    productId: 'order_items.product_id',
    orderId: 'order_items.order_id',
  },
  orders: {
    id: 'orders.id',
    status: 'orders.status',
    businessId: 'orders.business_id',
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

const BUSINESS_ID = 'biz-proddel-test01'
const CALLER_ID = 'user-owner-pdel0001'
const PRODUCT_ID = 'prod-to-delete-001'

const OWNER_ACCESS = {
  userId: CALLER_ID,
  businessId: BUSINESS_ID,
  role: 'owner' as const,
  status: 'active' as const,
}

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request(
    `http://localhost:3000/api/businesses/${BUSINESS_ID}/products/${PRODUCT_ID}`,
    {
      method: 'DELETE',
      headers: {
        // The shared withBusinessAuth wrapper enforces Content-Length on
        // every non-GET/HEAD request — DELETE included. Without this the
        // request short-circuits with a 411 and never reaches the route.
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
  selectResults.length = 0
  deleteImpl.mockClear()
  dbMock.select.mockImplementation(() => selectBuilder())
  dbMock.delete.mockImplementation(() => deleteImpl())
  requireBusinessAccess.mockResolvedValue(OWNER_ACCESS)
  publishToBusiness.mockResolvedValue(undefined)
})

describe('DELETE /api/businesses/[businessId]/products/[id] — realtime publishes', () => {
  it('publishes product.deleted on happy path', async () => {
    // Select: existing product row.
    selectResults.push([{ id: PRODUCT_ID, icon: null }])

    const { DELETE } = await import('./route')
    const res = await DELETE(
      makeRequest() as Parameters<typeof DELETE>[0],
      {
        params: Promise.resolve({
          businessId: BUSINESS_ID,
          id: PRODUCT_ID,
        }),
      },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledTimes(1)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({
        type: 'product.deleted',
        productId: PRODUCT_ID,
      }),
      undefined,
    )
  })

  it('forwards X-Device-Id to publishToBusiness', async () => {
    selectResults.push([{ id: PRODUCT_ID, icon: null }])
    selectResults.push([])

    const { DELETE } = await import('./route')
    const res = await DELETE(
      makeRequest({ 'x-device-id': 'dev-pdel-xyz' }) as Parameters<typeof DELETE>[0],
      {
        params: Promise.resolve({
          businessId: BUSINESS_ID,
          id: PRODUCT_ID,
        }),
      },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'product.deleted', productId: PRODUCT_ID }),
      'dev-pdel-xyz',
    )
  })

  it('does not publish when product is not found (404)', async () => {
    // First select returns empty -> 404.
    selectResults.push([])

    const { DELETE } = await import('./route')
    const res = await DELETE(
      makeRequest() as Parameters<typeof DELETE>[0],
      {
        params: Promise.resolve({
          businessId: BUSINESS_ID,
          id: PRODUCT_ID,
        }),
      },
    )

    expect(res.status).toBe(404)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })

})
