import { db, productCategories } from '@/db'
import { eq, and, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { canManageBusiness } from '@/lib/business-auth'
import { withBusinessAuth, validationError, errorResponse, successResponse } from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { publishToBusiness, getOriginDeviceId } from '@/lib/realtime'

const reorderSchema = z.object({
  categoryIds: z.array(z.string()).min(1),
})

/**
 * POST /api/businesses/[businessId]/categories/reorder
 *
 * Update the sort order of categories.
 * The order in the array determines the new sort order.
 */
export const POST = withBusinessAuth(async (request, access) => {
  const originDeviceId = getOriginDeviceId(request)

  // Only partners and owners can reorder categories
  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.FORBIDDEN, 403)
  }

  const body = await request.json()
  const validation = reorderSchema.safeParse(body)

  if (!validation.success) {
    return validationError(validation)
  }

  const { categoryIds } = validation.data

  // Reject duplicates outright — the CASE expression would otherwise map
  // the same id to two different sortOrder values (first WHEN wins in
  // SQLite, making the outcome silently order-dependent on input order).
  const uniqueIds = new Set(categoryIds)
  if (uniqueIds.size !== categoryIds.length) {
    return errorResponse(ApiMessageCode.CATEGORIES_NOT_FOUND_IN_BUSINESS, 400)
  }

  // Pre-flight existence check. If we skipped this and ran the UPDATE
  // first, a bad input (missing id, cross-business id) would partially
  // reorder the rows that DID match before we returned 400.
  const existing = await db
    .select({ id: productCategories.id })
    .from(productCategories)
    .where(and(
      inArray(productCategories.id, categoryIds),
      eq(productCategories.businessId, access.businessId),
    ))

  if (existing.length !== categoryIds.length) {
    return errorResponse(ApiMessageCode.CATEGORIES_NOT_FOUND_IN_BUSINESS, 400)
  }

  // All ids verified — apply every reorder in a single UPDATE ... CASE.
  // One atomic round trip regardless of list length, replacing the old
  // Promise.all of N individual UPDATEs.
  const cases = sql.join(
    categoryIds.map((id, idx) => sql`WHEN ${id} THEN ${idx + 1}`),
    sql` `,
  )

  await db
    .update(productCategories)
    .set({ sortOrder: sql`CASE ${productCategories.id} ${cases} END` })
    .where(and(
      inArray(productCategories.id, categoryIds),
      eq(productCategories.businessId, access.businessId),
    ))

  await publishToBusiness(access.businessId, {
    type: 'category.reordered',
  }, originDeviceId)

  return successResponse({})
})
