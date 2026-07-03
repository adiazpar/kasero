/**
 * Window event names used by the native (Capacitor) bootstrap layer to
 * signal the React tree. Kept in a dependency-free module so React code
 * (auth-context, join-business-context, OAuthButtons) can subscribe
 * without pulling any Capacitor plugin into the web bundle graph.
 *
 * These events only ever fire on the native platform (they are dispatched
 * exclusively from lib/native/bootstrap.ts, which is loaded behind a
 * Capacitor.isNativePlatform() gate) — listeners are inert on web.
 */

/**
 * Fired after the native OAuth deep-link callback completes (successfully
 * or not). detail: { success: boolean }. On success the bearer token has
 * already been persisted; subscribers should refetch the session.
 */
export const NATIVE_AUTH_EVENT = 'kasero:native-auth'

/**
 * Fired when the app is opened via an invite deep link
 * (kasero://invite?code=X or https://<web-origin>/invite?code=X).
 * detail: { code: string }.
 */
export const NATIVE_INVITE_EVENT = 'kasero:invite-code'

export interface NativeAuthEventDetail {
  success: boolean
}

export interface NativeInviteEventDetail {
  code: string
}

/**
 * sessionStorage key holding an invite code from a cold-start deep link.
 * Written by lib/native/bootstrap.ts when the deep link arrives before the
 * React tree (and its NATIVE_INVITE_EVENT listener) has mounted; consumed
 * once by join-business-context on mount.
 */
export const PENDING_INVITE_CODE_KEY = 'kasero.pending_invite_code'
