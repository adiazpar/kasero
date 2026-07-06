import 'server-only'
import type { BillingAdapter, VerifiedPurchase } from './types'

/**
 * Apple App Store billing adapter (stub).
 *
 * TODO(owner): wire the App Store Server API before enabling paid Pro on
 * iOS. Exact steps:
 *   1. App Store Connect -> Users and Access -> Integrations -> In-App
 *      Purchase: generate an API key. Download the .p8 once; record the
 *      Key ID and Issuer ID.
 *   2. Set the env vars below (Vercel Production + Preview, and the
 *      Bitwarden note "Kasero — Vercel project envs"):
 *        APPLE_IAP_KEY_ID       — the key id from step 1
 *        APPLE_IAP_ISSUER_ID    — the issuer id from step 1
 *        APPLE_IAP_PRIVATE_KEY  — verbatim contents of the .p8 file
 *        APPLE_IAP_BUNDLE_ID    — the iOS app's bundle identifier
 *   3. Implement verifyReceipt():
 *        a. Mint an ES256 JWT (use `jose`, already a dependency) with
 *           iss=APPLE_IAP_ISSUER_ID, kid=APPLE_IAP_KEY_ID,
 *           aud='appstoreconnect-v1', bid=APPLE_IAP_BUNDLE_ID.
 *        b. The client sends the StoreKit 2 signed transaction id as
 *           `receipt`. Call GET /inApps/v1/transactions/{transactionId}
 *           on api.storekit.itunes.apple.com with the JWT.
 *        c. Verify the returned signedTransactionInfo JWS against
 *           Apple's certificate chain, check bundleId + productId, and
 *           map expiresDate -> VerifiedPurchase.expiresAt.
 *   4. Add the App Store Server Notifications V2 webhook for renewals /
 *      refunds so expiry stays in sync without client round-trips.
 */
export const appleBillingAdapter: BillingAdapter = {
  platform: 'apple',

  isConfigured(): boolean {
    return Boolean(
      process.env.APPLE_IAP_KEY_ID &&
        process.env.APPLE_IAP_ISSUER_ID &&
        process.env.APPLE_IAP_PRIVATE_KEY &&
        process.env.APPLE_IAP_BUNDLE_ID,
    )
  },

  async verifyReceipt(_receipt: string): Promise<VerifiedPurchase | null> {
    // Unreachable until isConfigured() can return true AND the App Store
    // Server API call above is implemented. Returning null (never a
    // fabricated purchase) keeps the "no Pro from an unverified receipt"
    // invariant even if this stub is ever called by mistake.
    return null
  },
}
