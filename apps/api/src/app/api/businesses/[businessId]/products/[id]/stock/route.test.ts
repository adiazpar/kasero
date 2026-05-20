import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for PATCH /api/businesses/[businessId]/products/[id]/stock —
 * realtime publish assertions.
 *
 * Covers:
 *   - happy path delta: publishToBusiness called with product.updated stock
 *   - happy path optimistic-set: publishToBusiness called
 *   - X-Device-Id forwarded
 *   - no publish when DB rejects the update (409)
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

// The route is two queries:
//   1. SELECT product (existence + ownership check)
//   2. UPDATE products SET stock = ... WHERE ... .returning({ stock })
//
// Mocking strategy: a queue of select results plus a returning array
// for the UPDATE. The .returning result drives the happy/409 split.
const selectResults: unknown[] = []
let updateReturning: Array<{ stock: number }> = []

function selectBuilder() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {}
  b.from = vi.fn(() => b)
  b.where = vi.fn(() => b)
  b.limit = vi.fn(() => Promise.resolve(selectResults.shift() ?? []))
  return b
}

function updateBuilder() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {}
  b.set = vi.fn(() => b)
  b.where = vi.fn(() => b)
  b.returning = vi.fn(() => Promise.resolve(updateReturning))
  return b
}

const dbMock = {
  select: vi.fn(() => selectBuilder()),
  update: vi.fn(() => updateBuilder()),
}

vi.mock('@/db', () => ({
  db: dbMock,
  products: {
    id: 'products.id',
    businessId: 'products.business_id',
    stock: 'products.stock',
    updatedAt: 'products.updated_at',
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

const BUSINESS_ID = 'biz-stock-test-0001'
const CALLER_ID = 'user-owner-stock001'
const PRODUCT_ID = 'prod-stock-test-001'

const OWNER_ACCESS = {
  userId: CALLER_ID,
  businessId: BUSINESS_ID,
  role: 'owner' as const,
  status: 'active' as const,
}

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  const json = JSON.stringify(body)
  return new Request(
    `http://localhost:3000/api/businesses/${BUSINESS_ID}/products/${PRODUCT_ID}/stock`,
    {
      method: 'PATCH',
      body: json,
      headers: {
        'content-type': 'application/json',
        'content-length': String(new TextEncoder().encode(json).length),
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
  updateReturning = []
  dbMock.select.mockImplementation(() => selectBuilder())
  dbMock.update.mockImplementation(() => updateBuilder())
  requireBusinessAccess.mockResolvedValue(OWNER_ACCESS)
  publishToBusiness.mockResolvedValue(undefined)
})

describe('PATCH /api/businesses/[businessId]/products/[id]/stock — realtime publishes', () => {
  it('delta path: publishes product.updated with stock field', async () => {
    selectResults.push([{ id: PRODUCT_ID, stock: 5 }])
    updateReturning = [{ stock: 7 }]

    const { PATCH } = await import('./route')
    const res = await PATCH(
      makeRequest({ delta: 2 }) as Parameters<typeof PATCH>[0],
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
        type: 'product.updated',
        productId: PRODUCT_ID,
        fields: ['stock'],
      }),
      undefined,
    )
  })

  it('optimistic-set path: publishes product.updated with stock field', async () => {
    selectResults.push([{ id: PRODUCT_ID, stock: 5 }])
    updateReturning = [{ stock: 9 }]

    const { PATCH } = await import('./route')
    const res = await PATCH(
      makeRequest({ stock: 9, expectedStock: 5 }) as Parameters<typeof PATCH>[0],
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
        type: 'product.updated',
        productId: PRODUCT_ID,
        fields: ['stock'],
      }),
      undefined,
    )
  })

  it('forwards X-Device-Id to publishToBusiness', async () => {
    selectResults.push([{ id: PRODUCT_ID, stock: 5 }])
    updateReturning = [{ stock: 7 }]

    const { PATCH } = await import('./route')
    const res = await PATCH(
      makeRequest({ delta: 2 }, { 'x-device-id': 'dev-stock-xyz' }) as Parameters<typeof PATCH>[0],
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
      expect.objectContaining({ type: 'product.updated', fields: ['stock'] }),
      'dev-stock-xyz',
    )
  })

  it('does not publish when UPDATE returns no rows (delta would exceed bounds → 409)', async () => {
    selectResults.push([{ id: PRODUCT_ID, stock: 5 }])
    updateReturning = []

    const { PATCH } = await import('./route')
    const res = await PATCH(
      makeRequest({ delta: -100 }) as Parameters<typeof PATCH>[0],
      {
        params: Promise.resolve({
          businessId: BUSINESS_ID,
          id: PRODUCT_ID,
        }),
      },
    )

    expect(res.status).toBe(409)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })

  it('does not publish when optimistic-set conflicts (409)', async () => {
    selectResults.push([{ id: PRODUCT_ID, stock: 5 }])
    updateReturning = []

    const { PATCH } = await import('./route')
    const res = await PATCH(
      makeRequest({ stock: 9, expectedStock: 99 }) as Parameters<typeof PATCH>[0],
      {
        params: Promise.resolve({
          businessId: BUSINESS_ID,
          id: PRODUCT_ID,
        }),
      },
    )

    expect(res.status).toBe(409)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })
})
