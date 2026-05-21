import { db, expenses } from '@/db'
import { and, eq } from 'drizzle-orm'
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
import { patchExpenseSchema } from '../schema'

const MAX_BODY = 8 * 1024
const ONE_MINUTE_MS = 60 * 1000
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000

export const GET = withBusinessAuth(async (_request, access, params) => {
  const { id } = params

  const [row] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, id), eq(expenses.businessId, access.businessId)))

  if (!row) return errorResponse(ApiMessageCode.EXPENSE_NOT_FOUND, 404)

  return successResponse({ data: row })
})

export const PATCH = withBusinessAuth(async (request, access, params) => {
  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.EXPENSE_FORBIDDEN_NOT_MANAGER, 403)
  }

  const oversize = enforceMaxContentLength(request, MAX_BODY)
  if (oversize) return oversize

  const { id } = params

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return errorResponse(ApiMessageCode.VALIDATION_GENERIC, 400)
  }

  const parsed = patchExpenseSchema.safeParse(raw)
  if (!parsed.success) return validationError(parsed)
  const body = parsed.data

  const [existing] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, id), eq(expenses.businessId, access.businessId)))

  if (!existing) return errorResponse(ApiMessageCode.EXPENSE_NOT_FOUND, 404)

  const patch: Record<string, unknown> = { updatedAt: new Date() }

  if (body.date !== undefined) {
    const date = new Date(body.date)
    const now = new Date()
    if (!Number.isFinite(date.getTime())) {
      return errorResponse(ApiMessageCode.EXPENSE_INVALID_DATE, 400)
    }
    if (
      date.getTime() > now.getTime() + ONE_MINUTE_MS ||
      date.getTime() < now.getTime() - ONE_YEAR_MS
    ) {
      return errorResponse(ApiMessageCode.EXPENSE_INVALID_DATE, 400)
    }
    patch.date = date
  }

  if (body.amount !== undefined) patch.amount = body.amount
  if (body.note !== undefined) patch.note = body.note
  if (body.categoryId !== undefined) patch.categoryId = body.categoryId
  if (body.photoUrl !== undefined) patch.photoUrl = body.photoUrl

  await db.update(expenses).set(patch).where(eq(expenses.id, id))

  void publishToBusiness(
    access.businessId,
    {
      type: 'expense.updated',
      expenseId: id,
    },
    getOriginDeviceId(request),
  )

  const [updated] = await db
    .select()
    .from(expenses)
    .where(eq(expenses.id, id))

  return successResponse({ data: updated ?? existing }, ApiMessageCode.EXPENSE_UPDATED)
})

export const DELETE = withBusinessAuth(async (request, access, params) => {
  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.EXPENSE_FORBIDDEN_NOT_MANAGER, 403)
  }

  const { id } = params

  const [existing] = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(and(eq(expenses.id, id), eq(expenses.businessId, access.businessId)))

  if (!existing) return errorResponse(ApiMessageCode.EXPENSE_NOT_FOUND, 404)

  await db.delete(expenses).where(eq(expenses.id, id))

  void publishToBusiness(
    access.businessId,
    {
      type: 'expense.deleted',
      expenseId: id,
    },
    getOriginDeviceId(request),
  )

  return successResponse({}, ApiMessageCode.EXPENSE_DELETED)
})
