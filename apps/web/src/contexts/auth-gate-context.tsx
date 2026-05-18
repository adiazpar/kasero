'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useRouter } from '@/lib/next-navigation-shim'
import { LogoutConfirmModal } from '@/components/auth/LogoutConfirmModal'
import { useAuth } from './auth-context'

// Unified phase machine: both playEntry (entry-page/auth -> hub) and
// playExit (logout -> entry-page) use the same 5-phase choreography. The
// "overlay" is conceptually a bidirectional entrance — it doesn't know
// or care which direction you're going, only that it's covering a
// transition. Work that needs to happen under cover (like clearing
// auth state on logout) runs inside the `hold` phase.
export type AuthGatePhase =
  | 'idle'
  | 'overlay-in'
  | 'icon-in'
  | 'hold'
  | 'icon-out'
  | 'overlay-out'

export interface AuthGateContextValue {
  phase: AuthGatePhase
  reducedMotion: boolean
  playEntry: (redirectTo: string) => Promise<void>
  requestLogout: (redirectTo?: string) => void
  // Called by the hub page once it has rendered with its data. Releases the
  // hold phase of playEntry so the fade-out can begin. No-op if called
  // outside of an active entry (e.g. on warm hub re-mounts).
  markHubReady: () => void
}

const OVERLAY_IN_MS = 250
const PRE_ICON_GAP_MS = 150
const ICON_IN_MS = 400
const HOLD_MIN_MS = 600
const HOLD_CAP_MS = 2000
const ICON_OUT_MS = 400
const POST_ICON_GAP_MS = 150
const OVERLAY_OUT_MS = 300
const REDUCED_MOTION_FADE_MS = 200

// sessionStorage flag the OAuth buttons set immediately before the
// cross-origin redirect. On return (cold-start back at callbackURL),
// AuthGateProvider consumes the flag and plays the entry overlay so the
// transition into the hub feels symmetric with the email/OTP path.
// sessionStorage survives a same-tab round-trip through an external
// origin, so the flag is still there when the SPA boots back up.
export const PENDING_ENTRY_STORAGE_KEY = 'kasero.auth.pending-entry'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const AuthGateContext = createContext<AuthGateContextValue | null>(null)

export function useAuthGate(): AuthGateContextValue {
  const ctx = useContext(AuthGateContext)
  if (!ctx) {
    throw new Error('useAuthGate must be used within an AuthGateProvider')
  }
  return ctx
}

