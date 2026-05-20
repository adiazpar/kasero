import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for PATCH and DELETE /api/businesses/[businessId]/providers/[id]
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
//     db.select().from().where().limit() -> [existingProvider]
//     db.update().set().where().returning() -> [updatedProvider]
//     db.select().from().where().orderBy().limit() -> [] (notes list)
//   DELETE:
//     db.select().from().where().limit() -> [existingProvider]
//     db.batch([...]) -> void
const selectResults: unknown[] = []

function selectBuilder() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {}
  b.from = vi.fn(() => b)
  b.where = vi.fn(() => b)
  b.limit = vi.fn(() => Promise.resolve(selectResults.shift() ?? []))
  b.orderBy = vi.fn(() => b)
  b.then = vi.fn((resolve: (v: unknown) => void) =>
    resolve(selectResults.shift() ?? []),
  )
  return b
}

const PROVIDER_ID = 'prov-id-patch-001'
const PROVIDER_ROW = {
  id: PROVIDER_ID,
  businessId: 'biz-prov-id-test01',
  name: 'Acme Supplies',
  phone: '+1-555-0100',
  email: null,
  active: true,
  createdAt: new Date(),
}

const updateReturning = vi.fn(() => Promise.resolve([{ ...PROVIDER_ROW, name: 'Updated Supplies' }]))
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
  providers: {
    id: 'providers.id',
    businessId: 'providers.business_id',
    name: 'providers.name',
    phone: 'providers.phone',
    email: 'providers.email',
    active: 'providers.active',
  },
  providerNotes: {
    id: 'provider_notes.id',
    providerId: 'provider_notes.provider_id',
    businessId: 'provider_notes.business_id',
    createdAt: 'provider_notes.created_at',
  },
  orders: {
    id: 'orders.id',
    businessId: 'orders.business_id',
    providerId: 'orders.provider_id',
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

const BUSINESS_ID = 'biz-prov-id-test01'
const CALLER_ID = 'user-owner-prov-id01'

const OWNER_ACCESS = {
  userId: CALLER_ID,
  businessId: BUSINESS_ID,
  role: 'owner' as const,
  status: 'active' as const,
}

function makePatchRequest(body: unknown, headers: Record<string, string> = {}): Request {
  const json = JSON.stringify(body)
  return new Request(
    `http://localhost:3000/api/businesses/${BUSINESS_ID}/providers/${PROVIDER_ID}`,
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
    `http://localhost:3000/api/businesses/${BUSINESS_ID}/providers/${PROVIDER_ID}`,
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

describe('PATCH /api/businesses/[businessId]/providers/[id] — realtime publishes', () => {
  it('publishes provider.updated with changed fields on happy path', async () => {
    // existence check, notes list
    selectResults.push([PROVIDER_ROW], [])

    const { PATCH } = await import('./route')
    const res = await PATCH(
      makePatchRequest({ name: 'Updated Supplies' }) as Parameters<typeof PATCH>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID, id: PROVIDER_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledTimes(1)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({
        type: 'provider.updated',
        providerId: PROVIDER_ID,
        fields: ['name'],
      }),
      undefined,
    )
  })

  it('publishes provider.updated with multiple changed fields', async () => {
    selectResults.push([PROVIDER_ROW], [])

    const { PATCH } = await import('./route')
    await PATCH(
      makePatchRequest({ name: 'Updated Supplies', phone: '+1-555-9999', active: false }) as Parameters<typeof PATCH>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID, id: PROVIDER_ID }) },
    )

    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({
        type: 'provider.updated',
        providerId: PROVIDER_ID,
        fields: expect.arrayContaining(['name', 'phone', 'active']),
      }),
      undefined,
    )
  })

  it('forwards X-Device-Id to publishToBusiness (PATCH)', async () => {
    selectResults.push([PROVIDER_ROW], [])

    const { PATCH } = await import('./route')
    await PATCH(
      makePatchRequest({ name: 'Updated Supplies' }, { 'x-device-id': 'dev-prov-patch' }) as Parameters<typeof PATCH>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID, id: PROVIDER_ID }) },
    )

    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'provider.updated' }),
      'dev-prov-patch',
    )
  })

  it('does not publish when provider not found (PATCH)', async () => {
    selectResults.push([])

    const { PATCH } = await import('./route')
    const res = await PATCH(
      makePatchRequest({ name: 'Whatever' }) as Parameters<typeof PATCH>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID, id: PROVIDER_ID }) },
    )

    expect(res.status).toBe(404)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/businesses/[businessId]/providers/[id] — realtime publishes', () => {
  it('publishes provider.deleted on happy path', async () => {
    selectResults.push([PROVIDER_ROW])

    const { DELETE } = await import('./route')
    const res = await DELETE(
      makeDeleteRequest() as Parameters<typeof DELETE>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID, id: PROVIDER_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledTimes(1)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({
        type: 'provider.deleted',
        providerId: PROVIDER_ID,
      }),
      undefined,
    )
  })

  it('forwards X-Device-Id to publishToBusiness (DELETE)', async () => {
    selectResults.push([PROVIDER_ROW])

    const { DELETE } = await import('./route')
    await DELETE(
      makeDeleteRequest({ 'x-device-id': 'dev-prov-del' }) as Parameters<typeof DELETE>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID, id: PROVIDER_ID }) },
    )

    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'provider.deleted' }),
      'dev-prov-del',
    )
  })

  it('does not publish when provider not found (DELETE)', async () => {
    selectResults.push([])

    const { DELETE } = await import('./route')
    const res = await DELETE(
      makeDeleteRequest() as Parameters<typeof DELETE>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID, id: PROVIDER_ID }) },
    )

    expect(res.status).toBe(404)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })
})
