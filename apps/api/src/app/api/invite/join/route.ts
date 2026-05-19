import { NextRequest, NextResponse } from 'next/server'
import { db, inviteCodes, businesses, businessUsers } from '@/db'
import { eq, and, gt, sql } from 'drizzle-orm'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { auth } from '@/lib/auth'
import { validationError, errorResponse, applyRateLimit, enforceMaxContentLength } from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { Schemas } from '@/lib/schemas'
import { RateLimits } from '@/lib/rate-limit'
import { logServerError } from '@/lib/server-logger'
import { publishToBusiness, publishToUser, getOriginDeviceId } from '@/lib/realtime'

const joinSchema = z.object({
  code: Schemas.code(),
})

/**
 * POST /api/invite/join
 *
 * Joins the authenticated user to a business using an invite code.
 * Creates a business_users membership entry.
 */
// Body is `{ code }` — 1 KB cap is generous.
const MAX_BODY_BYTES = 1024

export async function POST(request: NextRequest) {
  try {
    const oversize = enforceMaxContentLength(request, MAX_BODY_BYTES)
    if (oversize) return oversize

    // Require authentication. Joining a business with an unverified
    // account is risky (the email might belong to someone else), so we
    // gate on emailVerified here even though /invite/validate does not.
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session) {
      return errorResponse(ApiMessageCode.UNAUTHORIZED, 401)
    }
    if (!session.user.emailVerified) {
      return errorResponse(ApiMessageCode.EMAIL_NOT_VERIFIED, 403)
    }

    // Cap join attempts — a 6-char invite code is a brute-force surface
    // even with /validate limited, so the join itself needs its own gate.
    const rateLimited = await applyRateLimit(
      `join:${session.user.id}`,
      RateLimits.userMutation,
    )
    if (rateLimited) return rateLimited

    const body = await request.json()
    const validation = joinSchema.safeParse(body)

    if (!validation.success) {
      return validationError(validation)
    }

    const { code } = validation.data
    const now = new Date()

    // Find the invite code
    const invite = await db
      .select({
        id: inviteCodes.id,
        code: inviteCodes.code,
        role: inviteCodes.role,
        expiresAt: inviteCodes.expiresAt,
        businessId: inviteCodes.businessId,
        businessName: businesses.name,
      })
      .from(inviteCodes)
      .innerJoin(businesses, eq(inviteCodes.businessId, businesses.id))
      .where(
        and(
          eq(inviteCodes.code, code),
          sql`${inviteCodes.usedBy} IS NULL`,
          gt(inviteCodes.expiresAt, now)
        )
      )
      .get()

    if (!invite) {
      // 200 with success:false so the client renders the error inline
      return NextResponse.json({
        success: false,
        messageCode: ApiMessageCode.INVITE_INVALID_OR_EXPIRED,
      })
    }

    // Check existing membership and split by status. The status='active'
    // and status='disabled' branches return DIFFERENT envelopes:
    //   - active   -> INVITE_ALREADY_MEMBER (UX hint, no security
    //                 concern; the user can already get in)
    //   - disabled -> INVITE_USER_IS_DISABLED (refuses to silently
    //                 re-activate via fresh invite — that bypass let
    //                 a partner remove-then-reinvite to undo a
    //                 manager's disable. Re-activation must go
    //                 through users/toggle-status.)
    // Filtering only by id (no status) previously returned
    // INVITE_ALREADY_MEMBER for both, leaking that the user is a
    // (disabled) member to anyone holding the invite code.
    const existingMembership = await db
      .select({ id: businessUsers.id, status: businessUsers.status })
      .from(businessUsers)
      .where(
        and(
          eq(businessUsers.userId, session.user.id),
          eq(businessUsers.businessId, invite.businessId)
        )
      )
      .get()

    if (existingMembership) {
      const messageCode =
        existingMembership.status === 'disabled'
          ? ApiMessageCode.INVITE_USER_IS_DISABLED
          : ApiMessageCode.INVITE_ALREADY_MEMBER
      return NextResponse.json({
        success: false,
        messageCode,
      })
    }

    // Atomic claim: only one redeemer can flip usedBy from NULL. If two
    // users race the same single-use code, one wins the UPDATE, the
    // other gets `claimed.length === 0` and a 409. The previous
    // db.batch(insert + update) ran the writes simultaneously — neither
    // could observe the other's claim, so both batches succeeded and
    // the "single use" invariant was broken (two memberships, one row
    // in invite_codes set to whichever user wrote last).
    const membershipId = nanoid()
    const claimed = await db
      .update(inviteCodes)
      .set({ usedBy: session.user.id })
      .where(
        and(
          eq(inviteCodes.id, invite.id),
          sql`${inviteCodes.usedBy} IS NULL`,
        ),
      )
      .returning({ id: inviteCodes.id })

    if (claimed.length === 0) {
      // Lost the race to another redeemer — the code was already used
      // between our SELECT above and this UPDATE. Treat as invalid
      // (same envelope as expired/missing) so a probing client can't
      // distinguish "lost the race" from "wrong code".
      return NextResponse.json({
        success: false,
        messageCode: ApiMessageCode.INVITE_INVALID_OR_EXPIRED,
      })
    }

    // Claim succeeded — only NOW write the membership row. If this
    // insert fails for any reason, the invite stays consumed (better
    // than the inverse: an unredeemable invite is recoverable by an
    // admin, a free re-claim is a security regression).
    await db.insert(businessUsers).values({
      id: membershipId,
      userId: session.user.id,
      businessId: invite.businessId,
      role: invite.role,
      status: 'active',
      createdAt: now,
    })

    const originDeviceId = getOriginDeviceId(request)
    await publishToBusiness(invite.businessId, {
      type: 'team.member.joined',
      memberId: session.user.id,
    }, originDeviceId)
    await publishToBusiness(invite.businessId, {
      type: 'team.invite.consumed',
      inviteId: invite.id,
      consumedByName: session.user.name ?? '',
    }, originDeviceId)
    await publishToUser(session.user.id, {
      type: 'business.list.changed',
      reason: 'added',
    }, originDeviceId)

    return NextResponse.json({
      success: true,
      businessId: invite.businessId,
      businessName: invite.businessName,
      role: invite.role,
    })
  } catch (error) {
    logServerError('invite.join', error)
    return NextResponse.json(
      {
        success: false,
        messageCode: ApiMessageCode.INVITE_JOIN_FAILED,
      },
      { status: 500 },
    )
  }
}
