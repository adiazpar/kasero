# Capacitor Native (iOS + Android)

Kasero ships as a Capacitor 8 native app (`apps/web/ios/`, `apps/web/android/`) wrapping the **bundled** SPA (`webDir: dist` — never a remote `server.url`; that is an App Store Guideline 4.2 rejection vector). The web/PWA deployment is completely unaffected: every native behavior is gated on `Capacitor.isNativePlatform()`, and with `VITE_API_ORIGIN` unset the web build's request paths, auth flow, and service-worker registration are byte-identical to before.

- `appId`: `com.kasero.app` (no `APPLE_APP_BUNDLE_IDENTIFIER` existed in `apps/api/.env.local` at scaffold time; if one is ever provisioned for native Sign in with Apple, it must match this value).
- Config: `apps/web/capacitor.config.ts` (SplashScreen `#F6EFDF` brand background, Keyboard `resize: 'native'`).
- Scripts (apps/web): `cap:sync` (build + `cap sync`), `cap:ios` / `cap:android` (open IDE).

## Environment variables (native builds only)

| Var | Meaning |
|---|---|
| `VITE_API_ORIGIN` | Absolute origin of the deployed API (e.g. `https://kasero.app`). Empty/unset on every web build — `apiUrl()` in `apps/web/src/lib/api-origin.ts` is the identity function then. |
| `VITE_PUBLIC_WEB_ORIGIN` | Canonical web origin embedded in shareable URLs (invite QR codes) when inside the native WebView, where `window.location.origin` is `capacitor://kasero.localhost`. Ignored on web. |

`apps/web/src/lib/api-origin.ts` is the single helper: `API_ORIGIN`, `apiUrl(path)`, `publicWebOrigin()`. It is threaded through `api-client.ts`, `fetch.ts` (`fetchDeduped`), `auth-client.ts` (`baseURL`), the `EventSource` URL in `realtime-context.tsx`, and `qr.ts`.

## Native auth: bearer tokens

The WebView origin (`capacitor://kasero.localhost` on iOS, `https://kasero.localhost` on Android — see the CORS/CSRF section for why the hostname is distinctive) is cross-origin to the API, so cookies are unreliable. Native uses better-auth's **bearer plugin** (`bearer()` in `apps/api/src/lib/auth.ts`):

- Token capture: any response that sets the session cookie carries a `set-auth-token` header. `auth-client.ts`'s global `fetchOptions.onSuccess` stores it via `apps/web/src/lib/native/auth-token.ts` (`@capacitor/preferences` + in-memory mirror). On web this is inert (header never sent; `setBearerToken` no-ops).
- Token attach: `fetchOptions.auth` on the auth client, plus explicit `Authorization: Bearer` injection in `api-client.ts` and `fetch.ts`. `getBearerToken()` is **always null on web**, and better-fetch skips the header for a falsy token, so web requests are unchanged.
- Boot: `main.tsx` awaits `initNativeApp()` (`lib/native/bootstrap.ts`) before rendering, so the persisted token is hydrated before the first `useSession` fetch.
- Logout (`auth-context.tsx`) clears the token (and any lingering PKCE verifier) alongside the cookie.
- SSE: `EventSource` cannot set headers. The native connection does **not** put the raw session token in the URL (that leaks into infra request logs). Instead the client mints a short-lived single-use **ticket** and opens `/api/realtime?ticket=...`. See "Native realtime: SSE connect tickets" below.

### Native OAuth (Google / Apple) — PKCE-hardened

Apple and Google reject WebView OAuth, so the round-trip runs in the system browser. The custom `kasero://` scheme can be intercepted by any app that registers it, and the mint GET is reachable by a cross-site top-level navigation (SameSite=Lax cookies attach, and a GET skips `enforceSameOrigin`). We defend both holes with a **PKCE** binding (`apps/web/src/lib/native/pkce.ts` client, `apps/api/src/lib/native-token-store.ts` server):

1. `OAuthButtons.tsx` (native branch): generates a random `code_verifier` (Web Crypto, kept in memory + `@capacitor/preferences`), derives `code_challenge = base64url(SHA-256(verifier))`, and calls `authClient.signIn.social({ provider, callbackURL: apiUrl('/api/native/auth-callback?challenge=<challenge>'), disableRedirect: true })`. The provider URL opens in `@capacitor/browser`; the challenge round-trips through the OAuth flow via the callbackURL query.
2. OAuth completes in the system browser; better-auth sets the session cookie **there** and redirects to `GET /api/native/auth-callback`. That route **requires** the challenge (missing/malformed → **400**, so a blind cross-site navigation cannot mint a redeemable token), then — cookie-authenticated — mints a **one-time token** (`oneTimeToken()` plugin), **binds the challenge to the ott** in the token store (180s TTL, single-use), and 302s to `kasero://auth-callback?ott=...`. Errors redirect with `?error=` instead (this endpoint is a browser navigation, not a JSON API, hence no envelope; the 400 guard is a bare status, deliberately not bounced into the app).
3. The app's `appUrlOpen` listener (`lib/native/bootstrap.ts`) reads back its stored `code_verifier` and redeems the ott at **`POST /api/native/auth-callback/verify`** with `{ token, verifier }`. That wrapper consumes (single-use) the challenge bound to the ott and rejects (401) unless `SHA-256(verifier)` matches — an app that intercepted the deep link has the ott but **not** the verifier, so it cannot redeem. On match it calls `auth.api.verifyOneTimeToken({ returnHeaders: true })`, forwards the resulting `set-auth-token` header (exposed via CORS `Access-Control-Expose-Headers`), and the client persists it, closes the browser sheet, and dispatches `kasero:native-auth`.

