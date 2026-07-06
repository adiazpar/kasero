import { Capacitor } from '@capacitor/core'

/**
 * Client-side billing adapter seam for Kasero Pro purchases.
 *
 * The modal consumes this to decide whether to render a live purchase
 * button or the "coming to the App Store / Google Play" state. Web
 * billing is intentionally out of scope at launch (store subscriptions
 * only, per the launch plan); the native store adapter is a stub until
 * the store products exist.
 */

export type BillingUnavailableReason = 'store-products-pending' | 'web-unsupported'

export type BillingAdapter =
  | {
      available: true
      platform: 'ios' | 'android'
      /**
       * Launch the native purchase flow for a store product and resolve
       * with the receipt/token to POST to
       * /api/businesses/[businessId]/subscription/verify-purchase.
       */
      purchase: (productId: string) => Promise<{ platform: 'apple' | 'google'; receipt: string }>
    }
  | {
      available: false
      reason: BillingUnavailableReason
    }

/**
 * TODO(owner): wire native store purchases before flipping
 * `available: true` on the native branch. Two viable paths:
 *   - RevenueCat: add @revenuecat/purchases-capacitor, configure the
 *     iOS/Android API keys, map the `kasero_pro_monthly` /
 *     `kasero_pro_annual` offerings, and return the StoreKit2 signed
 *     transaction (iOS) / Play purchase token (Android) from the
 *     purchase result.
 *   - Direct StoreKit 2 / Play Billing via a Capacitor plugin (e.g.
 *     capacitor-subscriptions), returning the same receipt shapes.
 * Either way the receipt goes to the server's verify-purchase route —
 * the client NEVER flips the plan locally on purchase success.
 * No new npm dependency is added until that decision is made.
 */
export function getBillingAdapter(): BillingAdapter {
  if (Capacitor.isNativePlatform()) {
    // Store products are not configured yet — the native purchase flow
    // stays disabled and the modal shows the "coming soon" state.
    return { available: false, reason: 'store-products-pending' }
  }
  // Web checkout is out of scope at launch: Pro is sold through the
  // stores; the web surface offers promo-code redemption only.
  return { available: false, reason: 'web-unsupported' }
}
