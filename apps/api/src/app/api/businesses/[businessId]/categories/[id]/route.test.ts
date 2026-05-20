import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for PATCH and DELETE /api/businesses/[businessId]/categories/[id]
 * — realtime publish assertions.
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
//   PATCH:
//     db.select().from().where().limit() -> [existingCategory]
//     db.update().set().where().returning() -> [updatedCategory]
//   DELETE:
//     db.select().from().where().limit() -> [existingCategory]
//     db.select().from().where() (count) -> [{ count: 2 }]
//     db.batch([...])                    -> void
const selectResults: unknown[] = []

function selectBuilder() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {}
  b.from = vi.fn(() => b)
  b.where = vi.fn(() => b)
  b.limit = vi.fn(() => Promise.resolve(selectResults.shift() ?? []))
  b.then = vi.fn((resolve: (v: unknown) => void) =>
    resolve(selectResults.shift() ?? []),
  )
  return b
}

const CATEGORY_ID = 'cat-id-patch-001'
const CATEGORY_ROW = {
  id: CATEGORY_ID,
  businessId: 'biz-cat-id-test01',
  name: 'Food',
  sortOrder: 1,
}

const updateReturning = vi.fn(() => Promise.resolve([{ ...CATEGORY_ROW, name: 'Updated Food' }]))
const updateWhere = vi.fn(() => ({ returning: updateReturning }))
const updateSet = vi.fn(() => ({ where: updateWhere }))
const updateImpl = vi.fn(() => ({ set: updateSet }))

const batchImpl = vi.fn(() => Promise.resolve([]))

const dbMock = {
  select: vi.fn(() => selectBuilder()),
  update: vi.fn(() => updateImpl()),
  delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })),
  batch: batchImpl,
}

vi.mock('@/db', () => ({
  db: dbMock,
  productCategories: {
    id: 'product_categories.id',
    businessId: 'product_categories.business_id',
    name: 'product_categories.name',
    sortOrder: 'product_categories.sort_order',
  },
  products: {
    id: 'products.id',
    businessId: 'products.business_id',
    categoryId: 'products.category_id',
  },
  businesses: {
    id: 'businesses.id',
    defaultCategoryId: 'businesses.default_category_id',
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

const BUSINESS_ID = 'biz-cat-id-test01'
const CALLER_ID = 'user-owner-cat-id01'

const OWNER_ACCESS = {
  userId: CALLER_ID,
  businessId: BUSINESS_ID,
  role: 'owner' as const,
  status: 'active' as const,
}

function makePatchRequest(body: unknown, headers: Record<string, string> = {}): Request {
  const json = JSON.stringify(body)
  return new Request(
    `http://localhost:3000/api/businesses/${BUSINESS_ID}/categories/${CATEGORY_ID}`,
    {
      method: 'PATCH',
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

function makeDeleteRequest(headers: Record<string, string> = {}): Request {
  return new Request(
    `http://localhost:3000/api/businesses/${BUSINESS_ID}/categories/${CATEGORY_ID}`,
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
  selectResults.length = 0
  dbMock.select.mockImplementation(() => selectBuilder())
  dbMock.update.mockImplementation(() => updateImpl())
  dbMock.batch.mockReset()
  dbMock.batch.mockResolvedValue([])
  requireBusinessAccess.mockResolvedValue(OWNER_ACCESS)
  publishToBusiness.mockResolvedValue(undefined)
})

describe('PATCH /api/businesses/[businessId]/categories/[id] — realtime publishes', () => {
  it('publishes category.updated on happy path', async () => {
    selectResults.push([CATEGORY_ROW])

    const { PATCH } = await import('./route')
    const res = await PATCH(
      makePatchRequest({ name: 'Updated Food' }) as Parameters<typeof PATCH>[0],
      {
        params: Promise.resolve({ businessId: BUSINESS_ID, id: CATEGORY_ID }),
      },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledTimes(1)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({
        type: 'category.updated',
        categoryId: CATEGORY_ID,
        fields: ['name'],
      }),
      undefined,
    )
  })

  it('forwards X-Device-Id to publishToBusiness (PATCH)', async () => {
    selectResults.push([CATEGORY_ROW])

    const { PATCH } = await import('./route')
    await PATCH(
      makePatchRequest({ name: 'Updated Food' }, { 'x-device-id': 'dev-cat-patch' }) as Parameters<typeof PATCH>[0],
      {
        params: Promise.resolve({ businessId: BUSINESS_ID, id: CATEGORY_ID }),
      },
    )

    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'category.updated' }),
      'dev-cat-patch',
    )
  })

  it('does not publish when category not found (PATCH)', async () => {
    selectResults.push([])

    const { PATCH } = await import('./route')
    const res = await PATCH(
      makePatchRequest({ name: 'Whatever' }) as Parameters<typeof PATCH>[0],
      {
        params: Promise.resolve({ businessId: BUSINESS_ID, id: CATEGORY_ID }),
      },
    )

    expect(res.status).toBe(404)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/businesses/[businessId]/categories/[id] — realtime publishes', () => {
  it('publishes category.deleted on happy path', async () => {
    // First select: existence check -> existing category
    selectResults.push([CATEGORY_ROW])
    // Second select: count of affected products
    selectResults.push([{ count: 0 }])

    const { DELETE } = await import('./route')
    const res = await DELETE(
      makeDeleteRequest() as Parameters<typeof DELETE>[0],
      {
        params: Promise.resolve({ businessId: BUSINESS_ID, id: CATEGORY_ID }),
      },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledTimes(1)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({
        type: 'category.deleted',
        categoryId: CATEGORY_ID,
      }),
      undefined,
    )
  })

  it('forwards X-Device-Id to publishToBusiness (DELETE)', async () => {
    selectResults.push([CATEGORY_ROW])
    selectResults.push([{ count: 0 }])

    const { DELETE } = await import('./route')
    await DELETE(
      makeDeleteRequest({ 'x-device-id': 'dev-cat-del' }) as Parameters<typeof DELETE>[0],
      {
        params: Promise.resolve({ businessId: BUSINESS_ID, id: CATEGORY_ID }),
      },
    )

    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'category.deleted' }),
      'dev-cat-del',
    )
  })

  it('does not publish when category not found (DELETE)', async () => {
    selectResults.push([])

    const { DELETE } = await import('./route')
    const res = await DELETE(
      makeDeleteRequest() as Parameters<typeof DELETE>[0],
      {
        params: Promise.resolve({ businessId: BUSINESS_ID, id: CATEGORY_ID }),
      },
    )

    expect(res.status).toBe(404)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })
})
