'use client'

import { useIntl } from 'react-intl'
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  type ReactNode,
} from 'react'
import { useRouter } from '@/lib/next-navigation-shim'
import { authClient } from '@/lib/auth-client'
import type { User } from '@kasero/shared/types'
import type { SupportedLocale } from '@/i18n/config'
import { clearKaseroLocalStorage } from '@/hooks/useSessionCache'
import { LANGUAGE_CHANGE_EVENT, setCachedUser } from '@/lib/user-cache'
import { registerRefetch } from '@/lib/realtime/refetch-registry'

// ============================================
// TYPES
// ============================================

interface OtpSendResult {
  success: boolean
  error?: string
}

interface OtpVerifyResult {
  success: boolean
  isNewUser: boolean
  error?: string
}

interface SetNameResult {
  success: boolean
  error?: string
}

interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  /**
   * Send a 6-digit OTP to the email for combined sign-in/sign-up. The
   * email-otp plugin's `sign-in` mode creates the user record on first
   * successful verify if they don't yet exist, so this single call serves
   * both new and returning users.
   */
  sendOtp: (email: string) => Promise<OtpSendResult>
  /**
   * Verify the OTP and create the session. `isNewUser` is true when the
   * resolved user record has no `name` set yet — the wizard should route
   * those users to the NameStep before dropping them into the hub.
   */
  verifyOtp: (email: string, otp: string) => Promise<OtpVerifyResult>
  /**
   * Persist the name a brand-new user typed in the wizard's final step.
   * Backed by better-auth's `updateUser`.
   */
  setName: (name: string) => Promise<SetNameResult>
  /**
   * Kick off Google OAuth. The email-verified flag on the existing
   * account causes better-auth to auto-link rather than create a
   * duplicate user when the Google email matches.
   */
  linkGoogle: (callbackURL?: string) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
  changeLanguage: (language: SupportedLocale) => Promise<{ success: boolean; error?: string }>
}

// Names of the Serwist caches whose contents are scoped to the current
// user's session. Must match the cacheName entries in src/app/sw.ts.
// Listing them in one place so both caches stay purged on identity
// change. Adding a new per-user cache to sw.ts requires extending this
// list. Security boundary per audit H-2 — do not loosen.
const SCOPED_SW_CACHE_NAMES = ['api-business', 'app-pages'] as const

// Wipe service-worker caches that hold per-user response data. The SW
// caches are keyed only by URL — there's no per-userId namespace — so
// when a user logs out (or a different user logs in on the same
// browser), the cached snapshots from the prior session would otherwise
// be served from caches.match() the next time the network is slow.
async function clearScopedServiceWorkerCaches(): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) return
  try {
    await Promise.all(SCOPED_SW_CACHE_NAMES.map((n) => caches.delete(n)))
  } catch {
    // Best-effort cleanup. Cookie was already cleared server-side.
  }
}

// Broadcast a runtime language change so AppIntlProvider — which is
// mounted ABOVE AuthProvider in the React tree and therefore can't
// observe useAuth() updates directly — can swap its message bundle.
function dispatchLanguageChange(language: string | undefined): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(LANGUAGE_CHANGE_EVENT, { detail: { language } }),
  )
}

// Map better-auth's session.user shape onto our canonical User type.
// better-auth stores the avatar in the `image` field but the on-disk
// column is `avatar` — the alias is configured in
// apps/api/src/lib/auth.ts via `fields: { image: 'avatar' }`. We accept
// either spelling here so the mapper survives any future alias change.
//
// The `name` column is now non-nullable at the DB level but the
// passwordless sign-up path leaves it as the empty string for a
// brand-new user (better-auth's emailOTP `sign-in` mode creates the row
// without a name). We deliberately allow empty string here — verifyOtp
// uses the empty-name signal to flag `isNewUser` and route through the
// NameStep.
function mapSessionUserToUser(raw: unknown): User | null {
  if (!raw || typeof raw !== 'object') return null
  const u = raw as Record<string, unknown>
  if (typeof u.id !== 'string' || typeof u.email !== 'string') {
    return null
  }
  const name = typeof u.name === 'string' ? u.name : ''
  const avatar =
    (u.image as string | null | undefined) ??
    (u.avatar as string | null | undefined) ??
    null
  return {
    id: u.id,
    email: u.email,
    name,
    avatar,
    language: (u.language as string | undefined) ?? 'en-US',
    emailVerified: Boolean(u.emailVerified),
    phoneNumber: (u.phoneNumber as string | null | undefined) ?? null,
    phoneNumberVerified: Boolean(u.phoneNumberVerified),
  }
}

