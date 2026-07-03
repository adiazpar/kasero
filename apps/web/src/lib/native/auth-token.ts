/**
 * Bearer session token storage for the native (Capacitor) app.
 *
 * The native WebView origin (capacitor://kasero.localhost / https://kasero.localhost)
 * is cross-origin to the API, so cookie-based sessions are unreliable there.
 * Native builds authenticate with better-auth's bearer plugin instead: the
 * session token is captured from the `set-auth-token` response header,
 * persisted with @capacitor/preferences, and attached as
 * `Authorization: Bearer <token>` to every API request.
 *
 * Every function is a no-op on the web platform — the web keeps its
 * cookie flow untouched and getBearerToken() always returns null there.
 */

import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

const STORAGE_KEY = 'kasero.bearer_token'

// In-memory mirror so request paths can read the token synchronously.
// Hydrated from Preferences at app boot (see lib/native/bootstrap.ts).
let cachedToken: string | null = null

/**
 * Current bearer token, or null. Always null on web.
 * Synchronous — reads the in-memory mirror, not Preferences.
 */
export function getBearerToken(): string | null {
  if (!Capacitor.isNativePlatform()) return null
  return cachedToken
}

/** Persist a new bearer token (memory + Preferences). No-op on web. */
export async function setBearerToken(token: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  cachedToken = token
  try {
    await Preferences.set({ key: STORAGE_KEY, value: token })
  } catch {
    // Preferences unavailable — the in-memory token still covers this
    // app session; the user re-authenticates on next cold start.
  }
}

/** Drop the persisted token (logout). No-op on web. */
export async function clearBearerToken(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  cachedToken = null
  try {
    await Preferences.remove({ key: STORAGE_KEY })
  } catch {
    // ignore — memory already cleared.
  }
}

/**
 * Load the persisted token into the in-memory mirror. Called once at
 * native app boot, before the first session fetch. No-op on web.
 */
export async function hydrateBearerToken(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { value } = await Preferences.get({ key: STORAGE_KEY })
    cachedToken = value ?? null
  } catch {
    cachedToken = null
  }
}
