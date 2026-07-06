import { z } from 'zod'
import {
  withBusinessAuth,
  errorResponse,
  successResponse,
  validationError,
} from '@/lib/api-middleware'
import { isOwner, invalidateAccessCacheForBusiness } from '@/lib/business-auth'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { db, businesses } from '@/db'
import { eq } from 'drizzle-orm'
import { getBillingAdapter } from '@/lib/billing'
import { getOriginDeviceId, publishToBusiness } from '@/lib/realtime'
import { logServerError } from '@/lib/server-logger'

// StoreKit 2 signed transactions / Play purchase tokens are opaque
// strings up to a few KB; 32 KB is a generous ceiling well under the
// wrapper's 256 KB body cap.
const verifySchema = z.object({
  platform: z.enum(['apple', 'google']),
  receipt: z.string().trim().min(1).max(32 * 1024),
})

/**
 * POST /api/businesses/[businessId]/subscription/verify-purchase
 *
 * Grant Kasero Pro from a store purchase. Owner-only. Delegates receipt
 * verification to the per-platform billing adapter
 * (apps/api/src/lib/billing/{apple,google}.ts); returns 503
 * SUBSCRIPTION_NOT_CONFIGURED until the owner wires the App Store Server
 * API / Play Developer API credentials. Pro is granted ONLY from a
 * store-confirmed VerifiedPurchase — never from the raw client receipt.
 */
export const POST = withBusinessAuth(async (request, access) => {
  const originDeviceId = getOriginDeviceId(request)

  if (!isOwner(access.role)) {
    return errorResponse(ApiMessageCode.SUBSCRIPTION_OWNER_ONLY, 403)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse(ApiMessageCode.VALIDATION_GENERIC, 400)
  }
  const validation = verifySchema.safeParse(body)
  if (!validation.success) {
    return validationError(validation)
  }

  const { platform, receipt } = validation.data
  const adapter = getBillingAdapter(platform)

  if (!adapter.isConfigured()) {
    return errorResponse(ApiMessageCode.SUBSCRIPTION_NOT_CONFIGURED, 503)
  }

  try {
    const verified = await adapter.verifyReceipt(receipt)
    if (!verified) {
      // Store rejected the receipt (tampered / refunded / wrong app).
      return errorResponse(ApiMessageCode.SUBSCRIPTION_INVALID_CODE, 400)
    }

    await db
      .update(businesses)
      .set({
        plan: 'pro',
        planSource: verified.platform,
        planExpiresAt: verified.expiresAt,
      })
      .where(eq(businesses.id, access.businessId))

    invalidateAccessCacheForBusiness(access.businessId)

    // Fail-open UI hint — the grant has already committed.
    await publishToBusiness(
      access.businessId,
      { type: 'business.updated', fields: ['plan'] },
      originDeviceId,
    )

    return successResponse(
      { plan: 'pro', expiresAt: verified.expiresAt },
      ApiMessageCode.SUBSCRIPTION_REDEEM_SUCCESS,
    )
  } catch (err) {
    logServerError('subscription.verify-purchase', err)
    return errorResponse(ApiMessageCode.INTERNAL_ERROR, 500)
  }
})
