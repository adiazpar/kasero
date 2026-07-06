import 'server-only'
import type { BillingAdapter, BillingPlatform } from './types'
import { appleBillingAdapter } from './apple'
import { googleBillingAdapter } from './google'

export type { BillingAdapter, BillingPlatform, VerifiedPurchase } from './types'

const ADAPTERS: Record<BillingPlatform, BillingAdapter> = {
  apple: appleBillingAdapter,
  google: googleBillingAdapter,
}

export function getBillingAdapter(platform: BillingPlatform): BillingAdapter {
  return ADAPTERS[platform]
}
