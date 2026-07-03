import { db, expenses, businesses } from '@/db'
import { and, eq, desc, lte, gte, sql } from 'drizzle-orm'
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
import { postExpenseSchema } from './schema'

const POST_MAX_BODY_BYTES = 8 * 1024
const ONE_MINUTE_MS = 60 * 1000
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000

export const POST = withBusinessAuth(async (request, access) => {
  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.EXPENSE_FORBIDDEN_NOT_MANAGER, 403)
  }

  const oversize = enforceMaxContentLength(request, POST_MAX_BODY_BYTES)
  if (oversize) return oversize

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return errorResponse(ApiMessageCode.VALIDATION_GENERIC, 400)
  }

  const parsed = postExpenseSchema.safeParse(raw)
  if (!parsed.success) return validationError(parsed)
  const body = parsed.data

  const now = new Date()
  const date = body.date ? new Date(body.date) : now
  if (!Number.isFinite(date.getTime())) {
    return errorResponse(ApiMessageCode.EXPENSE_INVALID_DATE, 400)
  }
  if (
    date.getTime() > now.getTime() + ONE_MINUTE_MS ||
    date.getTime() < now.getTime() - ONE_YEAR_MS
  ) {
    return errorResponse(ApiMessageCode.EXPENSE_INVALID_DATE, 400)
  }

  const id = nanoid()

  // Atomically increment nextExpenseNumber and reserve the previous value.
  const reservation = await db
    .update(businesses)
    .set({ nextExpenseNumber: sql`${businesses.nextExpenseNumber} + 1` })
    .where(eq(businesses.id, access.businessId))
    .returning({ reserved: sql<number>`${businesses.nextExpenseNumber} - 1` })
  const expenseNumber = Number(reservation[0]?.reserved ?? 1)

  // .returning() hands back the created row in the same round trip — no
  // follow-up SELECT needed.
  const [createdRow] = await db
    .insert(expenses)
    .values({
      id,
      businessId: access.businessId,
      createdByUserId: access.userId,
      expenseNumber,
      date,
      amount: body.amount,
      categoryId: body.categoryId ?? null,
      note: body.note ?? null,
      photoUrl: body.photoUrl ?? null,
    })
    .returning()

  void publishToBusiness(
    access.businessId,
    {
      type: 'expense.created',
      expenseId: id,
    },
    getOriginDeviceId(request),
  )

  return successResponse({ data: createdRow }, ApiMessageCode.EXPENSE_CREATED)
})

export const GET = withBusinessAuth(async (request, access) => {
  const url = new URL(request.url)
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '50'), 1), 200)
  const cursor = url.searchParams.get('cursor')
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')

  const filters = [eq(expenses.businessId, access.businessId)]
  if (from) filters.push(gte(expenses.date, new Date(from)))
  if (to) filters.push(lte(expenses.date, new Date(to)))
  if (cursor) filters.push(lte(expenses.date, new Date(cursor)))

  const rows = await db
    .select()
    .from(expenses)
    .where(and(...filters))
    .orderBy(desc(expenses.date), desc(expenses.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const data = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore ? data[data.length - 1].date.toISOString() : null

  return successResponse({ data, nextCursor })
})
