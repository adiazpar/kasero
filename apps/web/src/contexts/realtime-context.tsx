'use client'

/**
 * RealtimeProvider
 *
 * Owns the single EventSource connection to /api/realtime. Manages:
 *   - Lifecycle: opens on auth, closes on logout, closes on unmount.
 *   - Active-business switching: debounced 250ms, reopens with businessId param.
 *   - 45-second client watchdog: any `message` event (named or default)
 *     resets the timer. On timeout, close and reopen — the browser carries
 *     the Last-Event-ID automatically so nothing is lost.
 *
 * NOTE on heartbeat lines (:hb\n\n):
 *   The browser's EventSource parser silently consumes comment lines — they
 *   never reach JS addEventListener callbacks. So the 15-second server
 *   heartbeat cannot reset the client watchdog. The watchdog instead resets
 *   on every real message. If the server is alive but quiet for 45s the
 *   watchdog will close-and-reconnect; this is acceptable — it's
 *   defense-in-depth, not the primary keep-alive mechanism.
 *
 *   Reconnect carries Last-Event-ID, so no events are lost.
 *
 * - 3-strike auth-expiry close: after 3 consecutive `error` events without
 *   an intervening `open`, calls logout() to force a clean re-auth.
 * - Echo suppression: every dispatched event is tagged with ownDeviceId; the
 *   handler drops events the publishing client sent itself.
 * - revokeBusinessContext: called by handlers for session.revoked,
 *   business.deleted, and ownership.transferred.
 */

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
import { useIonToast } from '@ionic/react'
import { useIntl } from 'react-intl'
import { useAuth } from '@/contexts/auth-context'
import { useRouter } from '@/lib/next-navigation-shim'
import { getDeviceId } from '@/lib/realtime/device-id'
import { dispatchRealtimeEvent } from '@/lib/realtime/handlers'
import { callRefetch } from '@/lib/realtime/refetch-registry'
import { createSessionCache, CACHE_KEYS } from '@/hooks/useSessionCache'
import type { RealtimeEvent } from '@kasero/shared/realtime'
import type { MessageId } from '@/i18n/messageIds'

const hubBusinessesCache = createSessionCache<unknown[]>(CACHE_KEYS.HUB_BUSINESSES)

type RevokeReason = 'removed' | 'business_deleted' | 'ownership_transferred'

interface RealtimeContextValue {
  /**
   * Set the active business id. The provider closes the current
   * EventSource and reopens with the new businessId query param,
   * debounced 250ms.
   */
  setActiveBusinessId: (id: string | null) => void
  /**
   * Idempotent: tear down active-business state if the revoked id
   * matches the currently-active business and navigate to the hub.
   */
  revokeBusinessContext: (businessId: string, reason: RevokeReason) => void
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null)

export function useRealtime(): RealtimeContextValue {
  const v = useContext(RealtimeContext)
  if (!v) throw new Error('useRealtime must be used inside <RealtimeProvider>')
  return v
}

// Named SSE event types the server emits with an `event:` field.
// We register a listener for each so named events also reset the watchdog.
const NAMED_EVENT_TYPES: ReadonlyArray<string> = [
  'team.member.joined',
  'team.member.removed',
  'team.member.role_changed',
  'team.member.status_changed',
  'team.invite.created',
  'team.invite.regenerated',
  'team.invite.consumed',
  'team.invite.deleted',
  'business.updated',
  'profile.updated',
  'business.list.changed',
  'session.revoked',
  'business.deleted',
  'ownership.transferred',
  'system.resync',
  'system.error',
  'system.auth_expired',
]

