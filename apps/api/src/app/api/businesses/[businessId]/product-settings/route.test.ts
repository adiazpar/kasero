import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for PATCH /api/businesses/[businessId]/product-settings —
 * realtime publish assertions.
 *
 * Covers:
 *   - happy path: publishToBusiness called with product.settings.updated
 *   - X-Device-Id forwarded
 *   - no publish when validation fails
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

// Drizzle mock. PATCH path:
//   db.update().set().where()  -> void
const updateImpl = vi.fn(() => ({
  set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })),
}))

const dbMock = {
  update: vi.fn(() => updateImpl()),
}

vi.mock('@/db', () => ({
  db: dbMock,
  businesses: {
    id: 'businesses.id',
    defaultCategoryId: 'businesses.default_category_id',
    sortPreference: 'businesses.sort_preference',
  },
  productCategories: {
    id: 'product_categories.id',
    businessId: 'product_categories.business_id',
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

const BUSINESS_ID = 'biz-prodset-test001'
const CALLER_ID = 'user-owner-pset0001'

const OWNER_ACCESS = {
  userId: CALLER_ID,
  businessId: BUSINESS_ID,
  role: 'owner' as const,
  status: 'active' as const,
}

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  const json = JSON.stringify(body)
  return new Request(
    `http://localhost:3000/api/businesses/${BUSINESS_ID}/product-settings`,
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
  updateImpl.mockClear()
  dbMock.update.mockImplementation(() => updateImpl())
  requireBusinessAccess.mockResolvedValue(OWNER_ACCESS)
  publishToBusiness.mockResolvedValue(undefined)
})

describe('PATCH /api/businesses/[businessId]/product-settings — realtime publishes', () => {
  it('publishes product.settings.updated with sortPreference field on happy path', async () => {
    const { PATCH } = await import('./route')
    const res = await PATCH(
      makeRequest({ sortPreference: 'price_asc' }) as Parameters<typeof PATCH>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledTimes(1)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({
        type: 'product.settings.updated',
        fields: ['sortPreference'],
      }),
      undefined,
    )
  })

  it('forwards X-Device-Id to publishToBusiness', async () => {
    const { PATCH } = await import('./route')
    const res = await PATCH(
      makeRequest(
        { sortPreference: 'name_asc' },
        { 'x-device-id': 'dev-pset-xyz' },
      ) as Parameters<typeof PATCH>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'product.settings.updated' }),
      'dev-pset-xyz',
    )
  })

  it('does not publish when validation fails', async () => {
    const { PATCH } = await import('./route')
    const res = await PATCH(
      makeRequest({ sortPreference: 'not-a-real-pref' }) as Parameters<typeof PATCH>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(400)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })
})
