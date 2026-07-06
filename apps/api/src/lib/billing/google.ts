import 'server-only'
import type { BillingAdapter, VerifiedPurchase } from './types'

/**
 * Google Play billing adapter (stub).
 *
 * TODO(owner): wire the Google Play Developer API before enabling paid
 * Pro on Android. Exact steps:
 *   1. Google Play Console -> Setup -> API access: link a Google Cloud
 *      project and create a service account with the "View financial
 *      data" + "Manage orders and subscriptions" permissions.
 *   2. Create a JSON key for that service account and set the env vars
 *      below (Vercel Production + Preview, and the Bitwarden note
 *      "Kasero — Vercel project envs"):
 *        GOOGLE_PLAY_SERVICE_ACCOUNT_JSON — the full JSON key, verbatim
 *        GOOGLE_PLAY_PACKAGE_NAME         — the Android applicationId
 *   3. Implement verifyReceipt():
 *        a. The client sends the Play Billing purchase token as
 *           `receipt`. Mint a service-account JWT (use `jose`, already a
 *           dependency) with scope
 *           https://www.googleapis.com/auth/androidpublisher and
 *           exchange it for an access token.
 *        b. Call purchases.subscriptionsv2.get:
 *           GET androidpublisher.googleapis.com/androidpublisher/v3/
 *               applications/{GOOGLE_PLAY_PACKAGE_NAME}/purchases/
 *               subscriptionsv2/tokens/{purchaseToken}
 *        c. Check subscriptionState is ACTIVE or IN_GRACE_PERIOD, read
 *           lineItems[0].{productId,expiryTime} ->
 *           VerifiedPurchase.{productId,expiresAt}, and use
 *           latestOrderId as transactionId.
 *   4. Configure Real-time Developer Notifications (Pub/Sub) for
 *      renewals / revocations so expiry stays in sync.
 */
export const googleBillingAdapter: BillingAdapter = {
  platform: 'google',

  isConfigured(): boolean {
    return Boolean(
      process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON &&
        process.env.GOOGLE_PLAY_PACKAGE_NAME,
    )
  },

  async verifyReceipt(_receipt: string): Promise<VerifiedPurchase | null> {
    // Unreachable until isConfigured() can return true AND the Play
    // Developer API call above is implemented. Returning null (never a
    // fabricated purchase) keeps the "no Pro from an unverified receipt"
    // invariant even if this stub is ever called by mistake.
    return null
  },
}
