import { db, sales, salesSessions } from '@/db'
import { and, eq, desc, lt, or } from 'drizzle-orm'
import { withBusinessAuth, errorResponse, successResponse } from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/**
 * GET /api/businesses/[businessId]/sales-sessions/[id]/sales
 *
 * Lightweight projection of sales for a session. No items, no product
 * joins — caller fetches sale items lazily via existing /sales/[id].
 *
 * Sort: createdAt DESC, id DESC. Keyset paginated.
 */
export const GET = withBusinessAuth(async (request, access, params) => {
  const sessionId = params.id
  if (!sessionId) return errorResponse(ApiMessageCode.SESSION_NOT_FOUND, 404)

  // Confirm the session exists and belongs to this business.
  const session = await db
    .select({ id: salesSessions.id })
    .from(salesSessions)
    .where(
      and(
        eq(salesSessions.id, sessionId),
        eq(salesSessions.businessId, access.businessId),
      ),
    )
    .get()
  if (!session) return errorResponse(ApiMessageCode.SESSION_NOT_FOUND, 404)

  const { searchParams } = new URL(request.url)
  const limitParam = searchParams.get('limit')
  const cursorParam = searchParams.get('cursor')

  const parsedLimit = limitParam ? parseInt(limitParam, 10) : NaN
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(1, parsedLimit), MAX_LIMIT)
    : DEFAULT_LIMIT

  const conditions = [eq(sales.sessionId, sessionId)]

  if (cursorParam) {
    const cursorRow = await db
      .select({ createdAt: sales.createdAt, id: sales.id })
      .from(sales)
      .where(and(eq(sales.id, cursorParam), eq(sales.businessId, access.businessId)))
      .get()
    if (cursorRow) {
      conditions.push(
        or(
          lt(sales.createdAt, cursorRow.createdAt),
          and(eq(sales.createdAt, cursorRow.createdAt), lt(sales.id, cursorRow.id)),
        )!,
      )
    }
  }

  const rows = await db
    .select({
      id: sales.id,
      saleNumber: sales.saleNumber,
      total: sales.total,
      paymentMethod: sales.paymentMethod,
      status: sales.status,
      createdAt: sales.createdAt,
      date: sales.date,
    })
    .from(sales)
    .where(and(...conditions))
    .orderBy(desc(sales.createdAt), desc(sales.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const slice = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore ? slice[slice.length - 1].id : null

  const projected = slice.map((s) => ({
    id: s.id,
    saleNumber: s.saleNumber,
    total: s.total,
    paymentMethod: s.paymentMethod,
    // Voided sales stay in the list (rendered struck-through client-side).
    status: s.status,
    createdAt: s.createdAt.toISOString(),
    date: s.date.toISOString(),
  }))

  return successResponse({ sales: projected, nextCursor })
})
