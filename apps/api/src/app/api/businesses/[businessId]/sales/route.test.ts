import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for POST /api/businesses/[businessId]/sales — realtime
 * publish assertions for `sale.created`.
 *
 * The full POST path runs an async transaction that claims the open
 * session, reserves a sale_number, inserts the sale + items, and
 * decrements stock per line. These tests mock the transaction
 * coarse-grained so we can assert publish behavior at the route level
 * without exercising the SQLite write path.
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

const SALE_ID = 'sale-new-test-001'
vi.mock('nanoid', () => ({ nanoid: vi.fn(() => SALE_ID) }))

// productsList drives the pre-transaction product validation. Set per-test.
let productsList: Array<{
  id: string
  name: string
  price: number
  active: boolean
  stock: number | null
}> = []
// claimRows controls the open-session CAS. Empty triggers SESSION_NOT_OPEN.
let sessionClaim: Array<{ id: string }> = []

const dbMock = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(productsList)),
    })),
  })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transaction: vi.fn(async (cb: (tx: any) => Promise<unknown>) => {
    return cb({
      // session-claim update
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(() => ({
              all: vi.fn(() => Promise.resolve(sessionClaim)),
            })),
          })),
        })),
      })),
      insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve(undefined)) })),
    })
  }),
}

// The route's transaction does multiple operations in sequence — claim,
// reserve (update businesses), insert sale/items, update products. The
// stub above returns the same builder for every `update()` call; this
// works because each chain ends in either `.all()` for the claim or
// terminates with a query promise. We tighten the claim mock by giving
// the tx an additional update path that returns the reservation row for
// the second update call. Implemented as a counter on the tx.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
dbMock.transaction.mockImplementation(async (cb: (tx: any) => Promise<unknown>) => {
  let updateCallCount = 0
  return cb({
    update: vi.fn(() => {
      const callIndex = updateCallCount++
      return {
        set: vi.fn(() => ({
          where: vi.fn(() => {
            const builder = {
              returning: vi.fn(() => {
                if (callIndex === 0) {
                  // session claim
                  return {
                    all: vi.fn(() => Promise.resolve(sessionClaim)),
                  }
                }
                if (callIndex === 1) {
                  // sale-number reservation
                  return Promise.resolve([{ reserved: 1 }])
                }
                return Promise.resolve([])
              }),
              // for the stock-decrement update which doesn't chain .returning()
              then: (resolve: (v: unknown) => void) => resolve(undefined),
            }
            return builder
          }),
        })),
      }
    }),
    insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve(undefined)) })),
  })
})

vi.mock('@/db', () => ({
  db: dbMock,
  sales: { id: 'sales.id', businessId: 'sales.business_id' },
  saleItems: { id: 'sale_items.id', saleId: 'sale_items.sale_id' },
  products: {
    id: 'products.id',
    businessId: 'products.business_id',
    name: 'products.name',
    price: 'products.price',
    active: 'products.active',
    stock: 'products.stock',
  },
  businesses: {
    id: 'businesses.id',
    nextSaleNumber: 'businesses.next_sale_number',
  },
  salesSessions: {
    id: 'sales_sessions.id',
    businessId: 'sales_sessions.business_id',
    openedAt: 'sales_sessions.opened_at',
    closedAt: 'sales_sessions.closed_at',
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

const BUSINESS_ID = 'biz-salepost-01'
const CALLER_ID = 'user-staff-sale-01'

const ACCESS = {
  userId: CALLER_ID,
  businessId: BUSINESS_ID,
  businessCurrency: 'USD',
  role: 'employee' as const,
  status: 'active' as const,
}

function makePostRequest(body: unknown, headers: Record<string, string> = {}): Request {
  const json = JSON.stringify(body)
  return new Request(
    `http://localhost:3000/api/businesses/${BUSINESS_ID}/sales`,
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

const VALID_BODY = {
  paymentMethod: 'cash' as const,
  items: [{ productId: 'prod-1', quantity: 2 }],
}

beforeEach(() => {
  publishToBusiness.mockReset()
  requireBusinessAccess.mockReset()
  productsList = [
    { id: 'prod-1', name: 'Coffee', price: 5, active: true, stock: 100 },
  ]
  sessionClaim = [{ id: 'sess-open-1' }]
  requireBusinessAccess.mockResolvedValue(ACCESS)
  publishToBusiness.mockResolvedValue(undefined)
})

describe('POST /api/businesses/[businessId]/sales — realtime publishes', () => {
  it('publishes sale.created on happy path', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      makePostRequest(VALID_BODY) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledTimes(1)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'sale.created', saleId: SALE_ID }),
      undefined,
    )
  })

  it('forwards X-Device-Id to publishToBusiness', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      makePostRequest(VALID_BODY, { 'x-device-id': 'dev-sale-1' }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'sale.created' }),
      'dev-sale-1',
    )
  })

  it('does not publish when the product is not found (400)', async () => {
    productsList = [] // no matching product

    const { POST } = await import('./route')
    const res = await POST(
      makePostRequest(VALID_BODY) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(400)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })

  it('does not publish when stock is insufficient (409)', async () => {
    productsList = [
      { id: 'prod-1', name: 'Coffee', price: 5, active: true, stock: 1 },
    ]

    const { POST } = await import('./route')
    const res = await POST(
      makePostRequest({
        ...VALID_BODY,
        items: [{ productId: 'prod-1', quantity: 99 }],
      }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(409)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })

  it('does not publish when no session is open (409)', async () => {
    sessionClaim = []

    const { POST } = await import('./route')
    const res = await POST(
      makePostRequest(VALID_BODY) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(409)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })
})
