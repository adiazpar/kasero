import { withBusinessAuth, errorResponse, successResponse } from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { db, businesses } from '@/db'
import { eq } from 'drizzle-orm'

/**
 * GET /api/businesses/[businessId]/subscription
 *
 * Current Kasero Pro subscription state for the business. Any member can
 * read — the plan gates shared features, so employees see the same tier
 * badge the owner does. Reads the row directly (not access.plan) so the
 * response never lags the 60s access cache right after a redeem.
 */
export const GET = withBusinessAuth(async (_request, access) => {
  const row = await db
    .select({
      plan: businesses.plan,
      planExpiresAt: businesses.planExpiresAt,
      planSource: businesses.planSource,
    })
    .from(businesses)
    .where(eq(businesses.id, access.businessId))
    .get()

  if (!row) {
    return errorResponse(ApiMessageCode.BUSINESS_NOT_FOUND, 404)
  }

  return successResponse({
    plan: row.plan,
    expiresAt: row.planExpiresAt,
    source: row.planSource,
  })
})
