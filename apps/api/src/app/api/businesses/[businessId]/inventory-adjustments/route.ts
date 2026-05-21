import { db, inventoryAdjustments, expenses, businesses, products } from '@/db'
import { and, desc, eq, lt, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import {
  withBusinessAuth,
  enforceMaxContentLength,
  errorResponse,
  successResponse,
  validationError,
} from '@/lib/api-middleware'
import { canManageBusiness } from '@/lib/business-auth'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { publishToBusiness, getOriginDeviceId } from '@/lib/realtime'
import { postInventoryAdjustmentSchema } from './schema'

const POST_MAX_BODY_BYTES = 8 * 1024

export const POST = withBusinessAuth(async (request, access) => {
  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.INVENTORY_ADJUSTMENT_FORBIDDEN_NOT_MANAGER, 403)
  }

  const oversize = enforceMaxContentLength(request, POST_MAX_BODY_BYTES)
  if (oversize) return oversize

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return errorResponse(ApiMessageCode.VALIDATION_GENERIC, 400)
  }

  const parsed = postInventoryAdjustmentSchema.safeParse(raw)
  if (!parsed.success) return validationError(parsed)
  const body = parsed.data

  // Verify product belongs to this business before opening a transaction.
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, body.productId), eq(products.businessId, access.businessId)))
    .limit(1)

  if (!product) {
    return errorResponse(ApiMessageCode.PRODUCT_NOT_FOUND_FOR_ADJUSTMENT, 400)
  }

  const adjustmentId = nanoid()
  const originDeviceId = getOriginDeviceId(request)

  let expenseRow: typeof expenses.$inferSelect | null = null

  const result = await db.transaction(async (tx) => {
    let expenseId: string | null = null

    if (body.expense) {
      const newExpenseId = nanoid()

      // Atomically increment nextExpenseNumber and reserve the previous value.
      const reservation = await tx
        .update(businesses)
        .set({ nextExpenseNumber: sql`${businesses.nextExpenseNumber} + 1` })
        .where(eq(businesses.id, access.businessId))
        .returning({ reserved: sql<number>`${businesses.nextExpenseNumber} - 1` })
      const expenseNumber = Number(reservation[0]?.reserved ?? 1)

      await tx.insert(expenses).values({
        id: newExpenseId,
        businessId: access.businessId,
        createdByUserId: access.userId,
        expenseNumber,
        date: new Date(),
        amount: body.expense.amount,
        categoryId: body.expense.categoryId ?? null,
        note: body.reason ?? null,
      })

      expenseId = newExpenseId
    }

    await tx.insert(inventoryAdjustments).values({
      id: adjustmentId,
      businessId: access.businessId,
      productId: body.productId,
      createdByUserId: access.userId,
      delta: body.delta,
      reason: body.reason ?? null,
      relatedExpenseId: expenseId,
    })

    await tx
      .update(products)
      .set({
        stock: sql`${products.stock} + ${body.delta}`,
        updatedAt: new Date(),
      })
      .where(eq(products.id, body.productId))

    return { expenseId }
  })

  // Fetch the inserted rows for the response.
  const [adjustment] = await db
    .select()
    .from(inventoryAdjustments)
    .where(eq(inventoryAdjustments.id, adjustmentId))
    .limit(1)

  if (result.expenseId) {
    const [row] = await db
      .select()
      .from(expenses)
      .where(eq(expenses.id, result.expenseId))
      .limit(1)
    expenseRow = row ?? null
  }

  void publishToBusiness(
    access.businessId,
    {
      type: 'inventory.adjusted',
      adjustmentId,
      productId: body.productId,
      relatedExpenseId: result.expenseId ?? null,
    },
    originDeviceId,
  )

  if (result.expenseId) {
    void publishToBusiness(
      access.businessId,
      {
        type: 'expense.created',
        expenseId: result.expenseId,
      },
      originDeviceId,
    )
  }

  return successResponse(
    { data: { adjustment, expense: expenseRow } },
    ApiMessageCode.INVENTORY_ADJUSTMENT_CREATED,
  )
})

export const GET = withBusinessAuth(async (request, access) => {
  const url = new URL(request.url)
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '50'), 1), 200)
  const cursor = url.searchParams.get('cursor')
  const productId = url.searchParams.get('productId')

  const filters = [eq(inventoryAdjustments.businessId, access.businessId)]
  if (productId) filters.push(eq(inventoryAdjustments.productId, productId))
  if (cursor) filters.push(lt(inventoryAdjustments.createdAt, new Date(Number(cursor))))

  const rows = await db
    .select()
    .from(inventoryAdjustments)
    .where(and(...filters))
    .orderBy(desc(inventoryAdjustments.createdAt), desc(inventoryAdjustments.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const data = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore
    ? String((data[data.length - 1].createdAt as Date).getTime())
    : null

  return successResponse({ data, nextCursor })
})
