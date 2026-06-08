import { NextRequest, NextResponse } from 'next/server'
import { db, ownershipTransfers, businessUsers } from '@/db'
import { eq, and, gt, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { auth } from '@/lib/auth'
import { validationError, errorResponse, enforceMaxContentLength } from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { Schemas } from '@/lib/schemas'
import { checkRateLimit, getClientIp, RateLimits } from '@/lib/rate-limit'
import { invalidateAccessCache } from '@/lib/business-auth'
import { logServerError } from '@/lib/server-logger'
import { getOriginDeviceId, publishCriticalToUser, publishToUser, RealtimeUnavailableError } from '@/lib/realtime'

const acceptSchema = z.object({
  code: Schemas.code(),
})

/**
 * POST /api/transfer/accept
 *
 * Accepts an ownership transfer by code.
 * User-level endpoint (not business-scoped) because the recipient
 * may not yet have access to the business.
 */
const MAX_BODY_BYTES = 1024

export async function POST(request: NextRequest) {
  try {
    const oversize = enforceMaxContentLength(request, MAX_BODY_BYTES)
    if (oversize) return oversize

    // Rate limit by IP
    const clientIp = getClientIp(request)
    const rateLimitResult = await checkRateLimit(`transfer:${clientIp}`, RateLimits.codeValidation)
    if (!rateLimitResult.success) {
      const retryAfter = String(Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000))
      const response = errorResponse(ApiMessageCode.TRANSFER_RATE_LIMITED, 429)
      response.headers.set('Retry-After', retryAfter)
      return response
    }

    // Require authentication
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session) {
      return errorResponse(ApiMessageCode.UNAUTHORIZED, 401)
    }
    if (!session.user.emailVerified) {
      return errorResponse(ApiMessageCode.EMAIL_NOT_VERIFIED, 403)
    }

    const body = await request.json()
    const validation = acceptSchema.safeParse(body)

    if (!validation.success) {
      return validationError(validation)
    }

    const { code } = validation.data
    const now = new Date()

    // Find the transfer
    const transfer = await db
      .select({
        id: ownershipTransfers.id,
        code: ownershipTransfers.code,
        status: ownershipTransfers.status,
        toEmail: ownershipTransfers.toEmail,
        expiresAt: ownershipTransfers.expiresAt,
        businessId: ownershipTransfers.businessId,
        fromUser: ownershipTransfers.fromUser,
      })
      .from(ownershipTransfers)
      .where(
        and(
          eq(ownershipTransfers.code, code),
          inArray(ownershipTransfers.status, ['pending']),
          gt(ownershipTransfers.expiresAt, now)
        )
      )
      .get()

    if (!transfer) {
      // Preserve 200-with-success-false so the client renders the error
      // inline (consistent with /api/invite/join's pattern).
      return NextResponse.json({
        success: false,
        messageCode: ApiMessageCode.TRANSFER_INVALID_OR_EXPIRED,
      })
    }

    // The better-auth DB session carries the user's email — trust it and
    // skip the DB round trip. If the session is stale (user deleted
    // mid-session) the transaction below would fail on the FK insert anyway.
    const isRecipient = session.user.email.toLowerCase() === transfer.toEmail.toLowerCase()

    if (!isRecipient) {
      return NextResponse.json({
        success: false,
        messageCode: ApiMessageCode.TRANSFER_WRONG_RECIPIENT,
      })
    }

    // Atomic: demote old owner, promote recipient, mark transfer completed.
    // Two extra invariants are enforced inside the transaction:
    //   1. Demote MUST find the from-user as the active owner. If
    //      another flow already demoted them (manual DB write, future
    //      bug, or another race), refuse to promote — otherwise the
    //      result is two owners on this business (no DB-level
    //      uniqueness guard prior to the schema migration shipped
    //      alongside this fix).
    //   2. If the recipient already has a membership and it's
    //      disabled, refuse the accept. Without this, a user the
    //      owner disabled mid-flow could re-activate as owner using
    //      a still-valid transfer code.
    try {
      await db.transaction(async (tx) => {
        // Demote old owner to partner — conditional on the row still
        // existing as the active owner. .returning() lets us detect
        // "0 rows updated" without a follow-up SELECT.
        const demoted = await tx
          .update(businessUsers)
          .set({ role: 'partner' })
          .where(and(
            eq(businessUsers.userId, transfer.fromUser),
            eq(businessUsers.businessId, transfer.businessId),
            eq(businessUsers.role, 'owner'),
            eq(businessUsers.status, 'active'),
          ))
          .returning({ id: businessUsers.id })

        if (demoted.length === 0) {
          throw new TransferOwnerGoneError()
        }

        // Upsert recipient as owner
        const [existingMembership] = await tx
          .select()
          .from(businessUsers)
          .where(and(
            eq(businessUsers.userId, session.user.id),
            eq(businessUsers.businessId, transfer.businessId),
          ))
          .limit(1)

        if (existingMembership) {
          // Refuse if the recipient was disabled by the owner before
          // the accept landed. They can't re-enter as a member, much
          // less as the owner, via a stale transfer code. The owner
          // must explicitly re-enable via /users/toggle-status.
          if (existingMembership.status === 'disabled') {
            throw new TransferRecipientDisabledError()
          }
          await tx
            .update(businessUsers)
            .set({ role: 'owner', status: 'active' })
            .where(eq(businessUsers.id, existingMembership.id))
        } else {
          await tx.insert(businessUsers).values({
            id: nanoid(),
            userId: session.user.id,
            businessId: transfer.businessId,
            role: 'owner',
            status: 'active',
            createdAt: now,
          })
        }

        await tx
          .update(ownershipTransfers)
          .set({
            status: 'completed',
            toUser: session.user.id,
          })
          .where(eq(ownershipTransfers.id, transfer.id))
      })
    } catch (err) {
      if (err instanceof TransferRecipientDisabledError) {
        return errorResponse(ApiMessageCode.TRANSFER_RECIPIENT_DISABLED, 403)
      }
      if (err instanceof TransferOwnerGoneError) {
        return errorResponse(ApiMessageCode.TRANSFER_OWNER_GONE, 409)
      }
      throw err
    }

    // Invalidate cached access
    invalidateAccessCache(transfer.fromUser, transfer.businessId)
    invalidateAccessCache(session.user.id, transfer.businessId)

    const newOwnerId = session.user.id
    const formerOwnerId = transfer.fromUser
    const businessId = transfer.businessId
    const originDeviceId = getOriginDeviceId(request)

    // Critical publishes — fail-closed. Run in parallel; if either throws
    // return 503 so the caller knows the ownership event was not delivered.
    try {
      await Promise.all([
        publishCriticalToUser(newOwnerId, {
          type: 'ownership.transferred',
          businessId,
          role: 'new_owner',
        }, originDeviceId),
        publishCriticalToUser(formerOwnerId, {
          type: 'session.revoked',
          businessId,
          reason: 'ownership_transferred',
        }, originDeviceId),
      ])
    } catch (err) {
      if (err instanceof RealtimeUnavailableError) {
        return errorResponse(ApiMessageCode.REALTIME_PUBLISH_UNAVAILABLE, 503)
      }
      throw err
    }

    // Non-critical publishes — fail-open.
    await publishToUser(newOwnerId, { type: 'business.list.changed', reason: 'added' }, originDeviceId)
    await publishToUser(formerOwnerId, { type: 'business.list.changed', reason: 'removed' }, originDeviceId)

    return NextResponse.json({
      success: true,
      businessId: transfer.businessId,
    })
  } catch (error) {
    logServerError('transfer.accept', error)
    return errorResponse(ApiMessageCode.TRANSFER_ACCEPT_FAILED, 500)
  }
}

// Sentinel errors thrown inside the accept transaction so the rollback
// happens automatically and the outer code can map back to the right
// envelope. Defined at module scope so `instanceof` works across the
// transaction boundary.
class TransferRecipientDisabledError extends Error {
  constructor() {
    super('Transfer recipient is disabled in this business')
  }
}

class TransferOwnerGoneError extends Error {
  constructor() {
    super('Original owner is no longer the active owner')
  }
}
