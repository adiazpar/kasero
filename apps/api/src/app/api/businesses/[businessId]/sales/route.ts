import { db, sales, saleItems, products, businesses, salesSessions } from '@/db'
import { eq, inArray, and, or, sql, desc, gte, lt, lte, isNull } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import {
  withBusinessAuth,
  enforceMaxContentLength,
  errorResponse,
  successResponse,
  validationError,
} from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { roundToCurrencyDecimals, startOfUtcDay, startOfPrevUtcDay } from '@kasero/shared/sales-helpers'
import { publishToBusiness, getOriginDeviceId } from '@/lib/realtime'
import { postSaleSchema } from './schema'

// 64KB easily covers 100 lines + 1000-char notes.
const POST_MAX_BODY_BYTES = 64 * 1024

// Date constraints: max +1min in the future for clock skew, min 1 year ago.
const ONE_MINUTE_MS = 60 * 1000
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000

/**
 * POST /api/businesses/[businessId]/sales
 *
 * Create a sale. Any active business member (owner, partner, employee) can
 * ring up sales — no canManageBusiness gate (matches the orders/[id]/receive
 * floor-staff policy). Server snapshots prices, decrements stock atomically,
 * and assigns a sequential saleNumber.
 */
export const POST = withBusinessAuth(async (request, access) => {
  const originDeviceId = getOriginDeviceId(request)
  const oversize = enforceMaxContentLength(request, POST_MAX_BODY_BYTES)
  if (oversize) return oversize

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return errorResponse(ApiMessageCode.VALIDATION_GENERIC, 400)
  }

  const parsed = postSaleSchema.safeParse(raw)
  if (!parsed.success) return validationError(parsed)
  const body = parsed.data

  const now = new Date()
  const saleDate = body.date ? new Date(body.date) : now
  // Reject Invalid Date BEFORE the range check. NaN comparisons
  // always evaluate to false, so an invalid string would otherwise
  // sail through as "neither in the future nor in the past" and land
  // a NaN timestamp in the row.
  if (!Number.isFinite(saleDate.getTime())) {
    return errorResponse(ApiMessageCode.SALE_INVALID_DATE, 400)
  }
  if (
    saleDate.getTime() > now.getTime() + ONE_MINUTE_MS ||
    saleDate.getTime() < now.getTime() - ONE_YEAR_MS
  ) {
    return errorResponse(ApiMessageCode.SALE_INVALID_DATE, 400)
  }

  const productIds = body.items.map((i) => i.productId)
  const productsList = await db
    .select({
      id: products.id,
      name: products.name,
      price: products.price,
      active: products.active,
      stock: products.stock,
    })
    .from(products)
    .where(and(eq(products.businessId, access.businessId), inArray(products.id, productIds)))

  const productsMap = new Map(productsList.map((p) => [p.id, p]))

  for (const item of body.items) {
    const product = productsMap.get(item.productId)
    if (!product) {
      return errorResponse(ApiMessageCode.SALE_PRODUCT_NOT_FOUND, 400, { productId: item.productId })
    }
    if (!product.active) {
      return errorResponse(ApiMessageCode.SALE_PRODUCT_INACTIVE, 400, { productId: item.productId, name: product.name })
    }
  }

  const hasInsufficientStock = body.items.some((item) => {
    const product = productsMap.get(item.productId)!
    return item.quantity > (product.stock ?? 0)
  })
  if (hasInsufficientStock) {
    return errorResponse(ApiMessageCode.SALE_INSUFFICIENT_STOCK, 409)
  }

  const currency = access.businessCurrency ?? 'USD'

  const lineRows = body.items.map((item) => {
    const product = productsMap.get(item.productId)!
    const unitPrice = product.price
    const subtotal = roundToCurrencyDecimals(unitPrice * item.quantity, currency)
    return {
      id: nanoid(),
      productId: item.productId,
      productName: product.name,
      quantity: item.quantity,
      unitPrice,
      subtotal,
    }
  })
  const total = roundToCurrencyDecimals(
    lineRows.reduce((acc, r) => acc + r.subtotal, 0),
    currency,
  )

  const saleId = nanoid()
  const createdAt = new Date()

  try {
    const result = await db.transaction(async (tx) => {
      // CAS sentinel: claim the open session row by writing to it. The
      // matching UPDATE acquires SQLite's write lock; concurrent close
      // transactions are blocked or, if they committed first, this
      // returns 0 rows and we throw SessionNotOpenError.
      const claimed = await tx
        .update(salesSessions)
        .set({ openedAt: salesSessions.openedAt })
        .where(
          and(
            eq(salesSessions.businessId, access.businessId),
            isNull(salesSessions.closedAt),
          ),
        )
        .returning({ id: salesSessions.id })
        .all()

      if (claimed.length === 0) {
        throw new SessionNotOpenError()
      }
      const openSessionId = claimed[0].id

      // Reserve sale_number atomically inside the transaction.
      const reservation = await tx
        .update(businesses)
        .set({ nextSaleNumber: sql`${businesses.nextSaleNumber} + 1` })
        .where(eq(businesses.id, access.businessId))
        .returning({ reserved: sql<number>`${businesses.nextSaleNumber} - 1` })
      const saleNumber = Number(reservation[0]?.reserved ?? 1)

      // Insert sale + items + decrement stock.
      await tx.insert(sales).values({
        id: saleId,
        businessId: access.businessId,
        saleNumber,
        sessionId: openSessionId,
        createdByUserId: access.userId,
        date: saleDate,
        total,
        paymentMethod: body.paymentMethod,
        notes: body.notes ?? null,
        createdAt,
      })

      await tx.insert(saleItems).values(
        lineRows.map((r) => ({
          id: r.id,
          saleId,
          productId: r.productId,
          productName: r.productName,
          quantity: r.quantity,
          unitPrice: r.unitPrice,
        })),
      )

      for (const r of lineRows) {
        await tx
          .update(products)
          .set({ stock: sql`${products.stock} - ${r.quantity}` })
          .where(and(eq(products.id, r.productId), eq(products.businessId, access.businessId)))
      }

      return { openSessionId, saleNumber }
    })

    // Fire-and-forget hint. The receiving client's handler refetches
    // both `sales` (the new row) and `products` (the stock decrement
    // cascade) — see apps/web/src/lib/realtime/handlers.ts.
    await publishToBusiness(
      access.businessId,
      { type: 'sale.created', saleId },
      originDeviceId,
    )

    return successResponse({
      sale: {
        id: saleId,
        saleNumber: result.saleNumber,
        sessionId: result.openSessionId,
        date: saleDate.toISOString(),
        total,
        paymentMethod: body.paymentMethod,
        notes: body.notes ?? null,
        items: lineRows.map((r) => ({
          productId: r.productId,
          productName: r.productName,
          quantity: r.quantity,
          unitPrice: r.unitPrice,
          subtotal: r.subtotal,
        })),
        createdByUserId: access.userId,
        createdAt: createdAt.toISOString(),
      },
    })
  } catch (err) {
    if (err instanceof SessionNotOpenError) {
      return errorResponse(ApiMessageCode.SESSION_NOT_OPEN, 409)
    }
    throw err
  }
})

