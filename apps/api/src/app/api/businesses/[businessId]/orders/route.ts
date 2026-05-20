import { db, orders, orderItems, providers, products, businesses, users } from '@/db'
import { eq, desc, inArray, and, ne, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { withBusinessAuth, validationError, errorResponse, successResponse } from '@/lib/api-middleware'
import { canManageBusiness, assertProductsInBusiness, assertProviderInBusiness } from '@/lib/business-auth'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { Schemas } from '@/lib/schemas'
import { publishToBusiness, getOriginDeviceId } from '@/lib/realtime'

const orderItemSchema = z.object({
  productId: Schemas.id(),
  productName: Schemas.name(),
  // Per-line quantity caps match the stock cap: 1M units is enough
  // headroom for any legit order, pathological input is rejected.
  quantity: z.number().int().positive().max(1_000_000),
  // Same billion-unit ceiling as Schemas.amount()/amountFromString().
  // JSON path here so the strict z.number() shape is the right cap
  // — items arrive parsed inside the items[] JSON blob, not as raw
  // FormData strings.
  unitCost: z.number().nonnegative().max(1_000_000_000).optional().nullable(),
})

/**
 * GET /api/businesses/[businessId]/orders
 *
 * List orders for the business with their items.
 *
 * Optional `?status=active|completed` filter. "active" returns everything
 * that is NOT received (pending + any future non-received states); the
 * frontend further classifies these into pending vs overdue from the
 * `estimatedArrival` field. "completed" returns received orders only.
 * Omitting the param returns all orders, preserving the original behavior.
 *
 * Optional `?providerId=` filter scopes to one provider.
 */
export const GET = withBusinessAuth(async (request, access) => {
  const { searchParams } = new URL(request.url)
  const providerIdFilter = searchParams.get('providerId')
  const statusParam = searchParams.get('status')

  const conditions = [eq(orders.businessId, access.businessId)]
  if (providerIdFilter) {
    conditions.push(eq(orders.providerId, providerIdFilter))
  }
  if (statusParam === 'active') {
    conditions.push(ne(orders.status, 'received'))
  } else if (statusParam === 'completed') {
    conditions.push(eq(orders.status, 'received'))
  }
  const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions)

  // Get orders for this business. 500 is the defensive cap — a small
  // business rarely accumulates more pending/recent orders than the UI
  // can meaningfully render at once. The downstream items/products/users
  // hydrations are then bounded by this slice.
  const ordersList = await db
    .select()
    .from(orders)
    .where(whereClause)
    .orderBy(desc(orders.date))
    .limit(500)

  const orderIds = ordersList.map(o => o.id)

  // Early return if no orders
  if (orderIds.length === 0) {
    return successResponse({ orders: [] })
  }

  // Get order items only for these orders (not all items in DB)
  const allItems = await db
    .select({
      id: orderItems.id,
      orderId: orderItems.orderId,
      productId: orderItems.productId,
      productName: orderItems.productName,
      quantity: orderItems.quantity,
      unitCost: orderItems.unitCost,
      subtotal: orderItems.subtotal,
      receivedQuantity: orderItems.receivedQuantity,
    })
    .from(orderItems)
    .where(inArray(orderItems.orderId, orderIds))

  // Get unique product IDs from items
  const productIds = [...new Set(allItems.map(i => i.productId).filter(Boolean))] as string[]

  // Fetch only needed product fields (NO icons - major bandwidth savings).
  // Scoped by businessId so any cross-tenant productId that slipped into
  // order_items (legacy data, future bug) is filtered out at hydration —
  // the foreign product never appears in the response payload.
  const productsList = productIds.length > 0
    ? await db
        .select({
          id: products.id,
          name: products.name,
          price: products.price,
          costPrice: products.costPrice,
          stock: products.stock,
          active: products.active,
        })
        .from(products)
        .where(and(eq(products.businessId, access.businessId), inArray(products.id, productIds)))
    : []

  const productsMap = new Map(productsList.map(p => [p.id, p]))

  // Get providers for this business
  const providersList = await db
    .select()
    .from(providers)
    .where(eq(providers.businessId, access.businessId))

  const providersMap = new Map(providersList.map(p => [p.id, p]))

  // User expansion — fetch the slim user shape for every user id
  // referenced by these orders (creators AND receivers). Done in one
  // query rather than two so duplicates (a user who both placed and
  // received the same order) only cost a single row.
  const userIds = [
    ...new Set(
      ordersList
        .flatMap(o => [o.createdByUserId, o.receivedByUserId])
        .filter(Boolean),
    ),
  ] as string[]
  const usersList = userIds.length > 0
    ? await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(inArray(users.id, userIds))
    : []
  const usersMap = new Map(usersList.map(u => [u.id, u]))

  // Group items by orderId for efficient lookup
  const itemsByOrderId = new Map<string, typeof allItems>()
  for (const item of allItems) {
    const existing = itemsByOrderId.get(item.orderId) || []
    existing.push(item)
    itemsByOrderId.set(item.orderId, existing)
  }

  // Build expanded orders
  const expandedOrders = ordersList.map(order => {
    const items = itemsByOrderId.get(order.id) || []
    return {
      ...order,
      providerId: order.providerId,
      expand: {
        provider: order.providerId ? providersMap.get(order.providerId) || null : null,
        createdByUser: order.createdByUserId ? usersMap.get(order.createdByUserId) || null : null,
        receivedByUser: order.receivedByUserId ? usersMap.get(order.receivedByUserId) || null : null,
        'order_items(order)': items.map(item => ({
          ...item,
          expand: {
            product: item.productId ? productsMap.get(item.productId) || null : null,
          },
        })),
      },
    }
  })

  return successResponse({ orders: expandedOrders })
})