// Normalize the assorted error shapes better-auth's client can produce
// into a single string for the OTP-result types. The client returns
// either { error: { message, code } } or throws — we tolerate both.
function extractError(e: unknown, fallback: string): string {
  if (e && typeof e === 'object') {
    const obj = e as { message?: unknown; error?: { message?: unknown } }
    if (typeof obj.message === 'string' && obj.message.length > 0) {
      return obj.message
    }
    if (obj.error && typeof obj.error === 'object') {
      const inner = obj.error as { message?: unknown }
      if (typeof inner.message === 'string' && inner.message.length > 0) {
        return inner.message
      }
    }
  }
  return fallback
}

// ============================================
// CONTEXT
// ============================================

const AuthContext = createContext<AuthContextType | null>(null)

// ============================================
// PROVIDER
// ============================================

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const intl = useIntl()
  const { data: session, isPending, refetch } = authClient.useSession()

  const user = useMemo(
    () => mapSessionUserToUser(session?.user ?? null),
    [session?.user],
  )
  const isAuthenticated = !!user

  // Per-user cache eviction. When the active user-id changes (logout,
  // fresh login, account switch in the same browser), wipe
  // sessionStorage, the kasero.* localStorage entries, and the SW
  // caches that hold per-user API/page responses. Without this, a
  // returning visitor inherits stale role data and any cached responses
  // from the previous identity. Verified-exploitable on shared devices
  // in the audit (H-2).
  const previousUserIdRef = useRef<string | null>(null)
  useEffect(() => {
    const currentId = user?.id ?? null
    const previous = previousUserIdRef.current
    if (previous !== null && previous !== currentId) {
      try {
        sessionStorage.clear()
      } catch {
        // Storage error, ignore.
      }
      clearKaseroLocalStorage()
      void clearScopedServiceWorkerCaches()
    }
    previousUserIdRef.current = currentId
  }, [user?.id])

  // Broadcast language whenever the resolved user.language changes so
  // AppIntlProvider (mounted ABOVE AuthProvider) can swap its bundle.
  // Also persist the resolved user to the user-cache so AppIntlProvider's
  // cold-start fast-path (getCachedUser) picks the right locale on the
  // next page load — without this write the cache stays stale and a
  // returning visitor sees the default en-US bundle until session loads.
  useEffect(() => {
    if (!user) {
      setCachedUser(null)
      dispatchLanguageChange(undefined)
      return
    }
    setCachedUser(user)
    dispatchLanguageChange(user.language)
  }, [user?.language, user?.id, user])

  // ============================================
  // AUTH METHODS
  // ============================================

  const sendOtp = useCallback(
    async (email: string): Promise<OtpSendResult> => {
      const fallback = intl.formatMessage({ id: 'auth.connection_error' })
      try {
        const res = await authClient.emailOtp.sendVerificationOtp({
          email,
          type: 'sign-in',
        })
        // better-auth's client returns `{ data, error }` rather than
        // throwing for application-level failures (rate-limit, invalid
        // email, …). Surface those as `success: false` so the caller
        // can render the message.
        const err = (res as { error?: { message?: string } | null } | null)?.error
        if (err) {
          return { success: false, error: err.message ?? fallback }
        }
        return { success: true }
      } catch (e) {
        return { success: false, error: extractError(e, fallback) }
      }
    },
    [intl],
  )

  const verifyOtp = useCallback(
    async (email: string, otp: string): Promise<OtpVerifyResult> => {
      const fallback = intl.formatMessage({ id: 'auth.connection_error' })
      try {
        const res = await authClient.signIn.emailOtp({ email, otp })
        const err = (res as { error?: { message?: string } | null } | null)?.error
        if (err) {
          return {
            success: false,
            isNewUser: false,
            error: err.message ?? fallback,
          }
        }
        // Re-pull the session so the AuthProvider's `user` and the
        // SCOPED_SW_CACHE eviction effect see the new identity before
        // the wizard advances to the next step.
        await refetch()
        // Detect new-user via an empty/missing name. Better-auth's
        // emailOTP sign-in mode creates users on the fly; the brand-new
        // user has no `name` set yet, so we route them to the NameStep.
        const data = (res as { data?: { user?: { name?: unknown } } | null } | null)?.data
        const rawName = data?.user?.name
        const userName = typeof rawName === 'string' ? rawName.trim() : ''
        const isNewUser = userName.length === 0
        return { success: true, isNewUser }
      } catch (e) {
        return {
          success: false,
          isNewUser: false,
          error: extractError(e, fallback),
        }
      }
    },
    [intl, refetch],
  )

  const setName = useCallback(
    async (name: string): Promise<SetNameResult> => {
      const fallback = intl.formatMessage({ id: 'auth.connection_error' })
      try {
        const res = await authClient.updateUser({ name })
        const err = (res as { error?: { message?: string } | null } | null)?.error
        if (err) {
          return { success: false, error: err.message ?? fallback }
        }
        await refetch()
        return { success: true }
      } catch (e) {
        return { success: false, error: extractError(e, fallback) }
      }
    },
    [intl, refetch],
  )

  const linkGoogle = useCallback(
    async (callbackURL: string = '/'): Promise<void> => {
      // better-auth handles the redirect itself; this never resolves
      // on the happy path (the page navigates away). We don't await a
      // response shape because the OAuth dance owns the rest of the
      // flow.
      await authClient.signIn.social({ provider: 'google', callbackURL })
    },
    [],
  )

  const logout = useCallback(async () => {
    try {
      await authClient.signOut()
    } catch {
      // Sign-out is best-effort. Even when the server rejects (rare),
      // the client-side cleanup below should still run.
    }
    try {
      sessionStorage.clear()
    } catch {
      // Storage error, ignore.
    }
    clearKaseroLocalStorage()
    await clearScopedServiceWorkerCaches()
    await refetch()
    dispatchLanguageChange(undefined)
  }, [refetch])

  const refreshUser = useCallback(async () => {
    await refetch()
  }, [refetch])

  useEffect(() => {
    return registerRefetch('profile', refreshUser)
  }, [refreshUser])

  const changeLanguage = useCallback(
    async (language: SupportedLocale): Promise<{ success: boolean; error?: string }> => {
      // authClient.updateUser sends a PATCH /api/auth/update-user; the
      // additionalField mapping in apps/api/src/lib/auth.ts (`language`
      // additionalFields entry with input: true) makes this field
      // user-settable. Refetch picks up the new value into session.
      const result = await authClient.updateUser({ language })
      const err = result.error
      if (err) {
        return {
          success: false,
          error:
            err.message ??
            intl.formatMessage({ id: 'auth.connection_error' }),
        }
      }
      await refetch()
      dispatchLanguageChange(language)
      router.refresh()
      return { success: true }
    },
    [intl, refetch, router],
  )

  // ============================================
  // CONTEXT VALUE
  // ============================================

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      isAuthenticated,
      isLoading: isPending,
      sendOtp,
      verifyOtp,
      setName,
      linkGoogle,
      logout,
      refreshUser,
      changeLanguage,
    }),
    [
      user,
      isAuthenticated,
      isPending,
      sendOtp,
      verifyOtp,
      setName,
      linkGoogle,
      logout,
      refreshUser,
      changeLanguage,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// ============================================
// HOOKS
// ============================================

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}

export function useUser(): User | null {
  return useAuth().user
}

export function useIsAuthenticated(): boolean {
  return useAuth().isAuthenticated
}
