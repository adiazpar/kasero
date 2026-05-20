/**
 * Refetch registry — coordinates cache invalidation between the realtime
 * event handler and the SWR hooks that own data fetching.
 *
 * Each hook registers a refetch callback under a named key. When a
 * realtime event arrives, the handler calls callRefetch(key) or
 * callAllRefetches() and every registered callback fires.
 */

export type RefetchKey =
  | 'team'
  | 'invites'
  | 'business'
  | 'businesses-list'
  | 'profile'
  | 'products'
  | 'product-settings'
  | 'categories'

type Listener = () => Promise<void> | void

const listeners = new Map<RefetchKey, Set<Listener>>()

// Leading-edge debounce: tracks per-key cooldown. When a key is present,
// calls are suppressed until the timer fires and removes the key.
const cooldown = new Map<RefetchKey, ReturnType<typeof setTimeout>>()

const DEBOUNCE_MS = 100

/**
 * Register a refetch callback for a given key. Multiple registrations
 * under the same key are all invoked. Returns an unregister function.
 */
export function registerRefetch(key: RefetchKey, fn: Listener): () => void {
  let set = listeners.get(key)
  if (!set) {
    set = new Set()
    listeners.set(key, set)
  }
  set.add(fn)
  return () => {
    const s = listeners.get(key)
    if (!s) return
    s.delete(fn)
    if (s.size === 0) listeners.delete(key)
  }
}

/**
 * Invoke every listener registered under `key`. Leading-edge debounced
 * at 100ms: the first call fires immediately, subsequent calls within
 * the 100ms cooldown window are dropped.
 */
export function callRefetch(key: RefetchKey): void {
  if (cooldown.has(key)) return

  // Fire immediately (leading edge).
  const set = listeners.get(key)
  if (set) {
    for (const fn of set) {
      Promise.resolve(fn()).catch((err) => {
        console.warn('[realtime] refetch listener threw for', key, err)
      })
    }
  }

  // Start cooldown to suppress calls for the next DEBOUNCE_MS.
  const timer = setTimeout(() => {
    cooldown.delete(key)
  }, DEBOUNCE_MS)
  cooldown.set(key, timer)
}

/**
 * Invoke every registered refetch across every key. Used on
 * system.resync — not debounced so the full resync always goes through.
 */
export function callAllRefetches(): void {
  for (const key of listeners.keys()) {
    callRefetch(key)
  }
}