**Strategic follow-up:** Universal Links / App Links (verified domain association) removes custom-scheme interception entirely and is the right long-term fix. PKCE is the defense-in-depth shipping now (works without the domain-association setup).

Email-OTP sign-in needs no special flow: the verify response carries `set-auth-token` and the global `onSuccess` captures it.

## Native realtime: SSE connect tickets

`EventSource` cannot set an `Authorization` header. The native client therefore:

1. POSTs `/api/realtime/ticket` (bearer header auto-attached by `api-client`; `withAuth`-wrapped, so it works for cookie *or* bearer sessions and enforces the same-origin + rate-limit guards). The route mints a random 30s **single-use** ticket bound to the caller's userId via `mintSseTicket` (token store) and returns it in an envelope.
2. Opens `EventSource('/api/realtime?ticket=...')`. The realtime GET consumes (get+delete) the ticket via `consumeSseTicket`, resolving the userId. A raw session token in `?token=` is **no longer accepted**.

Because the ticket is single-use, `openConnection` in `realtime-context.tsx` mints a fresh ticket on each (re)open; a generation counter aborts a slow in-flight ticket fetch if a teardown/new-open superseded it. Web is unchanged — no ticket, cookie-authenticated SSE, byte-identical URL.

## CORS / CSRF: exact two-origin allowlist

The native WebView origins live in a single source of truth — **`apps/api/src/lib/native-origins.ts`** (`NATIVE_APP_ORIGINS` + `isNativeAppOrigin`), imported by all four consumers below. The exact strings are `capacitor://kasero.localhost` (iOS) and `https://kasero.localhost` (Android) — **never widen to a wildcard or reflect arbitrary origins**; browser same-origin enforcement is untouched:

- `apps/api/src/proxy.ts`: matcher includes `/api/:path*`; answers `OPTIONS` preflights (204, allow-methods/headers, 24h max-age) and decorates real responses (`Access-Control-Allow-Origin` echo of the matched allowlist entry, `Allow-Credentials`, `Expose-Headers: set-auth-token, Retry-After`, `Vary: Origin`) **only** when the Origin header is a native origin. All other /api traffic passes through untouched.
- `apps/api/src/lib/api-middleware.ts` `enforceSameOrigin`: accepts the native origins (exact match; `startsWith(origin + '/')` for Referer). Not a cookie-CSRF vector — native requests authenticate via bearer header, which a cross-site browser page cannot attach.
- `apps/api/src/app/api/realtime/route.ts` `isSameOrigin`: same carve-out for the SSE GET.
- `apps/api/src/lib/auth.ts` `trustedOrigins`: spreads `NATIVE_APP_ORIGINS` so better-auth's own origin check accepts native sign-in POSTs.

### Why `kasero.localhost` (not the default `localhost`)

Capacitor's default Android origin is the generic `https://localhost`, which is shared by *any* local HTTPS dev server — a page served from `https://localhost` would sail through the CSRF origin check and (via the proxy) receive `Access-Control-Allow-Credentials`. Setting `server.hostname: 'kasero.localhost'` in `apps/web/capacitor.config.ts` shrinks the trust boundary to an app-specific host no ordinary local server occupies. Capacitor's `hostname` is **global (not per-platform)**, so it applies to both platforms: iOS becomes `capacitor://kasero.localhost` (the `capacitor:` scheme was already app-only; now the host is distinctive too) and Android `https://kasero.localhost`. `*.localhost` is still a loopback name, so secure-context Web APIs (getUserMedia for the barcode camera) keep working. **Changing the hostname requires `npx cap sync`** (already run — the value is baked into `ios/App/App/capacitor.config.json` and `android/app/src/main/assets/capacitor.config.json`) and, for an existing device build, a native rebuild. Keep `capacitor.config.ts` and `native-origins.ts` in sync — a mismatch 403s every native request.

### Token store (PKCE bindings + SSE tickets)

