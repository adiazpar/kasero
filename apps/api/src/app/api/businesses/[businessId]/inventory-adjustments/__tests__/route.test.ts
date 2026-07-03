import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Integration-style tests for inventory-adjustments routes (POST + GET).
 * Mocks db and auth at module level so no real SQLite is needed.
 */

// --- nanoid mock ---
const ADJ_ID = 'adj-test-001-nanoid'
const EXPENSE_ID = 'exp-test-001-nanoid'
// Route calls nanoid() once for expenseId (if expense payload), then once for adjustmentId.
// Return EXPENSE_ID on first call, ADJ_ID on subsequent calls.
const nanoidImpl = vi.fn()
vi.mock('nanoid', () => ({ nanoid: nanoidImpl }))

// --- realtime mock ---
const publishToBusiness = vi.fn()
vi.mock('@/lib/realtime', async (orig) => {
  const real = await orig<typeof import('@/lib/realtime')>()
  return { ...real, publishToBusiness }
})

// --- auth mock ---
const requireBusinessAccess = vi.fn()
vi.mock('@/lib/business-auth', async (orig) => {
  const real = await orig<typeof import('@/lib/business-auth')>()
  return { ...real, requireBusinessAccess }
})

// --- db mock ---

// Queue-based select: each call to the select chain pops the next batch.
let selectQueue: unknown[][] = []
// Queue-based insert RETURNING: the route creates rows via
// INSERT ... RETURNING inside the transaction (expense first when the
// payload carries one, then the adjustment) instead of re-selecting them.
let insertReturningQueue: unknown[][] = []

const dbMock = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  transaction: vi.fn(),
}

function makeSelectChain(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(rows),
        }),
      }),
      orderBy: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  }
}

function resetDbMock() {
  // Each select() call pops from the queue; falls back to empty array.
  dbMock.select.mockImplementation(() => {
    const rows = selectQueue.shift() ?? []
    return makeSelectChain(rows)
  })

  dbMock.insert.mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockImplementation(() =>
        Promise.resolve(insertReturningQueue.shift() ?? []),
      ),
    }),
  })

  dbMock.update.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ reserved: 1 }]),
      }),
    }),
  })

  dbMock.delete.mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  })

  dbMock.transaction.mockImplementation(async (fn: (tx: typeof dbMock) => Promise<unknown>) => {
    return fn(dbMock)
  })
}

