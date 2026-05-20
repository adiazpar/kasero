import { db, businesses, productCategories } from '@/db'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { canManageBusiness } from '@/lib/business-auth'
import { withBusinessAuth, validationError, errorResponse, successResponse } from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { publishToBusiness, getOriginDeviceId } from '@/lib/realtime'
import type { BusinessRealtimeEvent } from '@kasero/shared/realtime'

type ProductSettingsField = Extract<
  BusinessRealtimeEvent,
  { type: 'product.settings.updated' }
>['fields'][number]

const sortPreferenceValues = ['name_asc', 'name_desc', 'price_asc', 'price_desc', 'category', 'stock_asc', 'stock_desc'] as const

const updateSettingsSchema = z.object({
  defaultCategoryId: z.string().nullable().optional(),
  sortPreference: z.enum(sortPreferenceValues).optional(),
})

/**
 * GET /api/businesses/[businessId]/product-settings
 *
 * Get product settings for the business (stored on businesses table).
 */
export const GET = withBusinessAuth(async (request, access) => {
  const [business] = await db
    .select({
      defaultCategoryId: businesses.defaultCategoryId,
      sortPreference: businesses.sortPreference,
    })
    .from(businesses)
    .where(eq(businesses.id, access.businessId))
    .limit(1)

  return successResponse({
    settings: {
      defaultCategoryId: business?.defaultCategoryId ?? null,
      sortPreference: business?.sortPreference ?? 'name_asc',
    },
  })
})

/**
 * PATCH /api/businesses/[businessId]/product-settings
 *
 * Update product settings.
 */
export const PATCH = withBusinessAuth(async (request, access) => {
  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.FORBIDDEN, 403)
  }

  const originDeviceId = getOriginDeviceId(request)

  const body = await request.json()
  const validation = updateSettingsSchema.safeParse(body)

  if (!validation.success) {
    return validationError(validation)
  }

  const { defaultCategoryId, sortPreference } = validation.data

  // If the caller is setting a defaultCategoryId to a concrete value,
  // verify it belongs to THIS business. Otherwise a partner could point
  // their default at a category owned by another business they happen
  // to know the id of.
  if (typeof defaultCategoryId === 'string' && defaultCategoryId.length > 0) {
    const [category] = await db
      .select({ id: productCategories.id })
      .from(productCategories)
      .where(
        and(
          eq(productCategories.id, defaultCategoryId),
          eq(productCategories.businessId, access.businessId),
        ),
      )
      .limit(1)

    if (!category) {
      return errorResponse(ApiMessageCode.CATEGORY_NOT_FOUND, 404)
    }
  }

  const updateData: Record<string, unknown> = {}
  if (defaultCategoryId !== undefined) {
    updateData.defaultCategoryId = defaultCategoryId
  }
  if (sortPreference !== undefined) {
    updateData.sortPreference = sortPreference
  }

  await db
    .update(businesses)
    .set(updateData)
    .where(eq(businesses.id, access.businessId))

  const changedFields: ProductSettingsField[] = []
  if (defaultCategoryId !== undefined) changedFields.push('defaultCategoryId')
  if (sortPreference !== undefined) changedFields.push('sortPreference')

  if (changedFields.length > 0) {
    await publishToBusiness(
      access.businessId,
      { type: 'product.settings.updated', fields: changedFields },
      originDeviceId,
    )
  }

  return successResponse({
    settings: {
      defaultCategoryId: defaultCategoryId ?? null,
      sortPreference: sortPreference ?? null,
    },
  })
})
