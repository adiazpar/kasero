import { db, productCategories, products, businesses } from '@/db'
import { eq, and, sql } from 'drizzle-orm'
import { z } from 'zod'
import { canManageBusiness } from '@/lib/business-auth'
import { withBusinessAuth, validationError, errorResponse, successResponse } from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { Schemas } from '@/lib/schemas'
import { publishToBusiness, getOriginDeviceId } from '@/lib/realtime'

const updateCategorySchema = z.object({
  name: Schemas.name().max(50),
})

/**
 * PATCH /api/businesses/[businessId]/categories/[id]
 *
 * Update a product category.
 */
export const PATCH = withBusinessAuth(async (request, access, routeParams) => {
  const originDeviceId = getOriginDeviceId(request)
  const id = routeParams?.id
  if (!id) {
    return errorResponse(ApiMessageCode.CATEGORY_ID_REQUIRED, 400)
  }

  // Only partners and owners can update categories
  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.FORBIDDEN, 403)
  }

  // Verify the category belongs to this business
  const [existingCategory] = await db
    .select()
    .from(productCategories)
    .where(and(
      eq(productCategories.id, id),
      eq(productCategories.businessId, access.businessId)
    ))
    .limit(1)

  if (!existingCategory) {
    return errorResponse(ApiMessageCode.CATEGORY_NOT_FOUND, 404)
  }

  const body = await request.json()
  const validation = updateCategorySchema.safeParse(body)

  if (!validation.success) {
    return validationError(validation)
  }

  const { name } = validation.data

  // Returning hands us the updated row in the same round trip as the
  // UPDATE. No follow-up SELECT needed.
  const [updatedCategory] = await db
    .update(productCategories)
    .set({
      name: name.trim(),
    })
    .where(eq(productCategories.id, id))
    .returning()

  await publishToBusiness(access.businessId, {
    type: 'category.updated',
    categoryId: id,
    fields: ['name'],
  }, originDeviceId)

  return successResponse({ category: updatedCategory })
})

/**
 * DELETE /api/businesses/[businessId]/categories/[id]
 *
 * Delete a product category.
 * Products with this category will have their categoryId set to null.
 */
export const DELETE = withBusinessAuth(async (request, access, routeParams) => {
  const originDeviceId = getOriginDeviceId(request)
  const id = routeParams?.id
  if (!id) {
    return errorResponse(ApiMessageCode.CATEGORY_ID_REQUIRED, 400)
  }

  // Only partners and owners can delete categories
  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.FORBIDDEN, 403)
  }

  // Verify the category belongs to this business
  const [existingCategory] = await db
    .select()
    .from(productCategories)
    .where(and(
      eq(productCategories.id, id),
      eq(productCategories.businessId, access.businessId)
    ))
    .limit(1)

  if (!existingCategory) {
    return errorResponse(ApiMessageCode.CATEGORY_NOT_FOUND, 404)
  }

  // Narrow count aggregate instead of pulling every product row (which
  // includes the base64 icon column — MBs of bandwidth per call on
  // larger catalogs). Scoped by businessId — defense in depth against
  // any cross-tenant categoryId planting (a partner setting their
  // product's categoryId to a foreign id) ever flowing into this count.
  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(products)
    .where(and(eq(products.categoryId, id), eq(products.businessId, access.businessId)))
  const affectedProducts = Number(countRow?.count ?? 0)

  // Atomic batch: null out the categoryId on products (scoped by THIS
  // business — if a partner planted a foreign categoryId on their own
  // product it'd be untouched here, but we never want this DELETE to
  // walk products in another business), null out the defaultCategoryId
  // on this business if it points at this id, then delete the category.
  // Non-atomic sequential writes could previously leave the business
  // pointing at a soon-to-be-deleted category.
  await db.batch([
    db.update(products)
      .set({ categoryId: null })
      .where(and(eq(products.categoryId, id), eq(products.businessId, access.businessId))),
    db.update(businesses)
      .set({ defaultCategoryId: null })
      .where(and(eq(businesses.defaultCategoryId, id), eq(businesses.id, access.businessId))),
    db.delete(productCategories).where(eq(productCategories.id, id)),
  ])

  await publishToBusiness(access.businessId, {
    type: 'category.deleted',
    categoryId: id,
  }, originDeviceId)

  return successResponse({ affectedProducts })
})
