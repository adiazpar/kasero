'use client'

import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, useTransition, type ReactNode } from 'react'
import { useRouter, usePathname } from '@/lib/next-navigation-shim'
import { useAuth } from './auth-context'
import { CACHE_KEYS } from '@/hooks/useSessionCache'
import type { MessageId } from '@/i18n/messageIds'

const BUSINESS_CACHE_STORAGE_KEY = CACHE_KEYS.BUSINESS_SHELL

interface CachedBusiness {
  name: string
  role: string
  isOwner: boolean
  locale: string
  currency: string
  icon: string | null
}

interface PageTransitionContextValue {
  // Optimistic navigation state - shared across nav components and header
  pendingHref: string | null
  setPendingHref: (href: string | null) => void
  // Full message id for a transient navigation-error notice. Set when the
  // safety-net timeout fires; auto-clears 4 seconds later. Consumed by
  // <NavigationErrorNotice/>, which passes it directly to formatMessage.
  navigationError: MessageId | null
  setNavigationError: (key: MessageId | null) => void
  // Centralised navigation. Sets pendingHref and pushes via router inside a
  // React transition so rapid taps coalesce. A safety timeout in the
  // provider auto-clears pendingHref if pathname doesn't catch up, so a
  // stalled router.push can't leave the UI stuck.
  navigate: (href: string) => void
  // Business cache for instant display and access validation
  getCachedBusiness: (businessId: string) => CachedBusiness | null
  setCachedBusiness: (businessId: string, data: CachedBusiness) => void
  setCachedBusinesses: (businesses: Array<{ id: string; name: string; role: string; isOwner: boolean; locale: string; currency: string; icon: string | null }>) => void
  clearCachedBusiness: (businessId: string) => void
}

const PageTransitionContext = createContext<PageTransitionContextValue | null>(null)

export function usePageTransition(): PageTransitionContextValue {
  const context = useContext(PageTransitionContext)
  if (!context) {
    throw new Error('usePageTransition must be used within a PageTransitionProvider')
  }
  return context
}

interface PageTransitionProviderProps {
  children: ReactNode
}

export function PageTransitionProvider({ children }: PageTransitionProviderProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { user } = useAuth()
  const [pendingHref, setPendingHrefState] = useState<string | null>(null)
  const [navigationError, setNavigationErrorState] = useState<MessageId | null>(null)
  const [, startTransition] = useTransition()

  // Business cache - use ref to avoid re-renders, initialize from sessionStorage
  const businessCacheRef = useRef<Record<string, CachedBusiness>>({})

  // Initialize cache from sessionStorage on mount
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(BUSINESS_CACHE_STORAGE_KEY)
      if (stored) {
        businessCacheRef.current = JSON.parse(stored)
      }
    } catch {
      // Ignore storage errors
    }
  }, [])

  // Evict the in-memory business cache whenever the authenticated user
  // changes. The cache is keyed by businessId only (no userId), so without
  // this, a new account logging into the same tab would inherit the prior
  // user's cached role — an employee could then see owner/partner-only
  // edit affordances until the access API refreshed the role.
  const lastUserIdRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    const currentUserId = user?.id ?? null
    if (lastUserIdRef.current === undefined) {
      lastUserIdRef.current = currentUserId
      return
    }
    if (lastUserIdRef.current !== currentUserId) {
      businessCacheRef.current = {}
      try {
        sessionStorage.removeItem(BUSINESS_CACHE_STORAGE_KEY)
        sessionStorage.removeItem('layer.accountUnderlay')
      } catch {
        // Ignore storage errors
      }
      lastUserIdRef.current = currentUserId
    }
  }, [user?.id])

  const setPendingHref = useCallback((href: string | null) => setPendingHrefState(href), [])
  const setNavigationError = useCallback((key: MessageId | null) => setNavigationErrorState(key), [])

  const navigate = useCallback((href: string) => {
    setPendingHrefState(href)
    // startTransition lets React 18 coalesce rapid pushes into a single
    // commit, which is what saves us from "second tap eats the first" in
    // App Router's navigation scheduler.
    startTransition(() => {
      router.push(href)
    })
  }, [router])

  // Business cache functions
  const getCachedBusiness = useCallback((businessId: string): CachedBusiness | null => {
    return businessCacheRef.current[businessId] || null
  }, [])

  const setCachedBusiness = useCallback((businessId: string, data: CachedBusiness) => {
    businessCacheRef.current[businessId] = data
    try {
      sessionStorage.setItem(BUSINESS_CACHE_STORAGE_KEY, JSON.stringify(businessCacheRef.current))
    } catch {
      // Ignore storage errors
    }
  }, [])

  const setCachedBusinesses = useCallback((businesses: Array<{ id: string; name: string; role: string; isOwner: boolean; locale: string; currency: string; icon: string | null }>) => {
    businesses.forEach(b => {
      businessCacheRef.current[b.id] = {
        name: b.name,
        role: b.role,
        isOwner: b.isOwner,
        locale: b.locale,
        currency: b.currency,
        icon: b.icon ?? null,
      }
    })
    try {
      sessionStorage.setItem(BUSINESS_CACHE_STORAGE_KEY, JSON.stringify(businessCacheRef.current))
    } catch {
      // Ignore storage errors
    }
  }, [])

  const clearCachedBusiness = useCallback((businessId: string) => {
    delete businessCacheRef.current[businessId]
    try {
      sessionStorage.setItem(BUSINESS_CACHE_STORAGE_KEY, JSON.stringify(businessCacheRef.current))
    } catch {
      // Ignore storage errors
    }
  }, [])

  // pendingHref auto-clear with safety net.
  // - Clears immediately once pathname catches up to pendingHref (the
  //   navigation actually happened).
  // - Force-clears after a 5-second watchdog timeout if pathname never
  //   catches up, AND surfaces a transient error notice. 5s is generous
  //   enough that real cold-start loads always complete first; only
  //   genuine failures (offline, server error) trip it.
  useEffect(() => {
    if (!pendingHref) return
    if (pendingHref === pathname) {
      setPendingHrefState(null)
      return
    }
    const timeout = window.setTimeout(() => {
      setPendingHrefState(null)
      setNavigationErrorState('navigation.load_failed')
    }, 5000)
    return () => window.clearTimeout(timeout)
  }, [pendingHref, pathname])

  // Auto-clear navigationError after 4 seconds so the notice doesn't
  // linger. The component reading it just stops rendering when this flips
  // back to null.
  useEffect(() => {
    if (!navigationError) return
    const timeout = window.setTimeout(() => {
      setNavigationErrorState(null)
    }, 4000)
    return () => window.clearTimeout(timeout)
  }, [navigationError])

  // Memoize to avoid re-rendering the entire business-scoped tree every
  // time this provider re-renders. This context is consumed broadly across
  // the app shell — the blast radius of an unmemoized value is the whole
  // app shell on every auth/pathname tick.
  const value = useMemo<PageTransitionContextValue>(
    () => ({
      pendingHref, setPendingHref,
      navigationError, setNavigationError,
      navigate,
      getCachedBusiness, setCachedBusiness, setCachedBusinesses, clearCachedBusiness,
    }),
    [
      pendingHref, setPendingHref,
      navigationError, setNavigationError,
      navigate,
      getCachedBusiness, setCachedBusiness, setCachedBusinesses, clearCachedBusiness,
    ],
  )

  return (
    <PageTransitionContext.Provider value={value}>
      {children}
    </PageTransitionContext.Provider>
  )
}
