import { db, products } from '@/db'
import { eq, and, sql } from 'drizzle-orm'
import { z } from 'zod'
import { withBusinessAuth, validationError, errorResponse, successResponse } from '@/lib/api-middleware'
import { canManageBusiness } from '@/lib/business-auth'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { publishToBusiness, getOriginDeviceId } from '@/lib/realtime'

// Two payload shapes are accepted:
//
//   1. { delta: number }
//      Atomic increment/decrement. Used by inline +/- controls.
//      Final stock is always bounded server-side: deltas that would
//      drive stock below 0 or above 1M are rejected at the SQL level
//      via the WHERE clause (rejected = "no row updated" = 409).
//
//   2. { stock: number, expectedStock: number }
//      Optimistic-locked absolute set. Used by the edit modal that
//      reads `editingProduct.stock`, lets the user type a new value,
//      and submits both. The UPDATE only writes if the row's current
//      stock still matches `expectedStock` — otherwise another
//      manager edited it concurrently and we return 409 with
//      STOCK_CONCURRENCY_CONFLICT so the client can refresh.
//
// The previous shape `{ stock: number }` was a silent last-write-wins:
// two managers typing different values into the inventory dialog could
// each save successfully, with the second write overwriting the first
// without warning. Lost-update bug, not a security boundary, but real
// data-integrity damage.
const STOCK_CAP = 1_000_000
const stockSchema = z.union([
  z.object({
    delta: z.number().int().min(-STOCK_CAP).max(STOCK_CAP),
  }),
  z.object({
    stock: z.number().int().min(0).max(STOCK_CAP),
    expectedStock: z.number().int().min(0).max(STOCK_CAP),
  }),
])

/**
 * PATCH /api/businesses/[businessId]/products/[id]/stock
 *
 * Adjust product stock.
 */
export const PATCH = withBusinessAuth(async (request, access, routeParams) => {
  // Only partners and owners can adjust stock — employees are read-only.
  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.PRODUCT_FORBIDDEN_NOT_MANAGER, 403)
  }

  const id = routeParams?.id
  if (!id) {
    return errorResponse(ApiMessageCode.PRODUCT_ID_REQUIRED, 400)
  }

  const originDeviceId = getOriginDeviceId(request)

  // Verify product exists and belongs to business
  const [existingProduct] = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.id, id),
        eq(products.businessId, access.businessId)
      )
    )
    .limit(1)

  if (!existingProduct) {
    return errorResponse(ApiMessageCode.PRODUCT_NOT_FOUND, 404)
  }

  const body = await request.json()
  const validation = stockSchema.safeParse(body)

  if (!validation.success) {
    return validationError(validation)
  }

  const data = validation.data

  if ('delta' in data) {
    // Atomic increment/decrement. The WHERE-clause bounds reject any
    // delta that would push stock outside [0, STOCK_CAP] without ever
    // computing the result client-side; a pathological caller can't
    // race the cap. .returning() lets us hand the new stock back to
    // the client without a follow-up SELECT.
    const updated = await db
      .update(products)
      .set({ stock: sql`${products.stock} + ${data.delta}`, updatedAt: new Date() })
      .where(
        and(
          eq(products.id, id),
          eq(products.businessId, access.businessId),
          // Bounds check inline so out-of-range deltas reject as 409
          // rather than corrupting the row.
          sql`${products.stock} + ${data.delta} >= 0`,
          sql`${products.stock} + ${data.delta} <= ${STOCK_CAP}`,
        ),
      )
      .returning({ stock: products.stock })

    if (updated.length === 0) {
      return errorResponse(ApiMessageCode.STOCK_INVALID, 409)
    }
    await publishToBusiness(
      access.businessId,
      { type: 'product.updated', productId: id, fields: ['stock'] },
      originDeviceId,
    )
    return successResponse({ stock: updated[0].stock })
  }

  // Absolute-set with optimistic lock. WHERE matches only when the
  // current stock equals what the client read — otherwise another
  // manager wrote in the meantime and we 409.
  const updated = await db
    .update(products)
    .set({ stock: data.stock, updatedAt: new Date() })
    .where(
      and(
        eq(products.id, id),
        eq(products.businessId, access.businessId),
        eq(products.stock, data.expectedStock),
      ),
    )
    .returning({ stock: products.stock })

  if (updated.length === 0) {
    return errorResponse(ApiMessageCode.STOCK_CONCURRENCY_CONFLICT, 409)
  }

  await publishToBusiness(
    access.businessId,
    { type: 'product.updated', productId: id, fields: ['stock'] },
    originDeviceId,
  )

  return successResponse({ stock: updated[0].stock })
})
