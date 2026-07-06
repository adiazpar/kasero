import { z } from 'zod'
import {
  withBusinessAuth,
  errorResponse,
  successResponse,
  validationError,
  applyRateLimit,
} from '@/lib/api-middleware'
import { isOwner, invalidateAccessCacheForBusiness } from '@/lib/business-auth'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { isPro } from '@kasero/shared/entitlements'
import { db, businesses } from '@/db'
import { eq } from 'drizzle-orm'
import { RateLimits } from '@/lib/rate-limit'
import { parsePromoCodes, addCalendarMonths } from '@/lib/promo-codes'
import { getOriginDeviceId, publishToBusiness } from '@/lib/realtime'
import { logServerError } from '@/lib/server-logger'

const redeemSchema = z.object({
  code: z.string().trim().min(1).max(64),
})

/**
 * POST /api/businesses/[businessId]/subscription/redeem
 *
 * Redeem a marketing/beta promo code for Kasero Pro. Owner-only. Codes
 * live in the PRO_PROMO_CODES env var (`CODE:months` comma-separated)
 * and are grants, never sold outside the stores (Apple 3.1.1).
 *
 * Already-pro businesses get their expiry EXTENDED: the grant months are
 * added on top of max(now, current expiry). A non-expiring pro grant
 * (planExpiresAt null) is never shortened by a redeem.
 */
export const POST = withBusinessAuth(async (request, access) => {
  const originDeviceId = getOriginDeviceId(request)

  if (!isOwner(access.role)) {
    return errorResponse(ApiMessageCode.SUBSCRIPTION_OWNER_ONLY, 403)
  }

  // Brute-force guard BEFORE any code validation: promo codes are short
  // human-shareable strings, so guessing must burn the caller's budget
  // whether or not the guess parses. Keyed per user (not per business)
  // so owning several businesses doesn't multiply the budget.
  const rateLimited = await applyRateLimit(
    `promo:${access.userId}`,
    RateLimits.promoRedeem,
  )
  if (rateLimited) return rateLimited

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse(ApiMessageCode.VALIDATION_GENERIC, 400)
  }
  const validation = redeemSchema.safeParse(body)
  if (!validation.success) {
    return validationError(validation)
  }

  // Case-insensitive match against the configured namespace. An absent /
  // empty PRO_PROMO_CODES env intentionally reads as "no valid codes"
  // (same 400 as a wrong guess) — a distinct "not configured" response
  // would leak deployment state to code-guessers.
  const codes = parsePromoCodes(process.env.PRO_PROMO_CODES)
  const months = codes.get(validation.data.code.toUpperCase())
  if (!months) {
    return errorResponse(ApiMessageCode.SUBSCRIPTION_INVALID_CODE, 400)
  }

  try {
    // Read the row fresh — access.plan/planExpiresAt ride a 60s cache
    // and a stale expiry here would mis-compute the extension.
    const row = await db
      .select({ plan: businesses.plan, planExpiresAt: businesses.planExpiresAt })
      .from(businesses)
      .where(eq(businesses.id, access.businessId))
      .get()
    if (!row) {
      return errorResponse(ApiMessageCode.BUSINESS_NOT_FOUND, 404)
    }

    const now = new Date()
    const currentlyPro = isPro(row.plan, row.planExpiresAt, now)

    // A non-expiring pro grant must never be shortened: keep expiry null.
    // Otherwise extend from whichever is later — now (expired/free rows)
    // or the current expiry (active pro rows).
    let newExpiresAt: Date | null
    if (currentlyPro && row.planExpiresAt === null) {
      newExpiresAt = null
    } else {
      const base =
        currentlyPro && row.planExpiresAt && row.planExpiresAt.getTime() > now.getTime()
          ? row.planExpiresAt
          : now
      newExpiresAt = addCalendarMonths(base, months)
    }

    await db
      .update(businesses)
      .set({ plan: 'pro', planSource: 'promo', planExpiresAt: newExpiresAt })
      .where(eq(businesses.id, access.businessId))

    invalidateAccessCacheForBusiness(access.businessId)

    // Fail-open UI hint — publishToBusiness logs and continues on a
    // realtime outage; the redeem itself has already committed.
    await publishToBusiness(
      access.businessId,
      { type: 'business.updated', fields: ['plan'] },
      originDeviceId,
    )

    return successResponse(
      { plan: 'pro', expiresAt: newExpiresAt },
      ApiMessageCode.SUBSCRIPTION_REDEEM_SUCCESS,
    )
  } catch (err) {
    logServerError('subscription.redeem', err)
    return errorResponse(ApiMessageCode.INTERNAL_ERROR, 500)
  }
})
