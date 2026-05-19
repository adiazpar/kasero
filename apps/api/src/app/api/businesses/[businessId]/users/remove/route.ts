import { db, businessUsers } from '@/db'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { canManageBusiness, invalidateAccessCache } from '@/lib/business-auth'
import { withBusinessAuth, validationError, errorResponse, successResponse } from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { Schemas } from '@/lib/schemas'
import {
  publishToBusiness,
  publishCriticalToUser,
  publishToUser,
  getOriginDeviceId,
  RealtimeUnavailableError,
} from '@/lib/realtime'

const removeMemberSchema = z.object({
  userId: Schemas.id(),
})

/**
 * POST /api/businesses/[businessId]/users/remove
 *
 * Hard-delete the business_users membership row. The user account itself
 * persists; their historical data (sales, products edited, etc.) keeps
 * the user_id reference intact for audit.
 *
 * Permission matrix:
 *  - Caller must be active member of the business AND canManageBusiness.
 *  - Cannot remove themselves (use /leave).
 *  - Cannot remove the owner.
 *  - Partner cannot remove another partner (TEAM_PARTNER_CANNOT_MUTATE_PARTNER).
 */
export const POST = withBusinessAuth(async (request, access) => {
  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.TEAM_FORBIDDEN_NOT_MANAGER, 403)
  }

  const body = await request.json()
  const validation = removeMemberSchema.safeParse(body)
  if (!validation.success) return validationError(validation)

  const { userId } = validation.data

  if (userId === access.userId) {
    return errorResponse(ApiMessageCode.TEAM_CANNOT_REMOVE_SELF, 400)
  }

  const [target] = await db
    .select({ role: businessUsers.role })
    .from(businessUsers)
    .where(
      and(
        eq(businessUsers.userId, userId),
        eq(businessUsers.businessId, access.businessId),
      ),
    )
    .limit(1)

  if (!target) {
    return errorResponse(ApiMessageCode.TEAM_USER_NOT_FOUND, 404)
  }

  if (target.role === 'owner') {
    return errorResponse(ApiMessageCode.TEAM_CANNOT_REMOVE_OWNER, 403)
  }

  if (access.role === 'partner' && target.role === 'partner') {
    return errorResponse(ApiMessageCode.TEAM_PARTNER_CANNOT_MUTATE_PARTNER, 403)
  }

  await db
    .delete(businessUsers)
    .where(
      and(
        eq(businessUsers.userId, userId),
        eq(businessUsers.businessId, access.businessId),
      ),
    )

  invalidateAccessCache(userId, access.businessId)

  const originDeviceId = getOriginDeviceId(request)

  await publishToBusiness(
    access.businessId,
    { type: 'team.member.removed', memberId: userId },
    originDeviceId,
  )

  try {
    await publishCriticalToUser(
      userId,
      { type: 'session.revoked', businessId: access.businessId, reason: 'removed' },
      originDeviceId,
    )
  } catch (err) {
    if (err instanceof RealtimeUnavailableError) {
      return errorResponse(ApiMessageCode.REALTIME_PUBLISH_UNAVAILABLE, 503)
    }
    throw err
  }

  await publishToUser(
    userId,
    { type: 'business.list.changed', reason: 'removed' },
    originDeviceId,
  )

  return successResponse({})
})
