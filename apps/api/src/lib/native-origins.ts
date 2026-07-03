/**
 * Single source of truth for the Capacitor-native app's WebView origins.
 *
 * The native app loads the bundled SPA from a WebView whose origin is
 * cross-origin to the API. Those origins are an explicit, exact-match
 * allowlist consumed by every layer that must accept native traffic:
 *   - api-middleware.ts  (`enforceSameOrigin` CSRF check)
 *   - proxy.ts           (CORS preflight + response decoration)
 *   - realtime/route.ts  (SSE same-origin check)
 *   - auth.ts            (better-auth `trustedOrigins`)
 *
 * These strings MUST stay a short, exact allowlist — never a wildcard,
 * never a reflected arbitrary origin. Requests from these origins
 * authenticate via the better-auth bearer plugin (Authorization header)
 * or a single-use token, not ambient cookies, so accepting the origin
 * does not create a cookie-CSRF vector.
 *
 * WHY THESE EXACT VALUES (see .claude/docs/capacitor-native.md, FINDING 4):
 *   - iOS   serves the SPA from `capacitor://kasero.localhost`. The
 *     `capacitor:` scheme is app-only (no browser or dev server can
 *     occupy it) and the `kasero.localhost` hostname is app-specific.
 *   - Android serves from `https://kasero.localhost`. We deliberately
 *     moved off the generic `https://localhost` — that origin is shared
 *     by any local HTTPS dev server, which weakened the CSRF/CORS trust
 *     boundary. `kasero.localhost` is a distinctive host no ordinary
 *     local server occupies.
 *
 * Both origins are produced by `server.hostname: 'kasero.localhost'` in
 * `apps/web/capacitor.config.ts`. Changing that hostname REQUIRES a
 * matching edit here (and `npx cap sync`), or native requests will 403.
 */
export const NATIVE_APP_ORIGINS = [
  'capacitor://kasero.localhost',
  'https://kasero.localhost',
] as const

/**
 * True when the given Origin (or Referer) belongs to the native app.
 *
 * Accepts an exact origin match, or an origin-prefixed value so the
 * Referer header (which carries a path, e.g. `https://kasero.localhost/foo`)
 * still resolves. Never matches a bare substring — the boundary is either
 * the whole string or `<origin>/...`.
 */
export function isNativeAppOrigin(originOrReferer: string): boolean {
  return NATIVE_APP_ORIGINS.some(
    (allowed) =>
      originOrReferer === allowed || originOrReferer.startsWith(`${allowed}/`),
  )
}
