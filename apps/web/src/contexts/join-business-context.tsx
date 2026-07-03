'use client'

import { createContext, useContext, useEffect, useMemo, useRef, ReactNode, Suspense } from 'react'
import { useRouter, usePathname, useSearchParams } from '@/lib/next-navigation-shim'
import { useJoinBusiness } from '@/hooks'
import { JoinBusinessModal } from '@/components/join'
import {
  NATIVE_INVITE_EVENT,
  PENDING_INVITE_CODE_KEY,
  type NativeInviteEventDetail,
} from '@/lib/native/events'

interface JoinBusinessContextValue {
  openJoinModal: () => void
  isJoinModalOpen: boolean
}

const JoinBusinessContext = createContext<JoinBusinessContextValue | null>(null)

export function useJoinBusinessModal(): JoinBusinessContextValue {
  const context = useContext(JoinBusinessContext)
  if (!context) {
    // Return a no-op if not in hub context (business pages don't have this provider)
    return { openJoinModal: () => {}, isJoinModalOpen: false }
  }
  return context
}

interface JoinBusinessProviderProps {
  children: ReactNode
}

/**
 * Inner component that handles the actual search params logic.
 * Must be wrapped in Suspense.
 */
function JoinBusinessProviderInner({ children }: JoinBusinessProviderProps) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const joinBusiness = useJoinBusiness()
  const hasHandledCode = useRef(false)

  // Handle QR code deep linking: ?code=ABC123
  useEffect(() => {
    const code = searchParams.get('code')

    if (code && !hasHandledCode.current) {
      hasHandledCode.current = true

      // Pre-fill and open modal
      joinBusiness.setCode(code.toUpperCase())
      joinBusiness.handleOpen()

      // Clear the code from URL to prevent re-triggering
      const url = new URL(window.location.href)
      url.searchParams.delete('code')
      router.replace(url.pathname + url.search, { scroll: false })

      // Auto-validate after a short delay (let modal render first)
      setTimeout(() => {
        joinBusiness.handleValidateCode()
      }, 100)
    }
  }, [searchParams, router, pathname, joinBusiness])

  // Native (Capacitor) invite deep links: kasero://invite?code=X or the
  // universal-link form. lib/native/bootstrap.ts dispatches
  // NATIVE_INVITE_EVENT for the warm-app case and stashes the code in
  // sessionStorage for the cold-start case (deep link delivered before
  // this provider mounted). Both paths funnel into the same handler as
  // the web ?code= flow. Inert on web — the event never fires and the
  // sessionStorage key is only written by the native bootstrap.
  useEffect(() => {
    const handleInviteCode = (code: string) => {
      if (hasHandledCode.current) return
      hasHandledCode.current = true
      joinBusiness.setCode(code.toUpperCase())
      joinBusiness.handleOpen()
      setTimeout(() => {
        joinBusiness.handleValidateCode()
      }, 100)
    }

    const onNativeInvite = (e: Event) => {
      try {
        sessionStorage.removeItem(PENDING_INVITE_CODE_KEY)
      } catch {
        // ignore
      }
      const code = (e as CustomEvent<NativeInviteEventDetail>).detail?.code
      if (code) handleInviteCode(code)
    }
    window.addEventListener(NATIVE_INVITE_EVENT, onNativeInvite)

    // Cold-start deep link: consume the stashed code once.
    try {
      const pending = sessionStorage.getItem(PENDING_INVITE_CODE_KEY)
      if (pending) {
        sessionStorage.removeItem(PENDING_INVITE_CODE_KEY)
        handleInviteCode(pending)
      }
    } catch {
      // Storage error, ignore.
    }

    return () => window.removeEventListener(NATIVE_INVITE_EVENT, onNativeInvite)
  }, [joinBusiness])

  // Reset the ref when modal closes so a new code param can trigger again
  useEffect(() => {
    if (!joinBusiness.isOpen) {
      hasHandledCode.current = false
    }
  }, [joinBusiness.isOpen])

  // Memoize so the hub UI consumers don't re-render on every
  // joinBusiness state tick.
  const value = useMemo<JoinBusinessContextValue>(
    () => ({
      openJoinModal: joinBusiness.handleOpen,
      isJoinModalOpen: joinBusiness.isOpen,
    }),
    [joinBusiness.handleOpen, joinBusiness.isOpen],
  )

  return (
    <JoinBusinessContext.Provider value={value}>
      {children}
      <JoinBusinessModal joinBusiness={joinBusiness} />
    </JoinBusinessContext.Provider>
  )
}

/**
 * Provider for join business modal functionality.
 * Used in hub layout to allow Hub UI controls to open the join modal.
 *
 * Also handles QR code deep linking: if URL has ?code=ABC123,
 * automatically opens modal with pre-filled code and validates.
 */
export function JoinBusinessProvider({ children }: JoinBusinessProviderProps) {
  return (
    <Suspense fallback={children}>
      <JoinBusinessProviderInner>{children}</JoinBusinessProviderInner>
    </Suspense>
  )
}
