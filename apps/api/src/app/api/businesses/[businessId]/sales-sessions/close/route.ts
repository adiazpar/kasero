import { db, salesSessions, sales } from '@/db'
import { and, eq, isNull, sql } from 'drizzle-orm'
import {
  withBusinessAuth,
  enforceMaxContentLength,
  errorResponse,
  successResponse,
  validationError,
} from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { canManageBusiness } from '@kasero/shared/business-role'
import { closeSessionSchema } from '../schema'
import { computeExpectedCash, computeVariance } from '@kasero/shared/sales-helpers'
import { publishToBusiness, getOriginDeviceId } from '@/lib/realtime'
import type { SalesSession } from '@kasero/shared/types/sale'

const POST_MAX_BODY_BYTES = 4 * 1024  // notes can be up to ~500 chars

/**
 * POST /api/businesses/[businessId]/sales-sessions/close
 *
 * Close the currently open session for the business. Inside one
 * db.transaction:
 *   1. Conditional UPDATE that closes the session row IFF closed_at IS NULL.
 *      Returns 0 rows if another close raced through; we map to SESSION_NOT_OPEN.
 *      The CAS UPDATE doubles as a SQLite write-lock acquisition, serializing
 *      against any concurrent sale POST that runs its own CAS sentinel.
 *   2. Aggregate sales for this session.
 *   3. UPDATE the same session row with denormalized totals + counted + variance.
 */
export const POST = withBusinessAuth(async (request, access) => {
  const originDeviceId = getOriginDeviceId(request)
  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.SESSION_FORBIDDEN_NOT_MANAGER, 403)
  }

  const oversize = enforceMaxContentLength(request, POST_MAX_BODY_BYTES)
  if (oversize) return oversize

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return errorResponse(ApiMessageCode.VALIDATION_GENERIC, 400)
  }

  const parsed = closeSessionSchema.safeParse(raw)
  if (!parsed.success) return validationError(parsed)
  const body = parsed.data

  const currency = access.businessCurrency ?? 'USD'
  const closedAt = new Date()

  try {
    const closed = await db.transaction(async (tx) => {
      // Step 1: CAS — close the open session in one statement.
      const claimed = await tx
        .update(salesSessions)
        .set({
          closedAt,
          closedByUserId: access.userId,
          notes: body.notes ?? null,
        })
        .where(
          and(
            eq(salesSessions.businessId, access.businessId),
            isNull(salesSessions.closedAt),
          ),
        )
        .returning({
          id: salesSessions.id,
          startingCash: salesSessions.startingCash,
        })
        .all()

      if (claimed.length === 0) {
        throw new SessionNotOpenError()
      }

      const sessionId = claimed[0].id
      const startingCash = claimed[0].startingCash

      // Step 2: Aggregate sales for this session.
      const aggRow = await tx
        .select({
          salesCount: sql<number>`COUNT(*)`,
          salesTotal: sql<number>`COALESCE(SUM(${sales.total}), 0)`,
          cashSalesTotal: sql<number>`COALESCE(SUM(CASE WHEN ${sales.paymentMethod} = 'cash' THEN ${sales.total} ELSE 0 END), 0)`,
        })
        .from(sales)
        .where(eq(sales.sessionId, sessionId))
        .get()

      const salesCount = Number(aggRow?.salesCount ?? 0)
      const salesTotal = Number(aggRow?.salesTotal ?? 0)
      const cashSalesTotal = Number(aggRow?.cashSalesTotal ?? 0)

      const expectedCash = computeExpectedCash(startingCash, cashSalesTotal, currency)
      const variance = computeVariance(body.countedCash, expectedCash, currency)

      // Step 3: Stamp denormalized stats.
      await tx
        .update(salesSessions)
        .set({
          countedCash: body.countedCash,
          salesCount,
          salesTotal,
          cashSalesTotal,
          expectedCash,
          variance,
        })
        .where(eq(salesSessions.id, sessionId))

      return { sessionId }
    })

    // Re-read the row to fill in the open-phase fields (openedAt, openedByUserId).
    const fullRow = await db
      .select()
      .from(salesSessions)
      .where(eq(salesSessions.id, closed.sessionId))
      .get()

    if (!fullRow) {
      return errorResponse(ApiMessageCode.SESSION_NOT_FOUND, 404)
    }

    await publishToBusiness(
      access.businessId,
      { type: 'sales_session.closed', sessionId: closed.sessionId },
      originDeviceId,
    )

    return successResponse({
      session: serialize(fullRow),
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
    super('No open session to close')
  }
}

function serialize(row: typeof salesSessions.$inferSelect): SalesSession {
  return {
    id: row.id,
    openedAt: row.openedAt.toISOString(),
    openedByUserId: row.openedByUserId,
    startingCash: row.startingCash,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    closedByUserId: row.closedByUserId,
    countedCash: row.countedCash,
    salesCount: row.salesCount,
    salesTotal: row.salesTotal,
    cashSalesTotal: row.cashSalesTotal,
    expectedCash: row.expectedCash,
    variance: row.variance,
    notes: row.notes,
  }
}
