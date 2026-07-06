/**
 * Kasero Pro entitlements — shared between the API (route gating, quota
 * selection) and the web app (paywall UI, feature teasers).
 *
 * The `businesses.plan` column is the raw tier; every entitlement check
 * MUST go through `isPro()` so an expired 'pro' row never grants Pro
 * features. Never read `plan === 'pro'` directly in feature code.
 */

export type BusinessPlan = 'free' | 'pro'

export type PlanSource = 'none' | 'apple' | 'google' | 'promo'

/**
 * Is this business currently entitled to Kasero Pro?
 *
 * Pro AND (no expiry, i.e. a non-expiring grant, OR expiry in the
 * future). `planExpiresAt` accepts a Date (server / Drizzle timestamp
 * mode), an ISO string (client, after JSON serialization), or an epoch
 * milliseconds number.
 */
export function isPro(
  plan: BusinessPlan | string | null | undefined,
  planExpiresAt: Date | string | number | null | undefined,
  now: Date = new Date(),
): boolean {
  if (plan !== 'pro') return false
  if (planExpiresAt === null || planExpiresAt === undefined) return true
  const expiry =
    planExpiresAt instanceof Date ? planExpiresAt : new Date(planExpiresAt)
  // An unparsable expiry is treated as expired — fail toward free
  // rather than granting Pro on corrupt data.
  if (Number.isNaN(expiry.getTime())) return false
  return expiry.getTime() > now.getTime()
}

/**
 * Display-only price reference (USD). The store products (App Store /
 * Google Play) are the billing source of truth — regional pricing is
 * configured store-side and may differ from these numbers.
 */
export const PRO_PRICING = {
  monthlyUsd: 7.99,
  annualUsd: 79.99,
} as const

/**
 * Per-user daily AI call ceiling by tier. Consumed by the API's rate
 * limiter (RateLimits.aiDaily / RateLimits.aiDailyPro) and by the web
 * paywall copy.
 */
export const AI_DAILY_QUOTA = {
  free: 100,
  pro: 400,
} as const
