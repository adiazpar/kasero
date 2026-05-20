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
import { fetchDeduped } from '@/lib/fetch'
import { apiRequest } from '@/lib/api-client'
import { CACHE_KEYS, scopedLocalCache } from '@/hooks'
import { isFresh } from '@/lib/freshness'
import { useRevalidateOnFocus } from '@/hooks/useRevalidateOnFocus'
import { registerRefetch } from '@/lib/realtime/refetch-registry'
import type { SalesSession } from '@kasero/shared/types/sale'

interface SalesSessionsCacheShape {
  currentSession: SalesSession | null
  sessions: SalesSession[]
  nextCursor: string | null
}

interface SalesSessionsContextValue {
  currentSession: SalesSession | null
  sessions: SalesSession[]
  isLoaded: boolean
  isLoading: boolean
  error: string
  ensureLoaded: () => Promise<void>
  refetch: () => Promise<void>
  loadMore: () => Promise<void>
  openSession: (startingCash: number) => Promise<SalesSession>
  closeSession: (params: { countedCash: number; notes?: string }) => Promise<SalesSession>
}

const SalesSessionsContext = createContext<SalesSessionsContextValue | null>(null)

export function useSalesSessions(): SalesSessionsContextValue {
  const ctx = useContext(SalesSessionsContext)
  if (!ctx) throw new Error('useSalesSessions must be used within a SalesSessionsProvider')
  return ctx
}

interface SalesSessionsProviderProps {
  businessId: string
  onSessionClosed?: () => void
  children: ReactNode
}

const PAGE_SIZE = 50

export function SalesSessionsProvider({
  businessId,
  onSessionClosed,
  children,
}: SalesSessionsProviderProps) {
  // localStorage so the open-session state survives a PWA cold-start —
  // SalesView paints the in-progress layout on the first render after
  // relaunch instead of flashing the "no session" expanded state while
  // the API resolves. clearKaseroLocalStorage at auth transitions and
  // clearPerBusinessCaches on leave/delete keep this from outliving its
  // owner.
  const cache = useRef(scopedLocalCache<SalesSessionsCacheShape>(CACHE_KEYS.SALES_SESSIONS, businessId))
  const initial = useRef(
    cache.current.get() ?? { currentSession: null, sessions: [], nextCursor: null },
  ).current

  const [currentSession, setCurrentState] = useState<SalesSession | null>(initial.currentSession)
  const [sessions, setSessionsState] = useState<SalesSession[]>(initial.sessions)
  const [, setNextCursor] = useState<string | null>(initial.nextCursor)
  const [isLoaded, setIsLoaded] = useState(initial.sessions.length > 0 || initial.currentSession !== null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const currentRef = useRef<SalesSession | null>(initial.currentSession)
  const sessionsRef = useRef<SalesSession[]>(initial.sessions)
  const cursorRef = useRef<string | null>(initial.nextCursor)
  const inFlight = useRef<Promise<void> | null>(null)
  const lastFetchedAt = useRef<number | null>(null)

  const persist = useCallback(() => {
    cache.current.set({
      currentSession: currentRef.current,
      sessions: sessionsRef.current,
      nextCursor: cursorRef.current,
    })
  }, [])

  const writeCurrent = useCallback((next: SalesSession | null) => {
    currentRef.current = next
    setCurrentState(next)
  }, [])

  const writeSessions = useCallback((next: SalesSession[]) => {
    sessionsRef.current = next
    setSessionsState(next)
  }, [])

  const writeCursor = useCallback((next: string | null) => {
    cursorRef.current = next
    setNextCursor(next)
  }, [])

  const fetchAll = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    setError('')
    try {
      const [currentRes, listRes] = await Promise.all([
        fetchDeduped(`/api/businesses/${businessId}/sales-sessions/current`),
        fetchDeduped(`/api/businesses/${businessId}/sales-sessions?limit=${PAGE_SIZE}`),
      ])
      const currentData = await currentRes.json()
      const listData = await listRes.json()

      if (currentRes.ok && currentData.success) {
        writeCurrent(currentData.session ?? null)
      }
      if (listRes.ok && listData.success) {
        writeSessions(listData.sessions ?? [])
        writeCursor(listData.nextCursor ?? null)
      }
      setIsLoaded(true)
      lastFetchedAt.current = Date.now()
      persist()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions')
    } finally {
      setIsLoading(false)
      inFlight.current = null
    }
  }, [businessId, persist, writeCurrent, writeSessions, writeCursor])

  const ensureLoaded = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current
    if (isFresh(lastFetchedAt.current, Date.now())) return Promise.resolve()
    inFlight.current = fetchAll()
    return isLoaded ? Promise.resolve() : inFlight.current
  }, [fetchAll, isLoaded])

  const refetch = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current
    inFlight.current = fetchAll()
    return inFlight.current
  }, [fetchAll])

  const loadMore = useCallback(async (): Promise<void> => {
    if (!cursorRef.current) return
    if (inFlight.current) return inFlight.current
    setIsLoading(true)
    try {
      const res = await fetchDeduped(
        `/api/businesses/${businessId}/sales-sessions?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(cursorRef.current)}`,
      )
      const data = await res.json()
      if (res.ok && data.success) {
        writeSessions([...sessionsRef.current, ...(data.sessions ?? [])])
        writeCursor(data.nextCursor ?? null)
        persist()
      }
    } finally {
      setIsLoading(false)
    }
  }, [businessId, persist, writeSessions, writeCursor])

  useRevalidateOnFocus(ensureLoaded)

  // Register both the current-session and history-list state under one
  // realtime key — open/close events from teammates need to flip both.
  useEffect(() => {
    return registerRefetch('sales-sessions', refetch)
  }, [refetch])

  const openSession = useCallback(async (startingCash: number): Promise<SalesSession> => {
    const { session } = await apiRequest<{ session: SalesSession }>(
      `/api/businesses/${businessId}/sales-sessions/open`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startingCash }),
      },
    )
    writeCurrent(session)
    persist()
    return session
  }, [businessId, persist, writeCurrent])

  const closeSession = useCallback(async (params: { countedCash: number; notes?: string }): Promise<SalesSession> => {
    const { session } = await apiRequest<{ session: SalesSession }>(
      `/api/businesses/${businessId}/sales-sessions/close`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      },
    )
    writeCurrent(null)
    writeSessions([session, ...sessionsRef.current])
    persist()
    onSessionClosed?.()
    return session
  }, [businessId, persist, writeCurrent, writeSessions, onSessionClosed])

  const value = useMemo<SalesSessionsContextValue>(
    () => ({
      currentSession,
      sessions,
      isLoaded,
      isLoading,
      error,
      ensureLoaded,
      refetch,
      loadMore,
      openSession,
      closeSession,
    }),
    [currentSession, sessions, isLoaded, isLoading, error, ensureLoaded, refetch, loadMore, openSession, closeSession],
  )

  return <SalesSessionsContext.Provider value={value}>{children}</SalesSessionsContext.Provider>
}
