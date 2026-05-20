import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for POST /api/businesses/[businessId]/categories/reorder —
 * realtime publish assertions for category.reordered.
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

// Drizzle mock.
//   db.select().from().where() (thenable) -> existing category ids for preflight check
//   db.update().set().where()             -> void
const selectResults: unknown[] = []

function selectBuilder() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {}
  b.from = vi.fn(() => b)
  b.where = vi.fn(() => b)
  b.then = vi.fn((resolve: (v: unknown) => void) =>
    resolve(selectResults.shift() ?? []),
  )
  return b
}

const updateWhere = vi.fn(() => Promise.resolve([]))
const updateSet = vi.fn(() => ({ where: updateWhere }))
const updateImpl = vi.fn(() => ({ set: updateSet }))

const dbMock = {
  select: vi.fn(() => selectBuilder()),
  update: vi.fn(() => updateImpl()),
}

vi.mock('@/db', () => ({
  db: dbMock,
  productCategories: {
    id: 'product_categories.id',
    businessId: 'product_categories.business_id',
    sortOrder: 'product_categories.sort_order',
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

const BUSINESS_ID = 'biz-cat-reorder-01'
const CALLER_ID = 'user-owner-reord01'
const CAT_IDS = ['cat-a', 'cat-b', 'cat-c']

const OWNER_ACCESS = {
  userId: CALLER_ID,
  businessId: BUSINESS_ID,
  role: 'owner' as const,
  status: 'active' as const,
}

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  const json = JSON.stringify(body)
  return new Request(
    `http://localhost:3000/api/businesses/${BUSINESS_ID}/categories/reorder`,
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
  selectResults.length = 0
  dbMock.select.mockImplementation(() => selectBuilder())
  dbMock.update.mockImplementation(() => updateImpl())
  requireBusinessAccess.mockResolvedValue(OWNER_ACCESS)
  publishToBusiness.mockResolvedValue(undefined)
})

describe('POST /api/businesses/[businessId]/categories/reorder — realtime publishes', () => {
  it('publishes category.reordered on happy path', async () => {
    // Preflight check: all three ids found in this business
    selectResults.push(CAT_IDS.map((id) => ({ id })))

    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ categoryIds: CAT_IDS }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledTimes(1)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'category.reordered' }),
      undefined,
    )
  })

  it('forwards X-Device-Id to publishToBusiness', async () => {
    selectResults.push(CAT_IDS.map((id) => ({ id })))

    const { POST } = await import('./route')
    await POST(
      makeRequest({ categoryIds: CAT_IDS }, { 'x-device-id': 'dev-reord-xyz' }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'category.reordered' }),
      'dev-reord-xyz',
    )
  })

  it('does not publish when category ids not found', async () => {
    // Preflight check returns fewer than submitted -> 400
    selectResults.push([{ id: CAT_IDS[0] }])

    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ categoryIds: CAT_IDS }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(400)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })
})