vi.mock('@/db', () => ({
  db: dbMock,
  inventoryAdjustments: {
    id: 'inventory_adjustments.id',
    businessId: 'inventory_adjustments.business_id',
    productId: 'inventory_adjustments.product_id',
    createdByUserId: 'inventory_adjustments.created_by_user_id',
    delta: 'inventory_adjustments.delta',
    reason: 'inventory_adjustments.reason',
    relatedExpenseId: 'inventory_adjustments.related_expense_id',
    createdAt: 'inventory_adjustments.created_at',
  },
  expenses: {
    id: 'expenses.id',
    businessId: 'expenses.business_id',
    createdByUserId: 'expenses.created_by_user_id',
    expenseNumber: 'expenses.expense_number',
    date: 'expenses.date',
    amount: 'expenses.amount',
    categoryId: 'expenses.category_id',
    note: 'expenses.note',
    photoUrl: 'expenses.photo_url',
    createdAt: 'expenses.created_at',
    updatedAt: 'expenses.updated_at',
  },
  businesses: {
    id: 'businesses.id',
    nextExpenseNumber: 'businesses.next_expense_number',
  },
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

// --- Constants ---
const BUSINESS_ID = 'biz-inv-test-01'
const USER_ID = 'user-inv-test-01'
const PRODUCT_ID = 'prod-inv-test-01'

const ACCESS = {
  userId: USER_ID,
  businessId: BUSINESS_ID,
  businessName: 'Test Biz',
  businessIcon: null,
  businessLocale: 'en-US',
  businessCurrency: 'USD',
  role: 'owner' as const,
}

function makeRequest(
  method: 'GET' | 'POST',
  body?: unknown,
  searchParams?: Record<string, string>,
): Request {
  const url = new URL(
    `http://localhost:8000/api/businesses/${BUSINESS_ID}/inventory-adjustments`,
  )
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
  }
  const json = body !== undefined ? JSON.stringify(body) : undefined
  return new Request(url.toString(), {
    method,
    headers: {
      'content-type': 'application/json',
      'content-length': json ? String(json.length) : '0',
      origin: 'http://localhost:8000',
      host: 'localhost:8000',
    },
    body: json,
  })
}

const ROUTE_PARAMS = { params: Promise.resolve({ businessId: BUSINESS_ID }) }

const NOW = new Date()
const PRODUCT_ROW = {
  id: PRODUCT_ID,
  businessId: BUSINESS_ID,
  name: 'Widget',
  price: 9.99,
  stock: 10,
}

const ADJ_ROW = {
  id: ADJ_ID,
  businessId: BUSINESS_ID,
  productId: PRODUCT_ID,
  createdByUserId: USER_ID,
  delta: 5,
  reason: null,
  relatedExpenseId: null,
  createdAt: NOW,
}

const EXPENSE_ROW = {
  id: EXPENSE_ID,
  businessId: BUSINESS_ID,
  createdByUserId: USER_ID,
  expenseNumber: 1,
  date: NOW,
  amount: 25.0,
  categoryId: null,
  note: null,
  photoUrl: null,
  createdAt: NOW,
  updatedAt: NOW,
}

beforeEach(() => {
  publishToBusiness.mockReset().mockResolvedValue(undefined)
  requireBusinessAccess.mockReset().mockResolvedValue(ACCESS)
  selectQueue = []
  insertReturningQueue = []
  // Route calls nanoid() for adjustmentId first, then for expenseId (if expense payload).
  nanoidImpl.mockReset().mockReturnValueOnce(ADJ_ID).mockReturnValue(EXPENSE_ID)
  resetDbMock()
})

// ===========================================================================
// POST /inventory-adjustments
// ===========================================================================

describe('POST /inventory-adjustments', () => {
  it('creates adjustment only (no expense payload)', async () => {
    // select calls: [0] product check; adjustment comes back via INSERT RETURNING
    selectQueue = [[PRODUCT_ROW]]
    insertReturningQueue = [[ADJ_ROW]]
    resetDbMock()

    const { POST } = await import('../route')
    const res = await POST(
      makeRequest('POST', { productId: PRODUCT_ID, delta: 5 }) as Parameters<typeof POST>[0],
      ROUTE_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.messageCode).toBe('INVENTORY_ADJUSTMENT_CREATED')
    expect(body.data.expense).toBeNull()
    expect(body.data.adjustment.delta).toBe(5)
  })

  it('creates adjustment + expense atomically, relatedExpenseId is set', async () => {
    const adjRowWithExpense = { ...ADJ_ROW, relatedExpenseId: EXPENSE_ID, delta: -3 }
    // select calls: [0] product check; INSERT RETURNING order: expense, then adjustment
    selectQueue = [[PRODUCT_ROW]]
    insertReturningQueue = [[EXPENSE_ROW], [adjRowWithExpense]]
    resetDbMock()

    const { POST } = await import('../route')
    const res = await POST(
      makeRequest('POST', {
        productId: PRODUCT_ID,
        delta: -3,
        reason: 'spoilage',
        expense: { amount: 25.0, categoryId: null },
      }) as Parameters<typeof POST>[0],
      ROUTE_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.messageCode).toBe('INVENTORY_ADJUSTMENT_CREATED')
    expect(body.data.adjustment.relatedExpenseId).toBe(EXPENSE_ID)
    expect(body.data.expense).not.toBeNull()
    expect(body.data.expense.amount).toBe(25.0)
  })

  it('returns 400 INVENTORY_ADJUSTMENT_INVALID_DELTA when delta=0', async () => {
    const { POST } = await import('../route')
    const res = await POST(
      makeRequest('POST', { productId: PRODUCT_ID, delta: 0 }) as Parameters<typeof POST>[0],
      ROUTE_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.messageCode).toBe('INVENTORY_ADJUSTMENT_INVALID_DELTA')
  })

  it('returns 400 PRODUCT_NOT_FOUND_FOR_ADJUSTMENT when product not in business', async () => {
    // Product check returns empty array
    selectQueue = [[]]
    resetDbMock()

    const { POST } = await import('../route')
    const res = await POST(
      makeRequest('POST', { productId: 'nonexistent-product', delta: 1 }) as Parameters<
        typeof POST
      >[0],
      ROUTE_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.messageCode).toBe('PRODUCT_NOT_FOUND_FOR_ADJUSTMENT')
  })

  it('returns 403 INVENTORY_ADJUSTMENT_FORBIDDEN_NOT_MANAGER for employee role', async () => {
    requireBusinessAccess.mockResolvedValue({ ...ACCESS, role: 'employee' as const })

    const { POST } = await import('../route')
    const res = await POST(
      makeRequest('POST', { productId: PRODUCT_ID, delta: 1 }) as Parameters<typeof POST>[0],
      ROUTE_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.messageCode).toBe('INVENTORY_ADJUSTMENT_FORBIDDEN_NOT_MANAGER')
  })

  it('publishes inventory.adjusted event', async () => {
    selectQueue = [[PRODUCT_ROW]]
    insertReturningQueue = [[ADJ_ROW]]
    resetDbMock()

    const { POST } = await import('../route')
    await POST(
      makeRequest('POST', { productId: PRODUCT_ID, delta: 2 }) as Parameters<typeof POST>[0],
      ROUTE_PARAMS,
    )

    await new Promise((r) => setTimeout(r, 0))
    expect(publishToBusiness).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({ type: 'inventory.adjusted', productId: PRODUCT_ID }),
      undefined,
    )
  })

  it('publishes expense.created only when expense payload is present', async () => {
    // With expense payload — should publish expense.created
    const adjRowWithExpense = { ...ADJ_ROW, relatedExpenseId: EXPENSE_ID }
    selectQueue = [[PRODUCT_ROW]]
    insertReturningQueue = [[EXPENSE_ROW], [adjRowWithExpense]]
    resetDbMock()

    const { POST } = await import('../route')
    await POST(
      makeRequest('POST', {
        productId: PRODUCT_ID,
        delta: 1,
        expense: { amount: 10 },
      }) as Parameters<typeof POST>[0],
      ROUTE_PARAMS,
    )

    await new Promise((r) => setTimeout(r, 0))
    const withExpenseCalls = publishToBusiness.mock.calls
    const expenseCreatedCall = withExpenseCalls.find(([, event]) => event.type === 'expense.created')
    expect(expenseCreatedCall).toBeDefined()

    // Without expense payload — should NOT publish expense.created
    publishToBusiness.mockReset().mockResolvedValue(undefined)
    selectQueue = [[PRODUCT_ROW]]
    insertReturningQueue = [[ADJ_ROW]]
    resetDbMock()

    await POST(
      makeRequest('POST', { productId: PRODUCT_ID, delta: 1 }) as Parameters<typeof POST>[0],
      ROUTE_PARAMS,
    )

    await new Promise((r) => setTimeout(r, 0))
    const noExpenseCalls = publishToBusiness.mock.calls
    const noExpenseCreatedCall = noExpenseCalls.find(([, event]) => event.type === 'expense.created')
    expect(noExpenseCreatedCall).toBeUndefined()
  })
})

// ===========================================================================
// GET /inventory-adjustments
// ===========================================================================

describe('GET /inventory-adjustments', () => {
  it('lists in newest-first order', async () => {
    const rows = [
      { ...ADJ_ROW, id: 'adj-3', delta: 3, createdAt: new Date(3000) },
      { ...ADJ_ROW, id: 'adj-2', delta: 2, createdAt: new Date(2000) },
      { ...ADJ_ROW, id: 'adj-1', delta: 1, createdAt: new Date(1000) },
    ]
    selectQueue = [rows]
    resetDbMock()

    const { GET } = await import('../route')
    const res = await GET(
      makeRequest('GET') as Parameters<typeof GET>[0],
      ROUTE_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.length).toBe(3)
    expect(body.data[0].id).toBe('adj-3')
  })

  it('filters by productId query param', async () => {
    const rows = [{ ...ADJ_ROW, id: 'adj-filtered', productId: 'other-product' }]
    selectQueue = [rows]
    resetDbMock()

    const { GET } = await import('../route')
    const res = await GET(
      makeRequest('GET', undefined, { productId: 'other-product' }) as Parameters<typeof GET>[0],
      ROUTE_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.length).toBe(1)
  })

  it('returns nextCursor when more results exist (limit+1 rows)', async () => {
    // Two rows returned for limit=1, triggers pagination
    const rows = [
      { ...ADJ_ROW, id: 'adj-a', createdAt: new Date(2000) },
      { ...ADJ_ROW, id: 'adj-b', createdAt: new Date(1000) },
    ]
    selectQueue = [rows]
    resetDbMock()

    const { GET } = await import('../route')
    const res = await GET(
      makeRequest('GET', undefined, { limit: '1' }) as Parameters<typeof GET>[0],
      ROUTE_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.length).toBe(1)
    expect(body.nextCursor).not.toBeNull()
  })

  it('returns null nextCursor when all results fit', async () => {
    selectQueue = [[ADJ_ROW]]
    resetDbMock()

    const { GET } = await import('../route')
    const res = await GET(
      makeRequest('GET') as Parameters<typeof GET>[0],
      ROUTE_PARAMS,
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.nextCursor).toBeNull()
  })
})
