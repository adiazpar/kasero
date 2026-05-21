import { db, expenseCategories } from '@/db'
import { eq, asc } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import {
  withBusinessAuth,
  errorResponse,
  successResponse,
  validationError,
} from '@/lib/api-middleware'
import { canManageBusiness } from '@/lib/business-auth'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { publishToBusiness, getOriginDeviceId } from '@/lib/realtime'
import { postExpenseCategorySchema } from './schema'

export const GET = withBusinessAuth(async (_request, access) => {
  const rows = await db
    .select()
    .from(expenseCategories)
    .where(eq(expenseCategories.businessId, access.businessId))
    .orderBy(asc(expenseCategories.sortOrder), asc(expenseCategories.name))

  return successResponse({ data: rows })
})

export const POST = withBusinessAuth(async (request, access) => {
  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.EXPENSE_FORBIDDEN_NOT_MANAGER, 403)
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return errorResponse(ApiMessageCode.VALIDATION_GENERIC, 400)
  }

  const parsed = postExpenseCategorySchema.safeParse(raw)
  if (!parsed.success) return validationError(parsed)

  const id = nanoid()
  await db.insert(expenseCategories).values({
    id,
    businessId: access.businessId,
    name: parsed.data.name.trim(),
    sortOrder: parsed.data.sortOrder ?? 0,
  })

  void publishToBusiness(
    access.businessId,
    {
      type: 'expense_category.created',
      categoryId: id,
    },
    getOriginDeviceId(request),
  )

  const [created] = await db
    .select()
    .from(expenseCategories)
    .where(eq(expenseCategories.id, id))

  return successResponse({ data: created }, ApiMessageCode.EXPENSE_CATEGORY_CREATED)
})