export function AuthGateProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const { logout, isAuthenticated, isLoading: authLoading } = useAuth()
  const [phase, setPhase] = useState<AuthGatePhase>('idle')
  const [reducedMotion, setReducedMotion] = useState(false)
  const inFlightRef = useRef<Promise<void> | null>(null)
  // Resolver for the current entry's hub-ready gate. Populated at the
  // start of playEntry (before router.push, so the hub's mount-effect
  // is always observed), cleared in the finally block. Null between
  // transitions so stray markHubReady calls from warm hub re-mounts
  // are harmless no-ops.
  const hubReadyResolverRef = useRef<(() => void) | null>(null)
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false)
  const pendingRedirectRef = useRef<string>('/')

  const markHubReady = useCallback(() => {
    hubReadyResolverRef.current?.()
    hubReadyResolverRef.current = null
  }, [])

  // Shared transition runner. `work` is the side effect that must happen
  // under the opaque overlay (logout clears user state safely). If work
  // is provided, navigation is deferred until after work completes so
  // the destination page mounts without a brief flash of the prior state.
  // If work is absent (login/auth wizard), navigation fires at the start so
  // the destination can start loading during the overlay-in phase.
  const runTransition = useCallback(
    async (
      destination: string,
      work?: () => Promise<void>,
      readySignal?: Promise<void>,
      replace: boolean = false,
    ): Promise<void> => {
      if (inFlightRef.current) return inFlightRef.current
      const navigate = (to: string) => {
        if (replace) router.replace(to)
        else router.push(to)
      }

      // Defense-in-depth: every caller of runTransition is supposed
      // to pass a same-origin path, but the login page reads the
      // destination from a query parameter. If that path-validation
      // ever regresses, this guard prevents router.push from sending
      // the user to an attacker-controlled origin (open redirect).
      // We resolve `destination` against location.origin and confirm
      // the resulting URL stays same-origin; otherwise fall back to
      // / (the Hub — safe default for post-auth navigation).
      if (typeof window !== 'undefined') {
        try {
          const url = new URL(destination, window.location.origin)
          if (url.origin !== window.location.origin) {
            destination = '/'
          }
        } catch {
          destination = '/'
        }
      }

      const navigateEarly = !work

      const run = (async () => {
        try {
          if (reducedMotion) {
            setPhase('overlay-in')
            if (navigateEarly) {
              navigate(destination)
              router.refresh()
            }
            await wait(REDUCED_MOTION_FADE_MS)
            if (work) {
              await work()
              navigate(destination)
              router.refresh()
            }
            setPhase('overlay-out')
            await wait(REDUCED_MOTION_FADE_MS)
            return
          }

          // 1. Overlay fades in over the current page.
          setPhase('overlay-in')
          if (navigateEarly) {
            navigate(destination)
            router.refresh()
          }
          await wait(OVERLAY_IN_MS)

          // 2. Breath: overlay fully opaque, icon not yet visible.
          await wait(PRE_ICON_GAP_MS)

          // 3. Logo pops in.
          setPhase('icon-in')
          await wait(ICON_IN_MS)

          // 4. Hold. Under cover: run work (logout) if needed and
          //    navigate. Then wait out the min timer (so the pop-in
          //    always reads) plus the ready signal (so the destination
          //    is rendered before we fade out), capped so a slow
          //    destination can't freeze the overlay.
          setPhase('hold')
          if (work) {
            await work()
            navigate(destination)
            router.refresh()
          }
          await Promise.all([
            wait(HOLD_MIN_MS),
            readySignal
              ? Promise.race([readySignal, wait(HOLD_CAP_MS)])
              : Promise.resolve(),
          ])

          // 5. Logo pops out.
          setPhase('icon-out')
          await wait(ICON_OUT_MS)

          // 6. Breath: icon gone, overlay still opaque.
          await wait(POST_ICON_GAP_MS)

          // 7. Overlay fades out, destination revealed.
          setPhase('overlay-out')
          await wait(OVERLAY_OUT_MS)
        } finally {
          setPhase('idle')
          hubReadyResolverRef.current = null
        }
      })()

      inFlightRef.current = run.finally(() => {
        inFlightRef.current = null
      })
      return inFlightRef.current
    },
    [reducedMotion, router],
  )

  const playEntry = useCallback(
    (redirectTo: string): Promise<void> => {
      // Seed the hub-ready resolver BEFORE kicking off the transition,
      // so the hub's on-mount effect always finds a resolver to call
      // even if it renders from cache before the hold phase begins.
      const hubReadyPromise = new Promise<void>((resolve) => {
        hubReadyResolverRef.current = resolve
      })
      // replace=true: auth surface (entry/auth) shouldn't remain in
      // history after a successful login — back-button must not walk
      // the user back into the verify step or the OAuth pre-redirect
      // page once they're authenticated.
      return runTransition(redirectTo, undefined, hubReadyPromise, true)
    },
    [runTransition],
  )

  const playExit = useCallback(
    (redirectTo: string = '/'): Promise<void> => {
      return runTransition(redirectTo, logout)
    },
    [runTransition, logout],
  )

  const requestLogout = useCallback(
    (redirectTo: string = '/'): void => {
      // Don't stack a confirmation on top of an in-flight transition.
      if (inFlightRef.current) return
      // First caller wins — if the modal is already open, keep the
      // originally-stashed redirect target.
      if (isLogoutConfirmOpen) return
      pendingRedirectRef.current = redirectTo
      setIsLogoutConfirmOpen(true)
    },
    [isLogoutConfirmOpen],
  )

  const handleLogoutConfirm = useCallback(() => {
    setIsLogoutConfirmOpen(false)
    void playExit(pendingRedirectRef.current)
  }, [playExit])

  const value = useMemo<AuthGateContextValue>(
    () => ({ phase, reducedMotion, playEntry, requestLogout, markHubReady }),
    [phase, reducedMotion, playEntry, requestLogout, markHubReady],
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(mq.matches)
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Cold-start after OAuth: if OAuthButtons set the pending-entry flag
  // before the redirect, consume it once the session has resolved and
  // play the entry overlay. The flag is one-shot — if the user lands
  // back unauthenticated (declined consent, server error) we still
  // clear it so the next genuine OAuth attempt isn't shadowed.
  const pendingEntryConsumedRef = useRef(false)
  useEffect(() => {
    if (pendingEntryConsumedRef.current) return
    if (typeof window === 'undefined') return
    if (authLoading) return
    let flagged = false
    try {
      flagged = sessionStorage.getItem(PENDING_ENTRY_STORAGE_KEY) === '1'
    } catch {
      flagged = false
    }
    if (!flagged) return
    pendingEntryConsumedRef.current = true
    try {
      sessionStorage.removeItem(PENDING_ENTRY_STORAGE_KEY)
    } catch {
      // ignore
    }
    if (isAuthenticated) {
      void playEntry('/')
    }
  }, [authLoading, isAuthenticated, playEntry])

  return (
    <AuthGateContext.Provider value={value}>
      {children}
      <LogoutConfirmModal
        isOpen={isLogoutConfirmOpen}
        onClose={() => setIsLogoutConfirmOpen(false)}
        onConfirm={handleLogoutConfirm}
      />
    </AuthGateContext.Provider>
  )
}
