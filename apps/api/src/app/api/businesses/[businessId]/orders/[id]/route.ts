import { db, orders, orderItems } from '@/db'
import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { withBusinessAuth, validationError, errorResponse, successResponse } from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { canManageBusiness, assertProductsInBusiness, assertProviderInBusiness } from '@/lib/business-auth'
import { Schemas } from '@/lib/schemas'
import { publishToBusiness, getOriginDeviceId } from '@/lib/realtime'

const orderItemSchema = z.object({
  productId: Schemas.id(),
  productName: Schemas.name(),
  // Mirrors the cap on order create. 1M units of a single line is far
  // beyond any legit purchase order from a small business.
  quantity: z.number().int().positive().max(1_000_000),
  unitCost: z.number().nonnegative().max(1_000_000_000).optional().nullable(),
})

/**
 * PATCH /api/businesses/[businessId]/orders/[id]
 *
 * Update an order and its items.
 */
export const PATCH = withBusinessAuth(async (request, access, routeParams) => {
  const originDeviceId = getOriginDeviceId(request)
  // Only partners and owners can modify orders
  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.ORDER_FORBIDDEN_NOT_MANAGER, 403)
  }

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

  if (existingOrder.status === 'received') {
    return errorResponse(ApiMessageCode.ORDER_CANNOT_EDIT_RECEIVED, 400)
  }

  const formData = await request.formData()
  const totalStr = formData.get('total') as string | null
  const estimatedArrivalStr = formData.get('estimatedArrival') as string | null
  const providerId = formData.get('providerId') as string | null
  const itemsJson = formData.get('items') as string | null

  const updateData: Record<string, unknown> = {}

  // Validate the optional client-supplied total. We may overwrite
  // it below if `items` is also being updated and the client total
  // disagrees with the recomputed total — the audit (L-12) flagged
  // that the previous code accepted divergent values silently.
  let clientTotal: number | null = null
  if (totalStr !== null) {
    // FormData input — string-coerce variant.
    const totalValidation = Schemas.positiveAmountFromString().safeParse(totalStr)
    if (!totalValidation.success) {
      return validationError(totalValidation)
    }
    clientTotal = totalValidation.data
    updateData.total = clientTotal
  }

  if (estimatedArrivalStr !== null) {
    if (estimatedArrivalStr) {
      const parsed = new Date(estimatedArrivalStr)
      if (!Number.isFinite(parsed.getTime())) {
        return errorResponse(ApiMessageCode.ORDER_INVALID_DATE, 400)
      }
      updateData.estimatedArrival = parsed
    } else {
      updateData.estimatedArrival = null
    }
  }

  if (providerId !== null) {
    // Cross-tenant guard: an empty string clears the provider; a non-empty
    // value must reference a provider in THIS business. Without this a
    // partner can plant a foreign providerId that surfaces in the GET
    // hydration (PII leak: name/phone/email of another tenant's supplier).
    if (providerId && !(await assertProviderInBusiness(providerId, access.businessId))) {
      return errorResponse(ApiMessageCode.PROVIDER_NOT_FOUND, 404)
    }
    updateData.providerId = providerId || null
  }

  // Parse + validate the optional items array BEFORE opening the batch
  // so validation errors can still short-circuit with a 400.
  let itemRowsToInsert: Array<{
    id: string
    orderId: string
    productId: string
    productName: string
    quantity: number
    unitCost: number | null
    subtotal: number | null
  }> | null = null
  if (itemsJson) {
    let parsed: Array<{ productId: string; productName: string; quantity: number; unitCost?: number | null }>
    try {
      parsed = JSON.parse(itemsJson)
      const validation = z.array(orderItemSchema).safeParse(parsed)
      if (!validation.success) {
        return errorResponse(ApiMessageCode.ORDER_INVALID_ITEMS, 400)
      }
    } catch {
      return errorResponse(ApiMessageCode.ORDER_INVALID_ITEMS, 400)
    }
    // Cross-tenant guard: every productId in the new items list must
    // belong to THIS business. Same justification as the POST route.
    if (parsed.length > 0) {
      const productIds = parsed.map((i) => i.productId)
      if (!(await assertProductsInBusiness(productIds, access.businessId))) {
        return errorResponse(ApiMessageCode.PRODUCT_NOT_FOUND, 404)
      }
    }
    itemRowsToInsert = parsed.map(item => ({
      id: nanoid(),
      orderId: id,
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      unitCost: item.unitCost ?? null,
      subtotal: item.unitCost != null ? Number((item.unitCost * item.quantity).toFixed(2)) : null,
    }))

    // Audit L-12: when items are updated, keep `total` in sync with
    // the line subtotals. Three branches:
    //   - client sent neither: skip (the column stays unchanged)
    //   - client sent only items: recompute total from the new items
    //   - client sent both: trust the client total but only if it
    //     matches the recomputed total to within rounding (1 cent
    //     tolerance for the floating-point sum). Mismatch returns
    //     400 instead of letting drift accumulate silently.
    const allLinesPriced = itemRowsToInsert.every((r) => r.subtotal !== null)
    if (allLinesPriced) {
      const recomputed = Number(
        itemRowsToInsert.reduce((acc, r) => acc + (r.subtotal ?? 0), 0).toFixed(2),
      )
      if (clientTotal !== null) {
        if (Math.abs(clientTotal - recomputed) > 0.01) {
          return errorResponse(ApiMessageCode.ORDER_INVALID_ITEMS, 400)
        }
      } else {
        updateData.total = recomputed
      }
    }
  }

  // Run the order UPDATE and any items rewrite atomically, so a failure
  // after the order changes can't leave the row pointing at stale items.
  // Literal array + spread lets TS infer the mixed-statement tuple type.
  await db.batch([
    db.update(orders).set(updateData).where(eq(orders.id, id)),
    ...(itemRowsToInsert !== null
      ? [db.delete(orderItems).where(eq(orderItems.orderId, id))]
      : []),
    ...(itemRowsToInsert !== null && itemRowsToInsert.length > 0
      ? [db.insert(orderItems).values(itemRowsToInsert)]
      : []),
  ])

  // Build the fields list mirroring exactly which columns the batch
  // touched. `total` flips whenever updateData.total was set (either by
  // the client or by the items-recompute branch); `items` flips when the
  // items array was rewritten.
  const changedFields: Array<'total' | 'estimatedArrival' | 'providerId' | 'items'> = []
  if ('total' in updateData) changedFields.push('total')
  if ('estimatedArrival' in updateData) changedFields.push('estimatedArrival')
  if ('providerId' in updateData) changedFields.push('providerId')
  if (itemRowsToInsert !== null) changedFields.push('items')

  // Skip publish if nothing actually changed — a PATCH with an empty
  // body is a no-op and shouldn't burn a refetch on other devices.
  if (changedFields.length > 0) {
    await publishToBusiness(
      access.businessId,
      { type: 'order.updated', orderId: id, fields: changedFields },
      originDeviceId,
    )
  }

  return successResponse({})
})

/**
 * DELETE /api/businesses/[businessId]/orders/[id]
 *
 * Delete an order and its items.
 */
export const DELETE = withBusinessAuth(async (request, access, routeParams) => {
  const originDeviceId = getOriginDeviceId(request)
  // Only partners and owners can delete orders
  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.ORDER_FORBIDDEN_NOT_MANAGER, 403)
  }

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

  // Delete order (cascade will delete items)
  await db.delete(orders).where(eq(orders.id, id))

  await publishToBusiness(
    access.businessId,
    { type: 'order.deleted', orderId: id },
    originDeviceId,
  )

  return successResponse({})
})