`apps/api/src/lib/native-token-store.ts` is the short-lived single-use store behind both the PKCE `ott → challenge` binding and the SSE `ticket → userId` binding. It uses the **Upstash REST** client (`UPSTASH_REDIS_REST_URL` / `_TOKEN` — the same creds as `rate-limit.ts` and better-auth's `secondaryStorage`), with atomic `GETDEL` for single-use consumption, and an in-memory `Map` fallback for local dev. We deliberately did NOT reuse the realtime ioredis client (`UPSTASH_REDIS_URL`): its wrapper only exposes pub/sub + XADD, and single-use tokens need atomic get-and-delete. In Vercel production the REST creds are guaranteed present (rate-limit.ts throws at load without them), so the in-memory fallback is a dev-only path. Tokens, tickets, and verifiers are never logged.

## Deep links

Scheme `kasero://` is registered in `ios/App/App/Info.plist` (`CFBundleURLTypes`) and `android/app/src/main/AndroidManifest.xml` (VIEW/BROWSABLE intent-filter). `lib/native/bootstrap.ts` handles:

- `kasero://auth-callback?ott=...|error=...` — OAuth completion (above).
- `kasero://invite?code=X` (or a universal link `https://<web-origin>/invite?code=X`, once associated domains are configured) — dispatches `kasero:invite-code`; `join-business-context.tsx` funnels it into the same handler as the web `?code=` flow. Cold-start links are stashed in sessionStorage (`kasero.pending_invite_code`) and consumed on provider mount. Note: the provider only mounts in the hub context; a link opened while deep inside a business tab is handled next time the hub mounts.

## Native plugins

- `@capacitor/status-bar`: `syncNativeStatusBar()` (`lib/native/status-bar.ts`) called from `useTheme`'s `applyTheme` and the system-scheme listener; dynamic import, no-op on web.
- `@capacitor/splash-screen`: config-only (auto-hide, brand background).
- `@capacitor/keyboard`: `resize: 'native'` resizes the WebView viewport, which is what the existing visualViewport-sensitive modal behavior expects. `modal-shell.tsx` has no JS visualViewport handler (only the `noSwipeDismiss` workaround for Ionic's sheet-gesture bug), so there is no double-handling; if native keyboard testing shows sheet snapping, revisit `Keyboard.resize` before touching modal-shell.
- `@capacitor/haptics`: added because `lib/haptics.ts` relies on `navigator.vibrate`, which iOS WKWebView does not implement (the checkbox-switch fallback is Safari-only). `haptic()` routes to `Haptics.impact` on native; web path unchanged.
- `@capacitor/preferences`, `@capacitor/browser`, `@capacitor/app`: auth/deep-link plumbing above.

## iOS specifics

- `NSCameraUsageDescription` in Info.plist (barcode scanning via getUserMedia + photo capture via `<input type="file" capture>`), localized in `ios/App/App/<locale>.lproj/InfoPlist.strings` for all 11 locales (`zh` ships as `zh-Hans.lproj`), wired into the pbxproj as a variant group with matching `knownRegions` + `CFBundleAllowMixedLocalizations`.
- `NSPhotoLibraryUsageDescription` is intentionally **absent**: the photo path uses `<input type="file">`, which iOS serves through the out-of-process PHPicker — no photo-library permission is required (per Apple/Capacitor guidance). Add it only if a direct photo-library API is ever adopted.
- Android: `CAMERA` permission added to the manifest for WebView getUserMedia; plugin permissions merge automatically.

## CSP

No change to `apps/api/next.config.js`: the CSP header governs documents served from the API origin; the native WebView loads the bundled `capacitor://kasero.localhost` document, which never receives that header. Verified — do not widen `connect-src` for the native app.

## Build / release workflow

```
cd apps/web
npm run cap:sync            # builds SPA (set VITE_API_ORIGIN + VITE_PUBLIC_WEB_ORIGIN first!) and syncs both platforms
npm run cap:ios             # open Xcode
npm run cap:android         # open Android Studio
```

For a native build, create e.g. `apps/web/.env.capacitor.local` or export the two `VITE_*` vars in the shell before `cap:sync`; never set them for web deploys.

### Remaining manual steps (not automatable from this repo)

1. **Install Xcode 26+** (this machine has only Command Line Tools; `xcodebuild` unavailable). Capacitor 8 uses Swift Package Manager — no CocoaPods needed. Open `apps/web/ios/App/App.xcodeproj`, set the signing team, confirm the `InfoPlist.strings` variant group resolved (App target -> Build Phases -> Copy Bundle Resources), and archive with the iOS 26 SDK (App Store requirement since April 2026).
2. **Android Studio**: open `apps/web/android/`, let Gradle sync (API 36 toolchain), configure the release keystore, and build an AAB.
3. **App icons / splash images**: the scaffolds ship Capacitor placeholder assets; generate branded ones (e.g. `@capacitor/assets`) before submission.
4. **Sign in with Apple (native)**: if the review flow requires the native entitlement, provision `com.kasero.app` with the Sign in with Apple capability and set `APPLE_APP_BUNDLE_IDENTIFIER=com.kasero.app` in the API env (Bitwarden note) so better-auth accepts the bundle audience.
5. **Universal links / App Links (recommended follow-up)**: to make `https://<web-origin>/invite?code=X` open the app directly, add Associated Domains (iOS) / `assetlinks.json` + `autoVerify` intent-filter (Android). Beyond invites, verified domain association is the strategic fix that removes custom-scheme (`kasero://`) interception from the OAuth callback entirely — at which point the PKCE binding (shipped now as defense-in-depth) becomes belt-and-suspenders rather than the sole guard. The custom `kasero://` scheme works without this.
6. **Vercel env**: none required — native auth uses existing better-auth routes; `VITE_*` vars are build-time only.
