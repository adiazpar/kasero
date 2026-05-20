import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for POST /api/businesses/[businessId]/providers
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

const PROVIDER_ID_STUB = 'prov-test-id-001'

// Drizzle mock.
//   POST:
//     db.insert().values().returning() -> [newProvider]
const insertReturning = vi.fn()
const insertValues = vi.fn(() => ({ returning: insertReturning }))
const insertImpl = vi.fn(() => ({ values: insertValues }))

const dbMock = {
  insert: vi.fn(() => insertImpl()),
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
    createdAt: 'providers.created_at',
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

// nanoid is called inside the route for the provider id — mock to get a stable id
vi.mock('nanoid', () => ({ nanoid: vi.fn(() => PROVIDER_ID_STUB) }))

const BUSINESS_ID = 'biz-prov-test-001'
const CALLER_ID = 'user-owner-prov-001'

const OWNER_ACCESS = {
  userId: CALLER_ID,
  businessId: BUSINESS_ID,
  role: 'owner' as const,
  status: 'active' as const,
}

const NEW_PROVIDER = {
  id: PROVIDER_ID_STUB,
  businessId: BUSINESS_ID,
  name: 'Acme Supplies',
  phone: '+1-555-0100',
  email: null,
  active: true,
  createdAt: new Date(),
}

function makePostRequest(body: unknown, headers: Record<string, string> = {}): Request {
  const json = JSON.stringify(body)
  return new Request(
    `http://localhost:3000/api/businesses/${BUSINESS_ID}/providers`,
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
  publishToBusiness.mockResolvedValue(undefined)
  requireBusinessAccess.mockResolvedValue(OWNER_ACCESS)
  dbMock.insert.mockImplementation(() => insertImpl())
  insertReturning.mockResolvedValue([NEW_PROVIDER])
})

describe('POST /api/businesses/[businessId]/providers — realtime publishes', () => {
  it('publishes provider.created on happy path', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      makePostRequest({ name: 'Acme Supplies', phone: '+1-555-0100' }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledTimes(1)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({
        type: 'provider.created',
        providerId: PROVIDER_ID_STUB,
      }),
      undefined,
    )
  })

  it('forwards X-Device-Id to publishToBusiness (POST)', async () => {
    const { POST } = await import('./route')
    await POST(
      makePostRequest({ name: 'Acme Supplies', phone: '+1-555-0100' }, { 'x-device-id': 'dev-prov-post' }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'provider.created' }),
      'dev-prov-post',
    )
  })

  it('does not publish on validation error (POST)', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      makePostRequest({ name: '' }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(400)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })
})
