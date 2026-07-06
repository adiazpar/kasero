/**
 * Server-side billing adapter seam (Kasero Pro store subscriptions).
 *
 * One adapter per store platform. The verify-purchase route resolves the
 * adapter from the request's `platform` field, checks `isConfigured()`,
 * and only grants Pro from a non-null `VerifiedPurchase` returned by
 * `verifyReceipt()`. NEVER grant Pro from the raw client receipt — the
 * receipt string is attacker-controlled until the store API has
 * confirmed it.
 */

export type BillingPlatform = 'apple' | 'google'

/**
 * The store-confirmed result of a receipt verification. Every field
 * comes from the store API response, never from the client payload.
 */
export interface VerifiedPurchase {
  platform: BillingPlatform
  /** Store product identifier (e.g. 'kasero_pro_monthly'). */
  productId: string
  /** Store transaction / order id — persist for audit + dedupe when the grant path lands. */
  transactionId: string
  /** Subscription period end, from the store. Null only for non-expiring purchases (not used by Kasero Pro). */
  expiresAt: Date | null
}

export interface BillingAdapter {
  platform: BillingPlatform
  /** True once the owner has wired the store API credentials (env vars). */
  isConfigured(): boolean
  /**
   * Verify a client-submitted receipt/token against the store API.
   * Returns the store-confirmed purchase, or null when the store rejects
   * the receipt (tampered, refunded, expired grace period, wrong app).
   * Throws only on transport-level failures.
   */
  verifyReceipt(receipt: string): Promise<VerifiedPurchase | null>
}
