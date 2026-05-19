import { describe, it, expect, vi, beforeEach } from 'vitest'
import { patchSchema as schema } from '../schema'

// We test the schema directly; full route integration is verified manually.

describe('PATCH business schema', () => {
  it('accepts an empty payload', () => {
    expect(schema.safeParse({}).success).toBe(true)
  })

  it('rejects empty name', () => {
    expect(schema.safeParse({ name: '' }).success).toBe(false)
    expect(schema.safeParse({ name: '   ' }).success).toBe(false)
  })

  it('trims name', () => {
    const r = schema.safeParse({ name: '  Shop  ' })
    expect(r.success).toBe(true)
    expect(r.success && r.data.name).toBe('Shop')
  })

  it('rejects removeLogo with non-true string', () => {
    expect(schema.safeParse({ removeLogo: 'yes' }).success).toBe(false)
    expect(schema.safeParse({ removeLogo: 'true' }).success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Realtime publish assertions for PATCH /api/businesses/[businessId]
// ---------------------------------------------------------------------------

const publishToBusiness = vi.fn()
const publishBatchedToUsers = vi.fn()

vi.mock('@/lib/realtime', async (orig) => {
  const real = await orig<typeof import('@/lib/realtime')>()
  return { ...real, publishToBusiness, publishBatchedToUsers }
})

const requireBusinessAccess = vi.fn()

vi.mock('@/lib/business-auth', async (orig) => {
  const real = await orig<typeof import('@/lib/business-auth')>()
  return { ...real, requireBusinessAccess }
})

// Drizzle mock — the PATCH handler calls:
//   db.select().from().where().limit() -> [row]  (no-op path)
//   db.update().set().where().returning() -> [row]  (update path)
//   db.select().from().where() -> [{ userId }]  (member query for rename fan-out)
const selectResults: unknown[] = []
const updateResult: unknown[] = []

function selectBuilder() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {}
  b.from = vi.fn(() => b)
  b.where = vi.fn(() => b)
  b.limit = vi.fn(() => Promise.resolve(selectResults.shift() ?? []))
  // Awaiting the builder directly (without .limit) resolves via then.
  b.then = vi.fn((resolve: (v: unknown) => void) =>
    resolve(selectResults.shift() ?? []),
  )
  return b
}

function updateBuilder() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {}
  b.set = vi.fn(() => b)
  b.where = vi.fn(() => b)
  b.returning = vi.fn(() => Promise.resolve(updateResult.shift() ?? []))
  return b
}

const dbMock = {
  select: vi.fn(() => selectBuilder()),
  update: vi.fn(() => updateBuilder()),
}

vi.mock('@/db', () => ({
  db: dbMock,
  businesses: { id: 'businesses.id', name: 'businesses.name', icon: 'businesses.icon', locale: 'businesses.locale', currency: 'businesses.currency' },
  businessUsers: { userId: 'business_users.user_id', businessId: 'business_users.business_id' },
}))

vi.mock('@/lib/api-middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-middleware')>('@/lib/api-middleware')
  return {
    ...actual,
    enforceMaxContentLength: vi.fn(() => null),
    applyRateLimit: vi.fn(async () => null),
  }
})

vi.mock('@/lib/server-logger', () => ({ logServerError: vi.fn() }))

vi.mock('@/lib/file-sniff', () => ({
  sniffImageMimeType: vi.fn(() => 'image/png'),
}))

vi.mock('@/lib/storage', () => ({ MAX_UPLOAD_SIZE: 2 * 1024 * 1024 }))

const BUSINESS_ID = 'biz-patch-001'
const OWNER_ACCESS = {
  userId: 'user-owner-001',
  businessId: BUSINESS_ID,
  role: 'owner' as const,
  status: 'active' as const,
}

function makeFormRequest(fields: Record<string, string>, headers: Record<string, string> = {}): Request {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  return new Request(`http://localhost:3000/api/businesses/${BUSINESS_ID}`, {
    method: 'PATCH',
    body: form,
    headers: {
      'content-length': '100',
      origin: 'http://localhost:3000',
      host: 'localhost:3000',
      ...headers,
    },
  })
}

const UPDATED_ROW = {
  id: BUSINESS_ID,
  name: 'New Name',
  icon: null,
  locale: 'en-US',
  currency: 'USD',
}

beforeEach(() => {
  publishToBusiness.mockReset()
  publishBatchedToUsers.mockReset()
  selectResults.length = 0
  updateResult.length = 0
  dbMock.select.mockImplementation(() => selectBuilder())
  dbMock.update.mockImplementation(() => updateBuilder())
  requireBusinessAccess.mockResolvedValue(OWNER_ACCESS)
})

describe('PATCH /api/businesses/[businessId] — realtime publishes', () => {
  it('publishes business.updated when a field changes', async () => {
    updateResult.push([UPDATED_ROW])

    const { PATCH } = await import('../route')
    const res = await PATCH(
      makeFormRequest({ name: 'New Name' }) as Parameters<typeof PATCH>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledTimes(1)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'business.updated', fields: expect.arrayContaining(['name']) }),
      undefined,
    )
  })

  it('forwards X-Device-Id to publishToBusiness', async () => {
    updateResult.push([UPDATED_ROW])

    const { PATCH } = await import('../route')
    const res = await PATCH(
      makeFormRequest({ name: 'New Name' }, { 'x-device-id': 'dev-abc' }) as Parameters<typeof PATCH>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'business.updated' }),
      'dev-abc',
    )
  })

  it('publishes business.list.changed reason:renamed when name changes', async () => {
    updateResult.push([UPDATED_ROW])
    // member query returns two users
    selectResults.push([{ userId: 'user-a' }, { userId: 'user-b' }])

    const { PATCH } = await import('../route')
    const res = await PATCH(
      makeFormRequest({ name: 'New Name' }) as Parameters<typeof PATCH>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishBatchedToUsers).toHaveBeenCalledTimes(1)
    expect(publishBatchedToUsers).toHaveBeenCalledWith(
      expect.arrayContaining(['user-a', 'user-b']),
      expect.objectContaining({ type: 'business.list.changed', reason: 'renamed' }),
      undefined,
    )
  })

  it('does NOT publish business.list.changed when only locale changes', async () => {
    const localeRow = { ...UPDATED_ROW, locale: 'es-PE', currency: 'PEN' }
    updateResult.push([localeRow])

    const { PATCH } = await import('../route')
    const res = await PATCH(
      makeFormRequest({ locale: 'es-PE' }) as Parameters<typeof PATCH>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishBatchedToUsers).not.toHaveBeenCalled()
  })

  it('does NOT publish business.list.changed when only iconUrl changes (removeLogo)', async () => {
    updateResult.push([UPDATED_ROW])

    const { PATCH } = await import('../route')
    const res = await PATCH(
      makeFormRequest({ removeLogo: 'true' }) as Parameters<typeof PATCH>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishBatchedToUsers).not.toHaveBeenCalled()
  })
})
