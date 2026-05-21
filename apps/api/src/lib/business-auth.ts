import 'server-only'
import { headers } from 'next/headers'
import { db, businessUsers, businesses, products, productCategories, expenseCategories, expenses } from '@/db'
import { eq, and, inArray } from 'drizzle-orm'
import { auth } from './auth'

// Re-export client-safe utilities
export { isOwner, canManageBusiness } from '@kasero/shared/business-role'
import type { BusinessRole } from '@kasero/shared/business-role'
export type { BusinessRole }

export interface BusinessAccess {
  userId: string
  businessId: string
  businessName: string
  businessIcon: string | null
  businessLocale: string
  businessCurrency: string
  role: BusinessRole
}

// ============================================
// ACCESS CACHE (in-memory, per function instance)
// ============================================

const CACHE_TTL_MS = 60_000 // 60 seconds

interface CachedAccess {
  access: BusinessAccess
  expiresAt: number
}

// Key format: "userId:businessId"
const accessCache = new Map<string, CachedAccess>()

function getCacheKey(userId: string, businessId: string): string {
  return `${userId}:${businessId}`
}

/**
 * Invalidate cached access for a user in a specific business.
 * Call after role changes, membership removal, etc.
 */
export function invalidateAccessCache(userId: string, businessId: string): void {
  accessCache.delete(getCacheKey(userId, businessId))
}

/**
 * Invalidate every access-cache entry for the given businessId, across all
 * users. Call this after a mutation on the `businesses` row so other members'
 * next `/access` request re-fetches.
 */
export function invalidateAccessCacheForBusiness(businessId: string): void {
  const suffix = `:${businessId}`
  for (const key of accessCache.keys()) {
    if (key.endsWith(suffix)) {
      accessCache.delete(key)
    }
  }
}

/**
 * Invalidate every access-cache entry owned by the given user, across all
 * businesses. Call this when the user itself is being deleted or logged out
 * of every business in one operation.
 */
export function invalidateAccessCacheForUser(userId: string): void {
  const prefix = `${userId}:`
  for (const key of accessCache.keys()) {
    if (key.startsWith(prefix)) {
      accessCache.delete(key)
    }
  }
}

// ============================================
// REALTIME ACCESS CACHE (SSE-only)
// ============================================

const RT_CACHE_TTL_MS = 30_000

interface RealtimeGrant {
  granted: boolean
  expiresAt: number
}
const realtimeGrantCache = new Map<string, RealtimeGrant>()

/**
 * Lightweight per-instance access check used by the SSE route.
 * Mirrors requireBusinessAccess semantics (status=active, membership
 * row exists) but returns a boolean and caches for 30 seconds. The
 * SSE route reconnects multiple times per session and we don't want
 * the membership SELECT on every reconnect.
 */
export async function requireBusinessAccessForRealtime(
  userId: string,
  businessId: string,
): Promise<boolean> {
  const key = `${userId}:${businessId}`
  const cached = realtimeGrantCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.granted
  const row = await db
    .select({ id: businessUsers.id })
    .from(businessUsers)
    .where(
      and(
        eq(businessUsers.userId, userId),
        eq(businessUsers.businessId, businessId),
        eq(businessUsers.status, 'active'),
      ),
    )
    .get()
  const granted = row != null
  realtimeGrantCache.set(key, { granted, expiresAt: Date.now() + RT_CACHE_TTL_MS })
  return granted
}

/**
 * Require business access - throws if not authenticated or no access.
 * Uses a short-lived in-memory cache to avoid repeated DB queries.
 */
export async function requireBusinessAccess(
  businessId: string
): Promise<BusinessAccess> {
  const reqHeaders = await headers()
  const session = await auth.api.getSession({ headers: reqHeaders })
  if (!session) {
    throw new Error('Unauthorized: Not authenticated')
  }
  if (!session.user.emailVerified) {
    throw new Error('Unauthorized: Email not verified')
  }
  const userId = session.user.id

  // Check cache
  const cacheKey = getCacheKey(userId, businessId)
  const cached = accessCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.access
  }

  // Cache miss or expired — query DB
  const membership = await db
    .select({
      businessId: businessUsers.businessId,
      role: businessUsers.role,
      status: businessUsers.status,
      businessName: businesses.name,
      businessIcon: businesses.icon,
      businessLocale: businesses.locale,
      businessCurrency: businesses.currency,
    })
    .from(businessUsers)
    .innerJoin(businesses, eq(businessUsers.businessId, businesses.id))
    .where(
      and(
        eq(businessUsers.userId, userId),
        eq(businessUsers.businessId, businessId),
        eq(businessUsers.status, 'active')
      )
    )
    .get()

  if (!membership) {
    // Clear any stale cache entry
    accessCache.delete(cacheKey)
    throw new Error('Unauthorized: No access to this business')
  }

  const access: BusinessAccess = {
    userId,
    businessId: membership.businessId,
    businessName: membership.businessName,
    businessIcon: membership.businessIcon,
    businessLocale: membership.businessLocale ?? 'en-US',
    businessCurrency: membership.businessCurrency ?? 'USD',
    role: membership.role as BusinessRole,
  }

  // Cache the result
  accessCache.set(cacheKey, {
    access,
    expiresAt: Date.now() + CACHE_TTL_MS,
  })

  return access
}

// ============================================
// CROSS-TENANT FK ASSERTIONS
// ============================================

/**
 * Confirm every product ID belongs to the given business.
 *
 * The business-auth wrapper pins the URL businessId, but FK references in
 * request bodies need a separate check. Without this, a manager in
 * business A could reference a product in business B, leaking
 * name/price/stock data.
 *
 * Returns true only if EVERY id in `productIds` exists AND has the given
 * businessId. Empty input is vacuously true. Duplicates in `productIds`
 * are tolerated (the row-set check uses the unique IDs).
 */
export async function assertProductsInBusiness(
  productIds: string[],
  businessId: string,
): Promise<boolean> {
  if (productIds.length === 0) return true
  const uniqueIds = [...new Set(productIds)]
  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.businessId, businessId), inArray(products.id, uniqueIds)))
  if (rows.length !== uniqueIds.length) return false
  const found = new Set(rows.map((r) => r.id))
  return uniqueIds.every((id) => found.has(id))
}

/**
 * Confirm a category ID belongs to the given business. Empty/null IDs
 * are caller's responsibility to filter out before invoking.
 */
export async function assertCategoryInBusiness(
  categoryId: string,
  businessId: string,
): Promise<boolean> {
  const row = await db
    .select({ id: productCategories.id })
    .from(productCategories)
    .where(and(eq(productCategories.id, categoryId), eq(productCategories.businessId, businessId)))
    .get()
  return row != null
}

/**
 * Confirm an expense category ID belongs to the given business.
 */
export async function assertExpenseCategoryInBusiness(
  categoryId: string,
  businessId: string,
): Promise<boolean> {
  const row = await db
    .select({ id: expenseCategories.id })
    .from(expenseCategories)
    .where(and(eq(expenseCategories.id, categoryId), eq(expenseCategories.businessId, businessId)))
    .get()
  return row != null
}

/**
 * Confirm an expense ID belongs to the given business.
 */
export async function assertExpenseInBusiness(
  expenseId: string,
  businessId: string,
): Promise<boolean> {
  const row = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.businessId, businessId)))
    .get()
  return row != null
}