class SessionNotOpenError extends Error {
  constructor() {
    super('No open session for this business')
  }
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/**
 * GET /api/businesses/[businessId]/sales
 *
 * List sales with their items, sorted by date DESC. Supports keyset
 * pagination via `?cursor=<saleId>` and optional `?include=stats`.
 *
 * Filters: from (ISO), to (ISO), paymentMethod.
 */
export const GET = withBusinessAuth(async (request, access) => {
  const { searchParams } = new URL(request.url)
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')
  const paymentMethodParam = searchParams.get('paymentMethod')
  const limitParam = searchParams.get('limit')
  const cursorParam = searchParams.get('cursor')
  const includeParam = searchParams.get('include')

  const parsedLimit = limitParam ? parseInt(limitParam, 10) : NaN
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(1, parsedLimit), MAX_LIMIT)
    : DEFAULT_LIMIT

  const conditions = [eq(sales.businessId, access.businessId)]
  if (fromParam) conditions.push(gte(sales.date, new Date(fromParam)))
  if (toParam) conditions.push(lte(sales.date, new Date(toParam)))
  if (paymentMethodParam === 'cash' || paymentMethodParam === 'card' || paymentMethodParam === 'other') {
    conditions.push(eq(sales.paymentMethod, paymentMethodParam))
  }

  const sessionIdParam = searchParams.get('sessionId')
  if (sessionIdParam) {
    conditions.push(eq(sales.sessionId, sessionIdParam))
  }

  // Keyset pagination: load the cursor's date and id, then continue from
  // anything strictly older in (date DESC, id DESC) order. The compound
  // predicate is required because two sales can share the same `date`
  // value (rapid ringup, backdates colliding on day boundaries) — a
  // date-only predicate would silently skip the rest of the tied bucket.
  if (cursorParam) {
    const cursorRow = await db
      .select({ date: sales.date, id: sales.id })
      .from(sales)
      .where(and(eq(sales.id, cursorParam), eq(sales.businessId, access.businessId)))
      .get()
    if (cursorRow) {
      conditions.push(
        or(
          lt(sales.date, cursorRow.date),
          and(eq(sales.date, cursorRow.date), lt(sales.id, cursorRow.id)),
        )!
      )
    }
  }

  const rows = await db
    .select()
    .from(sales)
    .where(and(...conditions))
    .orderBy(desc(sales.date), desc(sales.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const slice = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore ? slice[slice.length - 1].id : null

  // Hydrate items.
  const saleIds = slice.map((s) => s.id)
  const items = saleIds.length
    ? await db.select().from(saleItems).where(inArray(saleItems.saleId, saleIds))
    : []
  const itemsBySaleId = new Map<string, typeof items>()
  for (const item of items) {
    const list = itemsBySaleId.get(item.saleId) ?? []
    list.push(item)
    itemsBySaleId.set(item.saleId, list)
  }

  const currency = access.businessCurrency ?? 'USD'

  const expandedSales = slice.map((sale) => ({
    id: sale.id,
    saleNumber: sale.saleNumber,
    sessionId: sale.sessionId,
    date: sale.date.toISOString(),
    total: sale.total,
    paymentMethod: sale.paymentMethod,
    notes: sale.notes,
    items: (itemsBySaleId.get(sale.id) ?? []).map((it) => ({
      productId: it.productId,
      productName: it.productName,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      subtotal: roundToCurrencyDecimals(it.quantity * it.unitPrice, currency),
    })),
    createdByUserId: sale.createdByUserId,
    createdAt: sale.createdAt.toISOString(),
  }))

  // Optional inline stats.
  let stats: StatsResult | undefined
  if (includeParam?.split(',').includes('stats')) {
    stats = await computeStats(access.businessId)
  }

  return successResponse({
    sales: expandedSales,
    nextCursor,
    ...(stats !== undefined ? { stats } : {}),
  })
})

interface StatsResult {
  todayRevenue: number
  todayCount: number
  todayAvgTicket: number | null
  yesterdayRevenue: number
  vsYesterdayPct: number | null
}

async function computeStats(businessId: string): Promise<StatsResult> {
  const now = new Date()
  const todayStart = startOfUtcDay(now)
  const yesterdayStart = startOfPrevUtcDay(now)

  const todayRows = await db
    .select({ total: sales.total })
    .from(sales)
    .where(and(eq(sales.businessId, businessId), gte(sales.date, todayStart)))

  const yesterdayRows = await db
    .select({ total: sales.total })
    .from(sales)
    .where(
      and(
        eq(sales.businessId, businessId),
        gte(sales.date, yesterdayStart),
        lt(sales.date, todayStart),
      ),
    )

  const todayRevenue = todayRows.reduce((acc, r) => acc + r.total, 0)
  const todayCount = todayRows.length
  const yesterdayRevenue = yesterdayRows.reduce((acc, r) => acc + r.total, 0)
  const todayAvgTicket = todayCount > 0 ? todayRevenue / todayCount : null
  const vsYesterdayPct =
    yesterdayRevenue > 0
      ? ((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100
      : null

  return {
    todayRevenue,
    todayCount,
    todayAvgTicket,
    yesterdayRevenue,
    vsYesterdayPct,
  }
}
