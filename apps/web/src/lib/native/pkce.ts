/**
 * PKCE helpers for native (Capacitor) OAuth.
 *
 * The native OAuth round-trip hands a one-time token back to the app via a
 * custom-scheme deep link (`kasero://auth-callback?ott=...`) that any app
 * registering the scheme can intercept. To make an intercepted ott
 * useless, the app binds it to a secret it never puts on the wire:
 *
 *   1. generate a random `code_verifier` (kept in memory + Preferences),
 *   2. derive `code_challenge = base64url(SHA-256(verifier))` and send
 *      ONLY the challenge through the OAuth initiation (round-tripped to
 *      /api/native/auth-callback via the callbackURL query),
 *   3. on `appUrlOpen`, redeem the ott WITH the verifier — the server
 *      rejects unless SHA-256(verifier) matches the stored challenge.
 *
 * Uses Web Crypto (present in every WebView). The verifier is a secret —
 * never log it. Every persisted read/write is guarded on native so the web
 * bundle stays inert (this module is imported by OAuthButtons on web too,
 * but its functions only run inside the native OAuth branch).
 */

import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

const STORAGE_KEY = 'kasero.pkce_verifier'

// In-memory mirror so the warm-path deep-link handler can read the
// verifier synchronously even if Preferences is slow/unavailable.
let cachedVerifier: string | null = null

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Cryptographically random `code_verifier` (32 bytes, base64url). */
export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return toBase64Url(bytes)
}

/** `code_challenge = base64url(SHA-256(verifier))`. */
export async function deriveCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  )
  return toBase64Url(new Uint8Array(digest))
}

/** Persist the verifier for the OAuth round trip (memory + Preferences). */
export async function storeCodeVerifier(verifier: string): Promise<void> {
  cachedVerifier = verifier
  if (!Capacitor.isNativePlatform()) return
  try {
    await Preferences.set({ key: STORAGE_KEY, value: verifier })
  } catch {
    // Preferences unavailable — the in-memory mirror still covers the
    // common (WebView-kept-alive) case for this app session.
  }
}

/**
 * Read and clear the verifier (single-use). Prefers the in-memory mirror,
 * falls back to Preferences (cold-resume case where the WebView was
 * reloaded while the system browser held focus).
 */
export async function takeCodeVerifier(): Promise<string | null> {
  let verifier = cachedVerifier
  cachedVerifier = null
  if (!verifier && Capacitor.isNativePlatform()) {
    try {
      const { value } = await Preferences.get({ key: STORAGE_KEY })
      verifier = value ?? null
    } catch {
      verifier = null
    }
  }
  await clearCodeVerifier()
  return verifier
}

/** Drop any persisted verifier (logout / abandoned flow hygiene). */
export async function clearCodeVerifier(): Promise<void> {
  cachedVerifier = null
  if (!Capacitor.isNativePlatform()) return
  try {
    await Preferences.remove({ key: STORAGE_KEY })
  } catch {
    // ignore — memory already cleared.
  }
}