/**
 * POST /api/businesses/[businessId]/orders
 *
 * Create a new order with items.
 */
export const POST = withBusinessAuth(async (request, access) => {
  const originDeviceId = getOriginDeviceId(request)
  // Only partners and owners can create orders.
  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.ORDER_FORBIDDEN_NOT_MANAGER, 403)
  }

  const formData = await request.formData()
  const dateStr = formData.get('date') as string
  const totalStr = formData.get('total') as string
  const status = formData.get('status') as string
  const estimatedArrivalStr = formData.get('estimatedArrival') as string | null
  const providerId = formData.get('providerId') as string | null
  const itemsJson = formData.get('items') as string

  // Parse and validate items
  let items: Array<{ productId: string; productName: string; quantity: number; unitCost?: number | null }>
  try {
    items = JSON.parse(itemsJson)
    const validation = z.array(orderItemSchema).safeParse(items)
    if (!validation.success) {
      return errorResponse(ApiMessageCode.ORDER_INVALID_ITEMS, 400)
    }
  } catch {
    return errorResponse(ApiMessageCode.ORDER_INVALID_ITEMS, 400)
  }

  // Cross-tenant guard: every productId must belong to THIS business.
  // The wrapper pins the URL businessId; only this check stops a partner
  // from referencing a foreign business's product (info leak via the GET
  // hydration of order items + stock manipulation via /receive).
  const productIds = items.map((i) => i.productId)
  if (!(await assertProductsInBusiness(productIds, access.businessId))) {
    return errorResponse(ApiMessageCode.PRODUCT_NOT_FOUND, 404)
  }

  // Cross-tenant guard for providerId.
  if (providerId && !(await assertProviderInBusiness(providerId, access.businessId))) {
    return errorResponse(ApiMessageCode.PROVIDER_NOT_FOUND, 404)
  }

  // FormData input — string-coerce variant.
  const totalValidation = Schemas.positiveAmountFromString().safeParse(totalStr)
  if (!totalValidation.success) {
    return validationError(totalValidation)
  }
  const total = totalValidation.data

  const orderId = nanoid()
  // Validate the user-supplied date BEFORE constructing it. Passing
  // garbage to the JS Date constructor returns an Invalid Date whose
  // .getTime() is NaN; SQLite then stores null/NaN under the
  // 'timestamp' column and the row becomes effectively unsortable.
  // Same for estimatedArrival.
  const orderDate = new Date(dateStr)
  if (!Number.isFinite(orderDate.getTime())) {
    return errorResponse(ApiMessageCode.ORDER_INVALID_DATE, 400)
  }
  const orderStatus = status === 'received' ? 'received' : 'pending'
  let estimatedArrival: Date | null = null
  if (estimatedArrivalStr) {
    const parsed = new Date(estimatedArrivalStr)
    if (!Number.isFinite(parsed.getTime())) {
      return errorResponse(ApiMessageCode.ORDER_INVALID_DATE, 400)
    }
    estimatedArrival = parsed
  }

  // Per-business sequential reference ("#47"). Pulled from a monotonic
  // counter on the businesses row via atomic UPDATE ... RETURNING, so
  // numbers are stable even after deletes and safe under concurrent
  // inserts. The returned value is the number to use for THIS order;
  // the stored next_order_number has already been incremented.
  const reservation = await db
    .update(businesses)
    .set({ nextOrderNumber: sql`${businesses.nextOrderNumber} + 1` })
    .where(eq(businesses.id, access.businessId))
    .returning({ reserved: sql<number>`${businesses.nextOrderNumber} - 1` })
  const orderNumber = Number(reservation[0]?.reserved ?? 1)

  // Batch insert order + items in a single transaction
  const itemValues = items.map(item => ({
    id: nanoid(),
    orderId,
    productId: item.productId,
    productName: item.productName,
    quantity: item.quantity,
    unitCost: item.unitCost ?? null,
    subtotal: item.unitCost != null ? Number((item.unitCost * item.quantity).toFixed(2)) : null,
  }))

  await db.batch([
    db.insert(orders).values({
      id: orderId,
      businessId: access.businessId,
      providerId: providerId || null,
      createdByUserId: access.userId,
      orderNumber,
      date: orderDate,
      total,
      status: orderStatus,
      estimatedArrival,
    }),
    ...(itemValues.length > 0
      ? [db.insert(orderItems).values(itemValues)]
      : []),
  ])

  // Look up provider if needed. Scoped by businessId — defense in depth
  // against ever returning a foreign provider in the response (the
  // pre-insert assert above already rejects cross-tenant providerIds).
  let provider = null
  if (providerId) {
    provider = await db
      .select()
      .from(providers)
      .where(and(eq(providers.id, providerId), eq(providers.businessId, access.businessId)))
      .get() || null
  }

  // Slim creator shape so the list can render "Ordered by:" without a
  // refetch. Safe to expose name/email — the caller already has access
  // to this business.
  const createdByUser = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, access.userId))
    .get() || null

  // Fire-and-forget hint to other devices in this business.
  await publishToBusiness(
    access.businessId,
    { type: 'order.created', orderId },
    originDeviceId,
  )

  // Return full expanded order so client can append without refetching
  return successResponse({
    order: {
      id: orderId,
      businessId: access.businessId,
      providerId: providerId || null,
      createdByUserId: access.userId,
      orderNumber,
      date: orderDate,
      total,
      status: orderStatus,
      estimatedArrival,
      expand: {
        provider,
        createdByUser,
        'order_items(order)': itemValues.map(item => ({
          ...item,
          receivedQuantity: null,
          expand: { product: null },
        })),
      },
    },
  })
})
