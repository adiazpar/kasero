/**
 * Native (Capacitor) app bootstrap. Loaded from main.tsx behind a
 * Capacitor.isNativePlatform() gate — none of this module executes on web.
 *
 * Responsibilities:
 *   1. Hydrate the persisted bearer token before the first session fetch.
 *   2. Register the appUrlOpen deep-link listener:
 *      - kasero://auth-callback?ott=...  -> complete native OAuth sign-in
 *      - kasero://invite?code=... or https://<web-origin>/invite?code=...
 *        -> forward the invite code to join-business-context.
 *   3. Sync the native status bar with the current theme on launch.
 */

import { App as CapacitorApp, type URLOpenListenerEvent } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { apiUrl } from '../api-origin'
import { getDeviceId } from '../realtime/device-id'
import { hydrateBearerToken, setBearerToken } from './auth-token'
import { takeCodeVerifier } from './pkce'
import { syncNativeStatusBar } from './status-bar'
import {
  NATIVE_AUTH_EVENT,
  NATIVE_INVITE_EVENT,
  PENDING_INVITE_CODE_KEY,
  type NativeAuthEventDetail,
  type NativeInviteEventDetail,
} from './events'

function dispatchAuthEvent(success: boolean): void {
  window.dispatchEvent(
    new CustomEvent<NativeAuthEventDetail>(NATIVE_AUTH_EVENT, {
      detail: { success },
    }),
  )
}

/**
 * Exchange the one-time token minted by /api/native/auth-callback for a
 * bearer session token, proving possession of the PKCE code_verifier.
 *
 * We redeem via /api/native/auth-callback/verify (NOT better-auth's raw
 * one-time-token/verify): that wrapper rejects unless SHA-256(verifier)
 * matches the challenge bound to the ott at mint time, so an app that
 * intercepted the deep link — which has the ott but not the verifier —
 * cannot complete sign-in. The response carries the bearer session token
 * in the `set-auth-token` header (bearer plugin), exposed to us via
 * Access-Control-Expose-Headers. The ott, verifier, and token are never
 * logged.
 */
async function completeOAuthCallback(ott: string): Promise<void> {
  try {
    const verifier = await takeCodeVerifier()
    if (!verifier) {
      // No verifier stored for this round trip — either a stale/duplicate
      // deep link or an intercepted ott we never initiated. Refuse.
      dispatchAuthEvent(false)
      return
    }
    const response = await fetch(apiUrl('/api/native/auth-callback/verify'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-device-id': getDeviceId(),
      },
      body: JSON.stringify({ token: ott, verifier }),
    })
    const sessionToken = response.headers.get('set-auth-token')
    if (!response.ok || !sessionToken) {
      dispatchAuthEvent(false)
      return
    }
    await setBearerToken(sessionToken)
    dispatchAuthEvent(true)
  } catch {
    dispatchAuthEvent(false)
  } finally {
    // Close the in-app system browser that hosted the OAuth round-trip.
    try {
      await Browser.close()
    } catch {
      // Already closed (Android closes it automatically on app resume).
    }
  }
}

function handleDeepLink(url: URL): void {
  // OAuth completion: kasero://auth-callback?ott=<one-time-token>
  // (URL host for custom schemes is "auth-callback".)
  const target = url.hostname || url.pathname.replace(/^\/+/, '')
  if (target === 'auth-callback' || url.pathname.includes('auth-callback')) {
    const ott = url.searchParams.get('ott')
    if (ott) {
      void completeOAuthCallback(ott)
    } else {
      dispatchAuthEvent(false)
    }
    return
  }

  // Invite deep link: kasero://invite?code=X or a universal link
  // https://<web-origin>/invite?code=X.
  const code = url.searchParams.get('code')
  if (code && (target === 'invite' || url.pathname.includes('invite'))) {
    // Stash for the cold-start case (deep link delivered before the React
    // tree mounted its listener); join-business-context consumes it on
    // mount and the warm-path listener clears it when it handles the event.
    try {
      sessionStorage.setItem(PENDING_INVITE_CODE_KEY, code)
    } catch {
      // Storage error — the event below still covers the warm path.
    }
    window.dispatchEvent(
      new CustomEvent<NativeInviteEventDetail>(NATIVE_INVITE_EVENT, {
        detail: { code },
      }),
    )
  }
}

/**
 * One-time native initialization. Called (and awaited) from main.tsx
 * BEFORE the React root renders, so the persisted bearer token is
 * readable by the time authClient.useSession issues its first request.
 * Native only — main.tsx gates the import on Capacitor.isNativePlatform().
 */
export async function initNativeApp(): Promise<void> {
  await hydrateBearerToken()

  void CapacitorApp.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
    try {
      handleDeepLink(new URL(event.url))
    } catch {
      // Malformed URL — ignore.
    }
  })

  // Initial status-bar style from the resolved theme (the .dark class is
  // set by the inline theme-init script in index.html before React mounts).
  const isDark = document.documentElement.classList.contains('dark')
  void syncNativeStatusBar(isDark ? 'dark' : 'light')
}
