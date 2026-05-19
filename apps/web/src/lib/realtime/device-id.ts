/**
 * Stable per-device identifier persisted in localStorage.
 *
 * Used by the realtime client for echo suppression: the publishing client
 * tags its mutations with this id (via the X-Device-Id header) and ignores
 * any inbound event whose originDeviceId matches.
 *
 * NOT an authentication factor.
 */

const STORAGE_KEY = 'kasero.device-id'

/**
 * Returns a stable per-device id. Generates and persists one via
 * crypto.randomUUID() if none exists. SSR-safe: returns 'ssr' when
 * window is not available.
 */
export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'ssr'

  try {
    const existing = localStorage.getItem(STORAGE_KEY)
    if (existing && existing.length > 0) return existing

    const fresh = crypto.randomUUID()
    localStorage.setItem(STORAGE_KEY, fresh)
    return fresh
  } catch {
    // localStorage unavailable (Safari private mode, etc.): fall back to
    // a per-tab in-memory id. Echo suppression still works within the tab;
    // cross-tab on the same device degrades to multi-device UX, which is
    // acceptable.
    return inMemoryId ?? (inMemoryId = crypto.randomUUID())
  }
}

let inMemoryId: string | undefined
