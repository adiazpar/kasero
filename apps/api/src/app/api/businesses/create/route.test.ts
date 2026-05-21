import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for POST /api/businesses/create — realtime publish assertion.
 *
 * Mocks auth, db, rate-limit, and the realtime publisher. The happy
 * path verifies that publishToUser is called with business.list.changed
 * reason:'added' after the business + membership rows are inserted.
 */

const publishToUser = vi.fn()

vi.mock('@/lib/realtime', async (orig) => {
  const real = await orig<typeof import('@/lib/realtime')>()
  return { ...real, publishToUser }
})

// withAuth calls auth.api.getSession internally.
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => ({
        user: {
          id: 'user-creator-001',
          emailVerified: true,
          name: 'Bob Creator',
          email: 'bob@example.com',
          language: 'en',
        },
      })),
    },
  },
}))

// Drizzle builder mocks. The route uses:
//   db.select().from().where() -> .get() or result[0]  (ownership count)
//   db.batch([insert, insert])                          (create business + membership)
const selectResults: unknown[] = []
const batchCalls: unknown[][] = []

function selectBuilder() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {}
  b.from = vi.fn(() => b)
  b.where = vi.fn(() => b)
  b.get = vi.fn(() => Promise.resolve(selectResults.shift() ?? null))
  // The route does `const [{ count }] = await db.select(...).from(...).where(...)` —
  // that last call is the select itself so we need it to resolve to an array.
  // The builder's `.where()` above returns `b`; vitest will call `.then()` on `b`
  // if it's used with await. We make `b` thenable to return [{ count: 0 }].
  b.then = vi.fn((resolve: (v: unknown) => void) =>
    resolve(selectResults.shift() ?? [{ count: 0 }]),
  )
  return b
}

const selectImpl = vi.fn(() => selectBuilder())
const batchImpl = vi.fn(async (ops: unknown[]) => {
  batchCalls.push(ops)
  return []
})

vi.mock('@/db', () => ({
  db: {
    select: () => selectImpl(),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({})),
    })),
    batch: (...args: Parameters<typeof batchImpl>) => batchImpl(...args),
  },
  businesses: {
    id: 'businesses.id',
    name: 'businesses.name',
  },
  businessUsers: {
    id: 'business_users.id',
    userId: 'business_users.user_id',
    businessId: 'business_users.business_id',
    role: 'business_users.role',
    status: 'business_users.status',
  },
  expenseCategories: {
    id: 'expense_categories.id',
    businessId: 'expense_categories.business_id',
    name: 'expense_categories.name',
    sortOrder: 'expense_categories.sort_order',
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

vi.mock('@/lib/server-logger', () => ({
  logServerError: vi.fn(),
}))

vi.mock('@/lib/rate-limit', async () => ({
  checkRateLimit: vi.fn(async () => ({ success: true, resetAt: Date.now() + 60_000 })),
  getClientIp: () => '127.0.0.1',
  RateLimits: {
    userMutation: { limit: 30, windowSeconds: 60 },
    ipMutation: { limit: 600, windowSeconds: 60 },
  },
  UpstashUnavailableError: class UpstashUnavailableError extends Error {},
}))

const CREATOR_ID = 'user-creator-001'

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  const json = JSON.stringify(body)
  return new Request('http://localhost:3000/api/businesses/create', {
    method: 'POST',
    body: json,
    headers: {
      'content-type': 'application/json',
      'content-length': String(new TextEncoder().encode(json).length),
      origin: 'http://localhost:3000',
      host: 'localhost:3000',
      ...headers,
    },
  })
}

beforeEach(() => {
  publishToUser.mockReset()
  selectResults.length = 0
  batchCalls.length = 0
  selectImpl.mockClear()
  batchImpl.mockClear()
})

describe('POST /api/businesses/create — realtime publishes', () => {
  it('publishes business.list.changed reason:added to the creator on happy path', async () => {
    // Ownership count query returns 0 owned businesses.
    selectResults.push([{ count: 0 }])

    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({
        name: 'My New Shop',
        locale: 'en-US',
        icon: null,
      }) as Parameters<typeof POST>[0],
    )

    expect(res.status).toBe(200)
    expect(publishToUser).toHaveBeenCalledTimes(1)
    expect(publishToUser).toHaveBeenCalledWith(
      CREATOR_ID,
      expect.objectContaining({ type: 'business.list.changed', reason: 'added' }),
      undefined,
    )
  })

  it('forwards the X-Device-Id header to publishToUser', async () => {
    selectResults.push([{ count: 0 }])

    const { POST } = await import('./route')
    const res = await POST(
      makeRequest(
        { name: 'My Shop', locale: 'en-US', icon: null },
        { 'x-device-id': 'dev-creator-xyz' },
      ) as Parameters<typeof POST>[0],
    )

    expect(res.status).toBe(200)
    expect(publishToUser).toHaveBeenCalledWith(
      CREATOR_ID,
      expect.objectContaining({ type: 'business.list.changed', reason: 'added' }),
      'dev-creator-xyz',
    )
  })

  it('does not publish when the owned-business cap is exceeded', async () => {
    selectResults.push([{ count: 50 }])

    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({ name: 'Overflow Shop', locale: 'en-US', icon: null }) as Parameters<typeof POST>[0],
    )

    expect(res.status).toBe(409)
    expect(publishToUser).not.toHaveBeenCalled()
  })
})
