/**
 * API origin resolution.
 *
 * The web SPA is same-origin with the API (Vite proxies /api/* in dev; the
 * built SPA is served by the API deployment in prod), so every fetch uses
 * relative paths. The Capacitor-native app bundles the SPA inside the
 * WebView (origin `capacitor://kasero.localhost` on iOS, `https://kasero.localhost`
 * on Android), so API calls must target the deployed API origin explicitly.
 *
 * VITE_API_ORIGIN (e.g. "https://kasero.app") is set only for native
 * builds. When unset — every web build — API_ORIGIN is the empty string
 * and apiUrl() returns its input unchanged, keeping web behavior
 * byte-identical.
 */

import { Capacitor } from '@capacitor/core'

/** Absolute API origin for native builds; empty string on web. */
export const API_ORIGIN: string =
  (import.meta.env.VITE_API_ORIGIN as string | undefined) ?? ''

/**
 * Resolve an API path against the configured API origin.
 *
 * - Web (API_ORIGIN unset): identity — returns `path` untouched.
 * - Native: prefixes relative paths with API_ORIGIN. Absolute URLs pass
 *   through unchanged.
 */
export function apiUrl(path: string): string {
  if (!API_ORIGIN) return path
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  return `${API_ORIGIN}${path}`
}

/**
 * Origin to embed in shareable URLs (invite QR codes, links). On the web
 * this is the current origin. Inside the native WebView,
 * window.location.origin is `capacitor://kasero.localhost` — useless in a shared
 * link — so VITE_PUBLIC_WEB_ORIGIN (the canonical web deployment origin)
 * is used instead, falling back to API_ORIGIN which serves the SPA too.
 */
export function publicWebOrigin(): string {
  if (Capacitor.isNativePlatform()) {
    const configured =
      (import.meta.env.VITE_PUBLIC_WEB_ORIGIN as string | undefined) ?? ''
    return configured || API_ORIGIN || window.location.origin
  }
  return window.location.origin
}
