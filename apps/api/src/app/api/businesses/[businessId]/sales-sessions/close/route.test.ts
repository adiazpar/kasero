import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for POST /api/businesses/[businessId]/sales-sessions/close —
 * realtime publish assertions for `sales_session.closed`.
 *
 * Mocks the transaction + the post-transaction re-read so the route reaches
 * the publish site on the happy path. Failure branches assert no publish.
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

const SESSION_ID = 'sess-close-test-01'
const FULL_ROW = {
  id: SESSION_ID,
  openedAt: new Date('2026-05-19T08:00:00Z'),
  openedByUserId: 'user-cashier-01',
  startingCash: 100,
  closedAt: new Date('2026-05-19T17:00:00Z'),
  closedByUserId: 'user-owner-01',
  countedCash: 250,
  salesCount: 12,
  salesTotal: 150,
  cashSalesTotal: 150,
  expectedCash: 250,
  variance: 0,
  notes: null,
}

// Drizzle mock — happy path:
//   db.transaction(cb) -> cb is invoked with a tx; we hand it a minimal
//     stub whose update().set().where().returning().all() returns the claim,
//     and whose select().from().where().get() returns aggregates.
//   db.select().from().where().get() -> the re-read fullRow.
let claimRows: Array<{ id: string; startingCash: number }> = [
  { id: SESSION_ID, startingCash: 100 },
]
let aggRow: { salesCount: number; salesTotal: number; cashSalesTotal: number } | undefined = {
  salesCount: 12,
  salesTotal: 150,
  cashSalesTotal: 150,
}
let fullRowResult: typeof FULL_ROW | undefined = FULL_ROW

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function txStub(): any {
  return {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => ({
            all: vi.fn(() => Promise.resolve(claimRows)),
          })),
        })),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          get: vi.fn(() => Promise.resolve(aggRow)),
        })),
      })),
    })),
  }
}

const dbMock = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transaction: vi.fn(async (cb: (tx: any) => Promise<unknown>) => {
    return cb(txStub())
  }),
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        get: vi.fn(() => Promise.resolve(fullRowResult)),
      })),
    })),
  })),
}

vi.mock('@/db', () => ({
  db: dbMock,
  salesSessions: {
    id: 'sales_sessions.id',
    businessId: 'sales_sessions.business_id',
    closedAt: 'sales_sessions.closed_at',
    startingCash: 'sales_sessions.starting_cash',
  },
  sales: {
    sessionId: 'sales.session_id',
    paymentMethod: 'sales.payment_method',
    total: 'sales.total',
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

const BUSINESS_ID = 'biz-sess-close-01'
const CALLER_ID = 'user-owner-01'

const OWNER_ACCESS = {
  userId: CALLER_ID,
  businessId: BUSINESS_ID,
  businessCurrency: 'USD',
  role: 'owner' as const,
  status: 'active' as const,
}

function makePostRequest(body: unknown, headers: Record<string, string> = {}): Request {
  const json = JSON.stringify(body)
  return new Request(
    `http://localhost:3000/api/businesses/${BUSINESS_ID}/sales-sessions/close`,
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
  claimRows = [{ id: SESSION_ID, startingCash: 100 }]
  aggRow = { salesCount: 12, salesTotal: 150, cashSalesTotal: 150 }
  fullRowResult = FULL_ROW
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dbMock.transaction.mockImplementation(async (cb: (tx: any) => Promise<unknown>) => cb(txStub()))
  dbMock.select.mockImplementation(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        get: vi.fn(() => Promise.resolve(fullRowResult)),
      })),
    })),
  }))
  requireBusinessAccess.mockResolvedValue(OWNER_ACCESS)
  publishToBusiness.mockResolvedValue(undefined)
})

describe('POST /api/businesses/[businessId]/sales-sessions/close — realtime publishes', () => {
  it('publishes sales_session.closed on happy path', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      makePostRequest({ countedCash: 250 }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledTimes(1)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'sales_session.closed', sessionId: SESSION_ID }),
      undefined,
    )
  })

  it('forwards X-Device-Id to publishToBusiness', async () => {
    const { POST } = await import('./route')
    const res = await POST(
      makePostRequest({ countedCash: 250 }, { 'x-device-id': 'dev-close-xyz' }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(200)
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'sales_session.closed' }),
      'dev-close-xyz',
    )
  })

  it('does not publish when no session is open (409)', async () => {
    // Empty claim -> SessionNotOpenError -> 409
    claimRows = []

    const { POST } = await import('./route')
    const res = await POST(
      makePostRequest({ countedCash: 250 }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(409)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })

  it('does not publish when caller is not a manager (403)', async () => {
    requireBusinessAccess.mockResolvedValueOnce({
      ...OWNER_ACCESS,
      role: 'employee' as const,
    })

    const { POST } = await import('./route')
    const res = await POST(
      makePostRequest({ countedCash: 250 }) as Parameters<typeof POST>[0],
      { params: Promise.resolve({ businessId: BUSINESS_ID }) },
    )

    expect(res.status).toBe(403)
    expect(publishToBusiness).not.toHaveBeenCalled()
  })
})
