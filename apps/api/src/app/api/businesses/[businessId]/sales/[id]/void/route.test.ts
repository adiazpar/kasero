import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for POST /api/businesses/[businessId]/sales/[id]/void.
 *
 * The route runs a transaction: CAS status flip (completed -> voided),
 * line-item read, and a single CASE UPDATE restoring stock. The db mock
 * is coarse-grained (same style as the sales POST test) — we drive the
 * CAS result and item rows per test and assert route-level behavior:
 * status codes, publish shape, and that the stock-restore UPDATE ran.
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

const SALE_ID = 'sale-void-test-001'
const BUSINESS_ID = 'biz-void-test-01'
const CALLER_ID = 'user-manager-void-01'

// claimRows drives the CAS update: empty -> not-completed path.
let claimRows: Array<Record<string, unknown>> = []
// existingRow drives the 404-vs-409 disambiguation select.
let existingRow: { status: string } | undefined
// itemRows are the sale's line items for stock restoration.
let itemRows: Array<{ productId: string | null; quantity: number }> = []
// Captured calls to the stock-restore update.
let stockUpdateCalls = 0

const VOIDED_ROW = {
  id: SALE_ID,
  saleNumber: 7,
  sessionId: 'sess-1',
  date: new Date('2026-07-01T12:00:00Z'),
  total: 25,
  paymentMethod: 'cash',
  notes: null,
  status: 'voided',
  voidedAt: new Date('2026-07-02T09:00:00Z'),
  voidedBy: CALLER_ID,
  discountAmount: 0,
  taxRate: 0,
  taxAmount: 0,
  taxMode: 'none',
  createdByUserId: 'user-staff-1',
  createdAt: new Date('2026-07-01T12:00:00Z'),
}

const dbMock = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transaction: vi.fn(async (cb: (tx: any) => Promise<unknown>) => {
    let updateCallCount = 0
    return cb({
      update: vi.fn(() => {
        const callIndex = updateCallCount++
        return {
          set: vi.fn(() => ({
            where: vi.fn(() => {
              if (callIndex === 0) {
                // CAS status flip
                return {
                  returning: vi.fn(() => ({
                    all: vi.fn(() => Promise.resolve(claimRows)),
                  })),
                }
              }
              // stock-restore CASE update (no .returning())
              stockUpdateCalls += 1
              return Promise.resolve(undefined)
            }),
          })),
        }
      }),
      select: vi.fn(() => ({
        from: vi.fn(() => {
          const builder = {
            where: vi.fn(() => ({
              // 404/409 disambiguation path
              get: vi.fn(() => Promise.resolve(existingRow)),
              // saleItems select resolves as a promise of rows
              then: (resolve: (v: unknown) => void) => resolve(itemRows),
            })),
          }
          return builder
        }),
      })),
    })
  }),
}

vi.mock('@/db', () => ({
  db: dbMock,
  sales: {
    id: 'sales.id',
    businessId: 'sales.business_id',
    status: 'sales.status',
  },
  saleItems: {
    saleId: 'sale_items.sale_id',
    productId: 'sale_items.product_id',
    quantity: 'sale_items.quantity',
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

const MANAGER_ACCESS = {
  userId: CALLER_ID,
  businessId: BUSINESS_ID,
  businessName: 'Void Biz',
  businessIcon: null,
  businessLocale: 'en-US',
  businessCurrency: 'USD',
  businessTaxRate: 0,
  businessTaxMode: 'none' as const,
  role: 'partner' as const,
}

function makeRequest(headers: Record<string, string> = {}): Request {
  const json = '{}'
  return new Request(
    `http://localhost:3000/api/businesses/${BUSINESS_ID}/sales/${SALE_ID}/void`,
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

const ROUTE_PARAMS = {
  params: Promise.resolve({ businessId: BUSINESS_ID, id: SALE_ID }),
}

beforeEach(() => {
  dbMock.transaction.mockClear()
  publishToBusiness.mockReset().mockResolvedValue(undefined)
  requireBusinessAccess.mockReset().mockResolvedValue(MANAGER_ACCESS)
  claimRows = [VOIDED_ROW]
  existingRow = undefined
  itemRows = [
    { productId: 'prod-1', quantity: 2 },
    { productId: 'prod-2', quantity: 1 },
  ]
  stockUpdateCalls = 0
})

describe('POST /api/businesses/[businessId]/sales/[id]/void', () => {
  it('voids a completed sale, restores stock, and publishes sale.voided', async () => {
    const { POST } = await import('./route')
    const res = await POST(makeRequest() as Parameters<typeof POST>[0], ROUTE_PARAMS)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.sale.status).toBe('voided')
    expect(body.sale.voidedBy).toBe(CALLER_ID)
    expect(body.messageCode).toBe('SALE_VOIDED')
    // The stock-restore CASE update ran exactly once for the whole sale.
    expect(stockUpdateCalls).toBe(1)
    expect(publishToBusiness).toHaveBeenCalledTimes(1)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'sale.voided', saleId: SALE_ID }),
      undefined,
    )
  })

  it('forwards X-Device-Id to publishToBusiness', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ 'x-device-id': 'dev-void-1' }) as Parameters<typeof POST>[0],
      ROUTE_PARAMS,
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'sale.voided' }),
      'dev-void-1',
    )
  })

  it('skips the stock update when every line item lost its product', async () => {
    itemRows = [{ productId: null, quantity: 3 }]

    const { POST } = await import('./route')
    const res = await POST(makeRequest() as Parameters<typeof POST>[0], ROUTE_PARAMS)

    expect(res.status).toBe(200)
    expect(stockUpdateCalls).toBe(0)
    expect(publishToBusiness).toHaveBeenCalledTimes(1)
  })

  it('returns 409 SALE_ALREADY_VOIDED when the sale was already voided', async () => {
    claimRows = []
    existingRow = { status: 'voided' }

    const { POST } = await import('./route')
    const res = await POST(makeRequest() as Parameters<typeof POST>[0], ROUTE_PARAMS)
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.messageCode).toBe('SALE_ALREADY_VOIDED')
    expect(stockUpdateCalls).toBe(0)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })

  it('returns 404 SALE_NOT_FOUND when the sale does not exist in this business', async () => {
    claimRows = []
    existingRow = undefined

    const { POST } = await import('./route')
    const res = await POST(makeRequest() as Parameters<typeof POST>[0], ROUTE_PARAMS)
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.messageCode).toBe('SALE_NOT_FOUND')
    expect(publishToBusiness).not.toHaveBeenCalled()
  })

  it('returns 403 for employees (role denied, nothing runs)', async () => {
    requireBusinessAccess.mockResolvedValue({
      ...MANAGER_ACCESS,
      role: 'employee' as const,
    })

    const { POST } = await import('./route')
    const res = await POST(makeRequest() as Parameters<typeof POST>[0], ROUTE_PARAMS)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.messageCode).toBe('SALE_VOID_FORBIDDEN_NOT_MANAGER')
    expect(dbMock.transaction).not.toHaveBeenCalled()
    expect(publishToBusiness).not.toHaveBeenCalled()
  })
})
