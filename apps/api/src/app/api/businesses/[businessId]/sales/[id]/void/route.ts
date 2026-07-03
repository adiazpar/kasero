import { db, sales, saleItems } from '@/db'
import { eq, and } from 'drizzle-orm'
import { withBusinessAuth, errorResponse, successResponse } from '@/lib/api-middleware'
import { canManageBusiness } from '@/lib/business-auth'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { applyStockDeltas } from '@/lib/sales-stock'
import { publishToBusiness, getOriginDeviceId } from '@/lib/realtime'

/**
 * POST /api/businesses/[businessId]/sales/[id]/void
 *
 * Void (reverse) a completed sale. Owner/partner only — employees can ring
 * up sales but cannot reverse them (mirrors the sales-sessions close gate).
 *
 * Inside one db.transaction:
 *   1. CAS UPDATE that flips status completed -> voided IFF it is still
 *      'completed'. 0 rows means either the sale doesn't exist / belongs to
 *      another business (404) or it was already voided (409) — disambiguated
 *      by a follow-up SELECT.
 *   2. Restore the stock the sale decremented with a single CASE UPDATE
 *      (the exact reverse of the decrement in POST /sales). Line items whose
 *      product was deleted since the sale (productId NULL) are skipped.
 *
 * Voided sales stay in history (rendered struck-through) and are excluded
 * from every revenue aggregation. NOTE: closed sales-sessions keep their
 * denormalized close-time stats — a session close is a settled cash-drawer
 * reconciliation snapshot, and voiding a sale afterwards does NOT rewrite
 * those numbers. Only live aggregations (stats, aggregate, summary, and the
 * close of a still-open session) exclude the voided sale.
 */
export const POST = withBusinessAuth(async (request, access, params) => {
  const originDeviceId = getOriginDeviceId(request)

  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.SALE_VOID_FORBIDDEN_NOT_MANAGER, 403)
  }

  const id = params?.id
  if (!id) return errorResponse(ApiMessageCode.SALE_NOT_FOUND, 404)

  const voidedAt = new Date()

  try {
    const voided = await db.transaction(async (tx) => {
      // Step 1: CAS — only a currently-completed sale can be voided. The
      // UPDATE also acquires SQLite's write lock, serializing concurrent
      // void attempts on the same row.
      const claimed = await tx
        .update(sales)
        .set({ status: 'voided', voidedAt, voidedBy: access.userId })
        .where(
          and(
            eq(sales.id, id),
            eq(sales.businessId, access.businessId),
            eq(sales.status, 'completed'),
          ),
        )
        .returning()
        .all()

      if (claimed.length === 0) {
        // Disambiguate 404 vs 409.
        const existing = await tx
          .select({ status: sales.status })
          .from(sales)
          .where(and(eq(sales.id, id), eq(sales.businessId, access.businessId)))
          .get()
        if (existing?.status === 'voided') throw new AlreadyVoidedError()
        throw new SaleNotFoundError()
      }

      const sale = claimed[0]

      // Step 2: restore stock — single CASE UPDATE, the reverse of the
      // sale-create decrement. Quantities are pre-aggregated per product so
      // a sale carrying the same product on two lines restores the sum.
      const items = await tx
        .select({
          productId: saleItems.productId,
          quantity: saleItems.quantity,
        })
        .from(saleItems)
        .where(eq(saleItems.saleId, id))

      // Positive per-product deltas restore exactly what the sale-create
      // decrement consumed — the exact reverse, via the shared CASE builder
      // (see applyStockDeltas). Pre-aggregated so a sale carrying the same
      // product on two lines restores the summed quantity; an empty map
      // (every line's product later deleted) is a no-op.
      const stockDeltas = new Map<string, number>()
      for (const it of items) {
        // productId is NULL when the product was deleted after the sale —
        // there is no stock row left to restore.
        if (!it.productId) continue
        stockDeltas.set(it.productId, (stockDeltas.get(it.productId) ?? 0) + it.quantity)
      }
      await applyStockDeltas(tx, access.businessId, stockDeltas)

      return sale
    })

    // Fire-and-forget hint after the commit. Receivers refetch both
    // `sales` (the status flip) and `products` (the stock restoration
    // cascade) — see apps/web/src/lib/realtime/handlers.ts.
    await publishToBusiness(
      access.businessId,
      { type: 'sale.voided', saleId: id },
      originDeviceId,
    )

    return successResponse(
      {
        sale: {
          id: voided.id,
          saleNumber: voided.saleNumber,
          sessionId: voided.sessionId,
          date: voided.date.toISOString(),
          total: voided.total,
          paymentMethod: voided.paymentMethod,
          notes: voided.notes,
          status: voided.status,
          voidedAt: voided.voidedAt ? voided.voidedAt.toISOString() : null,
          voidedBy: voided.voidedBy,
          discountAmount: voided.discountAmount,
          taxRate: voided.taxRate,
          taxAmount: voided.taxAmount,
          taxMode: voided.taxMode,
          createdByUserId: voided.createdByUserId,
          createdAt: voided.createdAt.toISOString(),
        },
      },
      ApiMessageCode.SALE_VOIDED,
    )
  } catch (err) {
    if (err instanceof AlreadyVoidedError) {
      return errorResponse(ApiMessageCode.SALE_ALREADY_VOIDED, 409)
    }
    if (err instanceof SaleNotFoundError) {
      return errorResponse(ApiMessageCode.SALE_NOT_FOUND, 404)
    }
    throw err
  }
})

class AlreadyVoidedError extends Error {
  constructor() {
    super('Sale is already voided')
  }
}

class SaleNotFoundError extends Error {
  constructor() {
    super('Sale not found')
  }
}
