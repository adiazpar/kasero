import { db, expenseCategories, expenses } from '@/db'
import { and, eq } from 'drizzle-orm'
import {
  withBusinessAuth,
  errorResponse,
  successResponse,
  validationError,
} from '@/lib/api-middleware'
import { canManageBusiness } from '@/lib/business-auth'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { publishToBusiness, getOriginDeviceId } from '@/lib/realtime'
import { patchExpenseCategorySchema } from '../schema'

export const PATCH = withBusinessAuth(async (request, access, params) => {
  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.EXPENSE_FORBIDDEN_NOT_MANAGER, 403)
  }

  const { id } = params

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return errorResponse(ApiMessageCode.VALIDATION_GENERIC, 400)
  }

  const parsed = patchExpenseCategorySchema.safeParse(raw)
  if (!parsed.success) return validationError(parsed)

  const [existing] = await db
    .select()
    .from(expenseCategories)
    .where(and(eq(expenseCategories.id, id), eq(expenseCategories.businessId, access.businessId)))

  if (!existing) return errorResponse(ApiMessageCode.EXPENSE_CATEGORY_NOT_FOUND, 404)

  const patch: Partial<{ name: string; sortOrder: number }> = {}
  if (parsed.data.name !== undefined) patch.name = parsed.data.name.trim()
  if (parsed.data.sortOrder !== undefined) patch.sortOrder = parsed.data.sortOrder

  if (Object.keys(patch).length > 0) {
    await db.update(expenseCategories).set(patch).where(eq(expenseCategories.id, id))
  }

  void publishToBusiness(
    access.businessId,
    {
      type: 'expense_category.updated',
      categoryId: id,
    },
    getOriginDeviceId(request),
  )

  const [updated] = await db
    .select()
    .from(expenseCategories)
    .where(eq(expenseCategories.id, id))

  return successResponse({ data: updated ?? existing }, ApiMessageCode.EXPENSE_CATEGORY_UPDATED)
})

export const DELETE = withBusinessAuth(async (request, access, params) => {
  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.EXPENSE_FORBIDDEN_NOT_MANAGER, 403)
  }

  const { id } = params

  const [existing] = await db
    .select({ id: expenseCategories.id })
    .from(expenseCategories)
    .where(and(eq(expenseCategories.id, id), eq(expenseCategories.businessId, access.businessId)))

  if (!existing) return errorResponse(ApiMessageCode.EXPENSE_CATEGORY_NOT_FOUND, 404)

  const [inUse] = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(and(eq(expenses.categoryId, id), eq(expenses.businessId, access.businessId)))

  if (inUse) return errorResponse(ApiMessageCode.EXPENSE_CATEGORY_IN_USE, 409)

  await db.delete(expenseCategories).where(eq(expenseCategories.id, id))

  void publishToBusiness(
    access.businessId,
    {
      type: 'expense_category.deleted',
      categoryId: id,
    },
    getOriginDeviceId(request),
  )

  return successResponse({}, ApiMessageCode.EXPENSE_CATEGORY_DELETED)
})
