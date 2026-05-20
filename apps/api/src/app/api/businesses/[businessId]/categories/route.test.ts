import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for POST /api/businesses/[businessId]/categories — realtime
 * publish assertions for category.created.
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
//   GET: db.select().from().where().orderBy().limit() -> categories array
//   POST:
//     db.select().from().where().orderBy()            -> existing categories (for sortOrder)
//     db.insert().values().returning()               -> [newCategory]
const selectResults: unknown[] = []

function selectBuilder() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {}
  b.from = vi.fn(() => b)
  b.where = vi.fn(() => b)
  b.orderBy = vi.fn(() => b)
  b.limit = vi.fn(() => Promise.resolve(selectResults.shift() ?? []))
  b.then = vi.fn((resolve: (v: unknown) => void) =>
    resolve(selectResults.shift() ?? []),
  )
  return b
}

const CATEGORY_ID = 'cat-new-001'
const CATEGORY_ROW = { id: CATEGORY_ID, businessId: 'biz-cat-test-01', name: 'Drinks', sortOrder: 1 }

const insertImpl = vi.fn(() => ({
  values: vi.fn(() => ({
    returning: vi.fn(() => Promise.resolve([CATEGORY_ROW])),
  })),
}))

const dbMock = {
  select: vi.fn(() => selectBuilder()),
  insert: vi.fn(() => insertImpl()),
}

vi.mock('@/db', () => ({
  db: dbMock,
  productCategories: {
    id: 'product_categories.id',
    businessId: 'product_categories.business_id',
    name: 'product_categories.name',
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

vi.mock('nanoid', () => ({ nanoid: vi.fn(() => CATEGORY_ID) }))

const BUSINESS_ID = 'biz-cat-test-01'
const CALLER_ID = 'user-owner-cat-01'

const OWNER_ACCESS = {
  userId: CALLER_ID,
  businessId: BUSINESS_ID,
  role: 'owner' as const,
  status: 'active' as const,
}

function makePostRequest(body: unknown, headers: Record<string, string> = {}): Request {
  const json = JSON.stringify(body)
  return new Request(
    `http://localhost:3000/api/businesses/${BUSINESS_ID}/categories`,
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
  requireBusinessAccess.mockResolvedValue(OWNER_ACCESS)
  publishToBusiness.mockResolvedValue(undefined)
})

describe('POST /api/businesses/[businessId]/categories — realtime publishes', () => {
  it('publishes category.created on happy path', async () => {
    // First select (GET existing categories for sortOrder): empty list
    selectResults.push([])

    const { POST } = await import('./route')
    const res = await POST(
      makePostRequest({ name: 'Drinks' }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledTimes(1)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'category.created', categoryId: CATEGORY_ID }),
      undefined,
    )
  })

  it('forwards X-Device-Id to publishToBusiness', async () => {
    selectResults.push([])

    const { POST } = await import('./route')
    const res = await POST(
      makePostRequest({ name: 'Drinks' }, { 'x-device-id': 'dev-cat-abc' }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'category.created' }),
      'dev-cat-abc',
    )
  })

  it('does not publish when validation fails (empty name)', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      makePostRequest({ name: '' }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(400)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })
})
