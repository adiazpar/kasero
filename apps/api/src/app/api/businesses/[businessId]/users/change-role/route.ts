import { db, businessUsers } from '@/db'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { canManageBusiness, invalidateAccessCache } from '@/lib/business-auth'
import { withBusinessAuth, validationError, errorResponse, successResponse } from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { Schemas } from '@/lib/schemas'
import { publishToBusiness, getOriginDeviceId } from '@/lib/realtime'

const changeRoleSchema = z.object({
  userId: Schemas.id(),
  role: Schemas.role().exclude(['owner']),
})

/**
 * POST /api/businesses/[businessId]/users/change-role
 *
 * Change user role (partner/employee).
 * Only owners can change roles, and they can't change another owner's role.
 */
export const POST = withBusinessAuth(async (request, access) => {
  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.TEAM_FORBIDDEN_NOT_MANAGER, 403)
  }

  const body = await request.json()
  const validation = changeRoleSchema.safeParse(body)

  if (!validation.success) {
    return validationError(validation)
  }

  const { userId, role } = validation.data

  // Can't change own role
  if (userId === access.userId) {
    return errorResponse(ApiMessageCode.TEAM_CANNOT_CHANGE_OWN_ROLE, 400)
  }

  // Get target user's business membership
  const [targetMembership] = await db
    .select()
    .from(businessUsers)
    .where(
      and(
        eq(businessUsers.userId, userId),
        eq(businessUsers.businessId, access.businessId)
      )
    )
    .limit(1)

  if (!targetMembership) {
    return errorResponse(ApiMessageCode.TEAM_USER_NOT_FOUND, 404)
  }

  if (targetMembership.role === 'owner') {
    return errorResponse(ApiMessageCode.TEAM_CANNOT_CHANGE_OWNER_ROLE, 400)
  }

  // Partner-on-partner guard: a partner cannot change another partner's
  // role. Only the owner can manage partners. Owners are excluded above.
  if (access.role === 'partner' && targetMembership.role === 'partner') {
    return errorResponse(ApiMessageCode.TEAM_PARTNER_CANNOT_MUTATE_PARTNER, 403)
  }

  // Update user role in business_users
  await db
    .update(businessUsers)
    .set({
      role,
    })
    .where(
      and(
        eq(businessUsers.userId, userId),
        eq(businessUsers.businessId, access.businessId)
      )
    )

  invalidateAccessCache(userId, access.businessId)

  await publishToBusiness(
    access.businessId,
    { type: 'team.member.role_changed', memberId: userId, role },
    getOriginDeviceId(request),
  )

  return successResponse({})
})
