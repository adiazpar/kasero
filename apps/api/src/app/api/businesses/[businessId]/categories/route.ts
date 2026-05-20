import { db, productCategories } from '@/db'
import { eq, asc } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { canManageBusiness } from '@/lib/business-auth'
import { withBusinessAuth, validationError, errorResponse, successResponse } from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { Schemas } from '@/lib/schemas'
import { publishToBusiness, getOriginDeviceId } from '@/lib/realtime'

const createCategorySchema = z.object({
  name: Schemas.name().max(50),
})

/**
 * GET /api/businesses/[businessId]/categories
 *
 * List all product categories for the business.
 */
export const GET = withBusinessAuth(async (_request, access) => {
  // Defensive cap. Real businesses use ~5-20 categories; 200 is 10× that.
  const categories = await db
    .select()
    .from(productCategories)
    .where(eq(productCategories.businessId, access.businessId))
    .orderBy(asc(productCategories.sortOrder), asc(productCategories.name))
    .limit(200)

  return successResponse({ categories })
})

/**
 * POST /api/businesses/[businessId]/categories
 *
 * Create a new product category.
 */
export const POST = withBusinessAuth(async (request, access) => {
  const originDeviceId = getOriginDeviceId(request)

  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.FORBIDDEN, 403)
  }

  const body = await request.json()
  const validation = createCategorySchema.safeParse(body)

  if (!validation.success) {
    return validationError(validation)
  }

  const { name } = validation.data

  // Get the highest sort order to place new category at the end
  const existingCategories = await db
    .select({ sortOrder: productCategories.sortOrder })
    .from(productCategories)
    .where(eq(productCategories.businessId, access.businessId))
    .orderBy(asc(productCategories.sortOrder))

  const maxSortOrder = existingCategories.length > 0
    ? Math.max(...existingCategories.map(c => c.sortOrder))
    : 0

  const categoryId = nanoid()

  const [newCategory] = await db.insert(productCategories).values({
    id: categoryId,
    businessId: access.businessId,
    name: name.trim(),
    sortOrder: maxSortOrder + 1,
  }).returning()

  await publishToBusiness(access.businessId, {
    type: 'category.created',
    categoryId: categoryId,
  }, originDeviceId)

  return successResponse({ category: newCategory })
})
