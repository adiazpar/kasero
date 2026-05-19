import { db, businessUsers, users, ownershipTransfers } from '@/db'
import { session as sessionTable } from '@kasero/shared/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { z } from 'zod'
import { canManageBusiness, invalidateAccessCache } from '@/lib/business-auth'
import { withBusinessAuth, validationError, errorResponse, successResponse } from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { Schemas } from '@/lib/schemas'
import { publishToBusiness, getOriginDeviceId } from '@/lib/realtime'

const toggleStatusSchema = z.object({
  userId: Schemas.id(),
  status: z.enum(['active', 'disabled']),
})

/**
 * POST /api/businesses/[businessId]/users/toggle-status
 *
 * Toggle user active/disabled status.
 * Only owners can toggle status, and they can't toggle their own status.
 */
export const POST = withBusinessAuth(async (request, access) => {
  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.TEAM_FORBIDDEN_NOT_MANAGER, 403)
  }

  const body = await request.json()
  const validation = toggleStatusSchema.safeParse(body)

  if (!validation.success) {
    return validationError(validation)
  }

  const { userId, status } = validation.data

  // Can't toggle own status
  if (userId === access.userId) {
    return errorResponse(ApiMessageCode.TEAM_CANNOT_CHANGE_OWN_STATUS, 400)
  }

  // Fetch target's membership to get their role
  const [targetMembership] = await db
    .select({ role: businessUsers.role })
    .from(businessUsers)
    .where(
      and(
        eq(businessUsers.userId, userId),
        eq(businessUsers.businessId, access.businessId)
      )
    )
    .limit(1)

  if (!targetMembership) {
    return errorResponse(ApiMessageCode.BUSINESS_NOT_FOUND, 404)
  }

  // Owner-cannot-be-disabled invariant: no member — partner or owner-
  // self — can flip the owner's status. The self-toggle guard above
  // already blocks the owner from disabling themselves. This block stops
  // a partner from locking the owner out of their own business
  // (verified-exploitable in audit C-4 prior to this fix). Mirrors the
  // owner-protection in users/remove and users/change-role.
  if (targetMembership.role === 'owner') {
    return errorResponse(ApiMessageCode.TEAM_CANNOT_CHANGE_OWNER_STATUS, 403)
  }

  // Partner-on-partner guard: a partner cannot toggle another partner's
  // status. Only the owner can manage partners. Employees cannot reach
  // this route at all (gated above).
  if (access.role === 'partner' && targetMembership.role === 'partner') {
    return errorResponse(ApiMessageCode.TEAM_PARTNER_CANNOT_MUTATE_PARTNER, 403)
  }

  // When disabling a user we also cancel every pending ownership
  // transfer addressed to their email. Otherwise a stale transfer code
  // (still inside its 24h window) would let the disabled user re-
  // activate as owner via /api/transfer/accept (audit H-4 attack
  // chain). The accept route now also rejects disabled recipients,
  // but cancelling here is the cheaper, more durable defense.
  // The two writes run inside db.transaction so a partial failure
  // can't leave the disable applied while the transfers stay live.
  await db.transaction(async (tx) => {
    await tx
      .update(businessUsers)
      .set({ status })
      .where(
        and(
          eq(businessUsers.userId, userId),
          eq(businessUsers.businessId, access.businessId)
        )
      )

    if (status === 'disabled') {
      // Resolve the email inside the transaction — JWT-style stale
      // emails won't surface here because we read straight from the
      // users row.
      const [target] = await tx
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)

      if (target) {
        await tx
          .update(ownershipTransfers)
          .set({ status: 'cancelled' })
          .where(
            and(
              // Case-insensitive email match. The DB has a LOWER(email)
              // expression index on users so the lookup above is cheap;
              // here we just compare the recipient column literally
              // (toEmail is stored verbatim — the cancellation matches
              // any case variant of the user's actual address).
              sql`LOWER(${ownershipTransfers.toEmail}) = LOWER(${target.email})`,
              eq(ownershipTransfers.status, 'pending'),
            )
          )
      }

      // Server-side session revocation. With better-auth, sessions live
      // in the `session` table and are validated on every request. Deleting
      // the user's rows here forces them to re-login on next request,
      // matching the audit M-21 remediation: a disabled user's session
      // can't keep authorizing non-business routes (/api/user/language,
      // AI routes, etc.) until natural cookie expiry.
      await tx.delete(sessionTable).where(eq(sessionTable.userId, userId))
    }
  })

  invalidateAccessCache(userId, access.businessId)

  await publishToBusiness(
    access.businessId,
    { type: 'team.member.status_changed', memberId: userId, status },
    getOriginDeviceId(request),
  )

  return successResponse({})
})