const WATCHDOG_MS = 45_000
const SWITCH_DEBOUNCE_MS = 250
const MAX_CONSECUTIVE_ERRORS = 3

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, logout } = useAuth()
  const router = useRouter()
  const [presentToast] = useIonToast()
  const intl = useIntl()

  const [activeBusinessId, setActiveBusinessIdState] = useState<string | null>(null)

  // Refs — safe to read in closures without stale-closure issues for
  // values that should not retrigger effects when they change.
  const switchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const esRef = useRef<EventSource | null>(null)
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const consecutiveErrorsRef = useRef(0)

  // getDeviceId() reads localStorage — call once at mount, not per-message.
  const ownDeviceIdRef = useRef<string>('')
  if (!ownDeviceIdRef.current) {
    ownDeviceIdRef.current = getDeviceId()
  }

  // Keep a stable ref to activeBusinessId for use inside closures that
  // should not re-create on every state change.
  const activeBusinessIdRef = useRef<string | null>(null)
  activeBusinessIdRef.current = activeBusinessId

  // ============================================================
  // REVOKE FLOW
  // ============================================================
  const revokeBusinessContext = useCallback(
    (businessId: string, reason: RevokeReason) => {
      if (activeBusinessIdRef.current !== businessId) {
        // Not the active business — silently refetch the list.
        callRefetch('businesses-list')
        return
      }

      // Active business is being revoked — show toast, reset state, navigate.
      const messageId =
        reason === 'removed'
          ? 'session_revoked_removed'
          : reason === 'business_deleted'
            ? 'session_revoked_business_deleted'
            : 'session_revoked_ownership_transferred'

      const message = intl.formatMessage({ id: messageId }, { businessName: '' })
      presentToast({ message, duration: 4000, color: 'medium' })

      // Dismiss any open IonModal before navigating away. Without this an
      // open invite-code or product modal stays pinned on screen after the
      // route change because the host IonPage is replaced while the portal
      // is still mounted. HTMLIonModalElement.dismiss() triggers the
      // exit animation and fires onDidDismiss so host state cleans up.
      document.querySelectorAll('ion-modal').forEach((m) => {
        ;(m as unknown as { dismiss?: () => void }).dismiss?.()
      })

      callRefetch('businesses-list')
      setActiveBusinessIdState(null)

      // Give the refetch a beat to settle the sessionStorage cache, then
      // decide where to send the user: hub (has remaining businesses) or
      // the join/create entry point (no businesses left).
      setTimeout(() => {
        const remaining = hubBusinessesCache.get()
        if (!remaining || remaining.length === 0) {
          router.replace('/join')
        } else {
          router.replace('/')
        }
      }, 250)
    },
    // Intentionally omit activeBusinessIdRef — it is a ref, not state.
    // The callback reads it via ref so revokeBusinessContext stays stable.
    [intl, presentToast, router],
  )

  // ============================================================
  // AUTH-EXPIRED PATH
  // ============================================================
  const routeToLogin = useCallback(() => {
    esRef.current?.close()
    esRef.current = null
    void logout()
  }, [logout])

  // ============================================================
  // TOAST HELPER for system.error events
  // ============================================================
  const showToast = useCallback(
    (key: string) => {
      presentToast({
        message: intl.formatMessage({ id: key as MessageId }),
        duration: 4000,
        color: 'warning',
      })
    },
    [intl, presentToast],
  )

  // ============================================================
  // EVENTOURCE OPEN / CLOSE
  // ============================================================
  const openConnectionRef = useRef<(() => void) | null>(null)

  const openConnection = useCallback(() => {
    if (!isAuthenticated || !user) return

    // Close any prior connection.
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }

    const params = new URLSearchParams()
    if (activeBusinessIdRef.current) {
      params.set('businessId', activeBusinessIdRef.current)
    }
    params.set('deviceId', ownDeviceIdRef.current)

    const es = new EventSource(`/api/realtime?${params.toString()}`)
    esRef.current = es

    // ---- watchdog ----
    const resetWatchdog = () => {
      if (watchdogRef.current !== null) clearTimeout(watchdogRef.current)
      watchdogRef.current = setTimeout(() => {
        // Watchdog fired: no message for WATCHDOG_MS. Close and reopen.
        // The browser preserves Last-Event-ID on reconnect so no events
        // are lost.
        es.close()
        if (esRef.current === es) {
          esRef.current = null
          // Re-invoke via ref to avoid stale closure over openConnection.
          openConnectionRef.current?.()
        }
      }, WATCHDOG_MS)
    }

    es.addEventListener('open', () => {
      consecutiveErrorsRef.current = 0
      resetWatchdog()
    })

    // ---- message handler ----
    const ctx = {
      ownDeviceId: ownDeviceIdRef.current,
      revokeBusinessContext,
      routeToLogin,
      showToast,
    }

    const onMessage = (ev: MessageEvent) => {
      resetWatchdog()
      try {
        const event = JSON.parse(ev.data as string) as RealtimeEvent
        dispatchRealtimeEvent(event, ctx)
      } catch (err) {
        console.warn('[realtime] failed to parse event payload', err)
      }
    }

    // Default message events (no `event:` field on the frame).
    es.onmessage = onMessage

    // Named events — server sets `event: <type>` on each frame.
    for (const type of NAMED_EVENT_TYPES) {
      es.addEventListener(type, onMessage as EventListener)
    }

    // ---- error handler ----
    es.addEventListener('error', () => {
      consecutiveErrorsRef.current += 1
      if (consecutiveErrorsRef.current >= MAX_CONSECUTIVE_ERRORS) {
        es.close()
        if (esRef.current === es) esRef.current = null
        // 3 consecutive errors without a successful open — treat as
        // auth expiry (browsers retry 401 indefinitely; this is the
        // circuit breaker).
        routeToLogin()
      }
    })

    // Kick off the watchdog immediately on open.
    resetWatchdog()
  }, [isAuthenticated, user, revokeBusinessContext, routeToLogin, showToast])

  // Keep ref in sync for the watchdog self-call.
  openConnectionRef.current = openConnection

  // ============================================================
  // EFFECT: open/close on auth state
  // ============================================================
  useEffect(() => {
    if (!isAuthenticated) {
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
      if (watchdogRef.current !== null) {
        clearTimeout(watchdogRef.current)
        watchdogRef.current = null
      }
      return
    }

    openConnection()

    return () => {
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
      if (watchdogRef.current !== null) {
        clearTimeout(watchdogRef.current)
        watchdogRef.current = null
      }
    }
  }, [isAuthenticated, openConnection])

  // ============================================================
  // DEBOUNCED BUSINESS SWITCH
  // ============================================================
  const setActiveBusinessId = useCallback((id: string | null) => {
    if (switchTimerRef.current !== null) clearTimeout(switchTimerRef.current)
    switchTimerRef.current = setTimeout(() => {
      switchTimerRef.current = null
      setActiveBusinessIdState(id)
    }, SWITCH_DEBOUNCE_MS)
  }, [])

  // Cleanup switch debounce timer on unmount.
  useEffect(() => {
    return () => {
      if (switchTimerRef.current !== null) {
        clearTimeout(switchTimerRef.current)
        switchTimerRef.current = null
      }
    }
  }, [])

  const value = useMemo<RealtimeContextValue>(
    () => ({ setActiveBusinessId, revokeBusinessContext }),
    [setActiveBusinessId, revokeBusinessContext],
  )

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}
