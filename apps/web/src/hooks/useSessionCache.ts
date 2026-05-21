/**
 * Creates standalone cache functions for use outside of React components.
 * Useful for initializing state in useState callbacks.
 *
 * @example
 * const { get, set, clear } = createSessionCache<Product[]>('products')
 *
 * const [products, setProducts] = useState<Product[]>(() => get() || [])
 */
export function createSessionCache<T>(key: string) {
  const get = (): T | null => {
    if (typeof window === 'undefined') return null
    try {
      const cached = sessionStorage.getItem(key)
      return cached ? JSON.parse(cached) : null
    } catch {
      return null
    }
  }

  const set = (data: T) => {
    if (typeof window === 'undefined') return
    try {
      sessionStorage.setItem(key, JSON.stringify(data))
    } catch {
      // Storage error, ignore
    }
  }

  const clear = () => {
    if (typeof window === 'undefined') return
    sessionStorage.removeItem(key)
  }

  return { get, set, clear }
}

// Prefix every localStorage entry the app writes so we can wipe just our
// own keys at logout without nuking unrelated entries some other lib or
// browser feature may have stored under the same origin.
const LOCAL_KEY_PREFIX = 'kasero:'

/**
 * localStorage-backed sibling of createSessionCache. Use ONLY for state
 * that needs to survive a PWA cold restart (sessionStorage is cleared
 * when iOS reaps the standalone app). Be deliberate — anything written
 * here outlives the tab and must be cleared on auth transitions.
 */
export function createLocalStorageCache<T>(key: string) {
  const fullKey = `${LOCAL_KEY_PREFIX}${key}`
  const get = (): T | null => {
    if (typeof window === 'undefined') return null
    try {
      const cached = localStorage.getItem(fullKey)
      return cached ? JSON.parse(cached) : null
    } catch {
      return null
    }
  }
  const set = (data: T) => {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(fullKey, JSON.stringify(data))
    } catch {
      // Storage error, ignore
    }
  }
  const clear = () => {
    if (typeof window === 'undefined') return
    try {
      localStorage.removeItem(fullKey)
    } catch {
      // ignore
    }
  }
  return { get, set, clear }
}

// Single source of truth for every cache key the app uses. Keys may live
// in sessionStorage (default) or localStorage — the storage backend is
// chosen at the call site via scopedCache vs scopedLocalCache.
//
// If you add a NEW key anywhere in src/, add it here first and import
// the CACHE_KEYS.* reference — never hardcode a cache-key string at a
// call site.
export const CACHE_KEYS = {
  // Per-business list / map caches (suffixed with `_${businessId}`
  // via scopedCache / scopedLocalCache). Every one of these is cleared
  // together by clearPerBusinessCaches on leave / delete-business /
  // account-delete.
  PRODUCTS: 'products_cache',
  SALES: 'sales_cache',
  SALES_CART: 'sales_cart',
  SALES_SESSIONS: 'sales_sessions_cache',
  CATEGORIES: 'product_categories_cache',
  PRODUCT_SETTINGS: 'product_settings_cache',
  PENDING_TRANSFER: 'pending_transfer',
  SALES_AGGREGATE: 'sales_aggregate_cache',
  EXPENSES: 'expenses_cache',
  EXPENSE_CATEGORIES: 'expense_categories_cache',

  // Cross-business caches. NOT scoped by businessId.
  BUSINESS_SHELL: 'kasero_business_cache',   // Map<businessId, {name, role, ...}> used by PageTransitionContext
  HUB_BUSINESSES: 'kasero_hub_businesses',   // The list rendered on the hub home
} as const

// Per-business sessionStorage keys — wiped together by clearPerBusinessCaches.
const SESSION_PER_BUSINESS_KEYS = [
  CACHE_KEYS.PRODUCTS,
  CACHE_KEYS.SALES,
  CACHE_KEYS.SALES_CART,
  CACHE_KEYS.CATEGORIES,
  CACHE_KEYS.PRODUCT_SETTINGS,
  CACHE_KEYS.PENDING_TRANSFER,
  CACHE_KEYS.SALES_AGGREGATE,
  CACHE_KEYS.EXPENSES,
  CACHE_KEYS.EXPENSE_CATEGORIES,
] as const

// Per-business localStorage keys — same lifecycle as the session caches
// (cleared by clearPerBusinessCaches), but persistent across cold-start
// so the surface that depends on them can render synchronously on the
// first paint after an app relaunch instead of flashing through a
// "fetching" state.
const LOCAL_PER_BUSINESS_KEYS = [
  CACHE_KEYS.SALES_SESSIONS,
] as const

/**
 * Business-scoped sessionStorage cache helper. The products cache (and
 * any other per-business list) must not bleed across businesses in the
 * same session, so we suffix the key with the businessId. Shared so
 * every site that reads/writes/clears the same logical cache agrees on
 * the key.
 */
export function scopedCache<T>(key: string, businessId: string) {
  return createSessionCache<T>(`${key}_${businessId}`)
}

/**
 * Business-scoped localStorage cache helper. Same shape as scopedCache
 * but persistent across PWA cold-starts. Reserved for state that must
 * be available synchronously on the very first render after relaunch
 * (e.g. whether a sales session is open, which determines which layout
 * the sales page paints first).
 */
export function scopedLocalCache<T>(key: string, businessId: string) {
  return createLocalStorageCache<T>(`${key}_${businessId}`)
}

/**
 * Drop every per-business cache entry for one businessId — sessionStorage
 * AND localStorage. Call after a mutation that makes the cached shape
 * stale: leaving the business, deleting the business, deleting the
 * account, or having access revoked.
 */
export function clearPerBusinessCaches(businessId: string): void {
  for (const key of SESSION_PER_BUSINESS_KEYS) {
    scopedCache(key, businessId).clear()
  }
  for (const key of LOCAL_PER_BUSINESS_KEYS) {
    scopedLocalCache(key, businessId).clear()
  }
}

/**
 * Drop the top-level hub businesses list. Call after any mutation that
 * changes a business's metadata (name, icon, locale, currency, type) or
 * changes which businesses the user belongs to (create, delete, leave,
 * accept transfer).
 */
export function clearHubBusinessesCache(): void {
  createSessionCache(CACHE_KEYS.HUB_BUSINESSES).clear()
}

/**
 * Drop every kasero-prefixed localStorage entry. Used at auth
 * transitions (login / register / logout) — the per-tab
 * sessionStorage.clear() that already runs at those sites only flushes
 * the session-scoped caches; this matches that for our localStorage
 * footprint without touching unrelated entries on the origin.
 */
export function clearKaseroLocalStorage(): void {
  if (typeof window === 'undefined') return
  try {
    const toRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(LOCAL_KEY_PREFIX)) toRemove.push(k)
    }
    for (const k of toRemove) localStorage.removeItem(k)
  } catch {
    // ignore
  }
}
