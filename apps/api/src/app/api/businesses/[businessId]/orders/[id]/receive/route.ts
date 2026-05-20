import { db, orders, orderItems, products } from '@/db'
import { eq, and, sql } from 'drizzle-orm'
import { z } from 'zod'
import { withBusinessAuth, validationError, errorResponse, successResponse } from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { publishToBusiness, getOriginDeviceId } from '@/lib/realtime'

const receiveOrderSchema = z.object({
  // Per-line received quantities. Capped at 1M to match the create-
  // and edit-order schemas and block pathological MAX_SAFE_INTEGER
  // writes to products.stock.
  receivedQuantities: z.record(z.string(), z.number().int().min(0).max(1_000_000)),
})

/**
 * POST /api/businesses/[businessId]/orders/[id]/receive
 *
 * Receive an order and update product stock. Available to any active
 * business member (employees included) — receiving incoming inventory is
 * a normal floor-staff task. Other order mutations (create, edit, delete)
 * remain manager-only.
 */
export const POST = withBusinessAuth(async (request, access, routeParams) => {
  const originDeviceId = getOriginDeviceId(request)
  const id = routeParams?.id
  if (!id) {
    return errorResponse(ApiMessageCode.ORDER_ID_REQUIRED, 400)
  }

  // Verify order exists and belongs to business
  const [existingOrder] = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.id, id),
        eq(orders.businessId, access.businessId)
      )
    )
    .limit(1)

  if (!existingOrder) {
    return errorResponse(ApiMessageCode.ORDER_NOT_FOUND, 404)
  }

  // Note: the existing-row status check that was here previously is
  // intentionally removed. The atomic claim below is the source of
  // truth for "is this still pending"; a separate read+check leaves a
  // TOCTOU window where two concurrent POSTs both see status='pending'
  // and both run the stock-bump batch, doubling stock for every line
  // item. The early existence check stays only to distinguish 404 from
  // 409 in the response.

  const body = await request.json()
  const validation = receiveOrderSchema.safeParse(body)

  if (!validation.success) {
    return validationError(validation)
  }

  const { receivedQuantities } = validation.data

  // Get order items
  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, id))

  const now = new Date()

  // The full receive flow runs in a transaction so the conditional
  // status claim and the stock bumps either all commit together or all
  // roll back. The claim must succeed BEFORE any stock mutation; if a
  // concurrent POST already flipped status='received', the claim
  // returns zero rows and we throw to roll back without touching stock.
  try {
    await db.transaction(async (tx) => {
      // Atomic claim: only one POST can flip pending->received. The
      // WHERE includes status='pending' so concurrent calls collide on
      // the row update; whichever statement runs first wins, the
      // others get an empty `returning` and we abort. Same shape as
      // sales/route.ts session-claim pattern.
      const claimed = await tx
        .update(orders)
        .set({
          status: 'received',
          receivedDate: now,
          receivedByUserId: access.userId,
        })
        .where(
          and(
            eq(orders.id, id),
            eq(orders.businessId, access.businessId),
            eq(orders.status, 'pending'),
          ),
        )
        .returning({ id: orders.id })
        .all()

      if (claimed.length === 0) {
        throw new OrderAlreadyReceivedError()
      }

      for (const item of items) {
        const receivedQty = receivedQuantities[item.id] ?? item.quantity

        await tx
          .update(orderItems)
          .set({ receivedQuantity: receivedQty })
          .where(eq(orderItems.id, item.id))

        if (receivedQty > 0 && item.productId) {
          // Defense-in-depth: scope the stock bump by businessId. If a
          // legacy or future-bug order line references a foreign
          // product, the increment hits zero rows instead of mutating
          // another tenant's stock.
          await tx
            .update(products)
            .set({
              stock: sql`${products.stock} + ${receivedQty}`,
            })
            .where(
              and(
                eq(products.id, item.productId),
                eq(products.businessId, access.businessId),
              ),
            )
        }
      }
    })
  } catch (err) {
    if (err instanceof OrderAlreadyReceivedError) {
      return errorResponse(ApiMessageCode.ORDER_ALREADY_RECEIVED, 409)
    }
    throw err
  }

  // Fire-and-forget hint. The receiving client's handler refetches both
  // `orders` (status flip to 'received') and `products` (the stock
  // increment cascade) — same pattern as `sale.created`.
  await publishToBusiness(
    access.businessId,
    { type: 'order.received', orderId: id },
    originDeviceId,
  )

  return successResponse({})
})

class OrderAlreadyReceivedError extends Error {
  constructor() {
    super('Order already received')
  }
}
