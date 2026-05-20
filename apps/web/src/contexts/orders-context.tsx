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
import { CACHE_KEYS, createSessionCache } from '@/hooks'
import { isFresh } from '@/lib/freshness'
import { useRevalidateOnFocus } from '@/hooks/useRevalidateOnFocus'
import { registerRefetch } from '@/lib/realtime/refetch-registry'
import type { ExpandedOrder } from '@/lib/products'

type OrdersUpdater =
  | ExpandedOrder[]
  | ((prev: ExpandedOrder[]) => ExpandedOrder[])

interface OrdersCacheShape {
  active: ExpandedOrder[]
  completed: ExpandedOrder[]
}

interface OrdersContextValue {
  /**
   * Combined view of every order that has been fetched. Until completed
   * orders are loaded this only contains active ones — consumers that
   * specifically need completed orders should call ensureCompletedLoaded
   * (or check isCompletedLoaded before deriving from this list).
   */
  orders: ExpandedOrder[]
  /**
   * Mutate the combined orders array. The updater receives the union and
   * the result is split back into active/completed buckets by status, so
   * legacy call sites (create / delete / cascade) keep working unchanged.
   */
  setOrders: (updater: OrdersUpdater) => void
  /** True once active orders have been fetched at least once for this mount. */
  isActiveLoaded: boolean
  /** True once completed orders have been fetched at least once for this mount. */
  isCompletedLoaded: boolean
  /** True while the active bucket is being fetched. */
  isLoadingActive: boolean
  /** True while the completed bucket is being fetched. */
  isLoadingCompleted: boolean
  error: string
  /**
   * Idempotent loader for the active bucket (pending + overdue). Safe to
   * call from multiple places — the first call kicks off the fetch and
   * later calls await the in-flight promise or no-op.
   */
  ensureActiveLoaded: () => Promise<void>
  /** Same shape as ensureActiveLoaded, but for the completed bucket. */
  ensureCompletedLoaded: () => Promise<void>
  /** Force-refresh the active bucket from the server. */
  refetchActive: () => Promise<void>
  /** Force-refresh the completed bucket from the server. */
  refetchCompleted: () => Promise<void>
}

const OrdersContext = createContext<OrdersContextValue | null>(null)

export function useOrders(): OrdersContextValue {
  const ctx = useContext(OrdersContext)
  if (!ctx) {
    throw new Error('useOrders must be used within an OrdersProvider')
  }
  return ctx
}

interface OrdersProviderProps {
  businessId: string
  children: ReactNode
}

function readCache(
  cache: { get: () => OrdersCacheShape | null }
): OrdersCacheShape {
  const value = cache.get()
  // Tolerate the legacy shape (a flat ExpandedOrder[]) so users with an
  // old session don't see a hard crash on first paint after deploy.
  // Falling back to empty buckets just forces a fresh fetch.
  if (!value || Array.isArray(value)) {
    return { active: [], completed: [] }
  }
  return {
    active: Array.isArray(value.active) ? value.active : [],
    completed: Array.isArray(value.completed) ? value.completed : [],
  }
}

function isReceived(order: ExpandedOrder): boolean {
  return order.status === 'received'
}

// Business-scoped orders store, split into active (pending + overdue) and
// completed (received) buckets. Each bucket is fetched on demand so the
// products page can prime active orders eagerly while completed orders
// only load when the user toggles to that view. Mutations operate on the
// unified `orders` array and are split back by status when applied.
//
// Mount this with key={businessId} so state is re-initialized when the
// user switches businesses.
export function OrdersProvider({ businessId, children }: OrdersProviderProps) {
  const cache = useRef(
    createSessionCache<OrdersCacheShape>(`${CACHE_KEYS.ORDERS}_${businessId}`)
  )

  const initial = useRef(readCache(cache.current)).current

  const [activeOrders, setActiveOrdersState] = useState<ExpandedOrder[]>(initial.active)
  const [completedOrders, setCompletedOrdersState] = useState<ExpandedOrder[]>(initial.completed)
  const [isActiveLoaded, setIsActiveLoaded] = useState(initial.active.length > 0)
  const [isCompletedLoaded, setIsCompletedLoaded] = useState(initial.completed.length > 0)
  const [isLoadingActive, setIsLoadingActive] = useState(false)
  const [isLoadingCompleted, setIsLoadingCompleted] = useState(false)
  const [error, setError] = useState('')

  // Mirror the bucket state in refs so synchronous code (the unified
  // `setOrders` updater, the cache-write step inside fetchBucket) can
  // read the latest values without needing functional setState gymnastics
  // or chasing stale closures.
  const activeRef = useRef<ExpandedOrder[]>(initial.active)
  const completedRef = useRef<ExpandedOrder[]>(initial.completed)

  const inFlightActive = useRef<Promise<void> | null>(null)
  const inFlightCompleted = useRef<Promise<void> | null>(null)
  // Timestamp of the most recent successful fetch per bucket. Used by
  // isFresh() to gate ensureActiveLoaded / ensureCompletedLoaded: within
  // the freshness window, calls no-op; outside, they fire a background
  // revalidate. A failed fetch leaves the previous timestamp in place —
  // a transient error doesn't invalidate cached data that was good 30s ago.
  const lastFetchedActiveAt = useRef<number | null>(null)
  const lastFetchedCompletedAt = useRef<number | null>(null)

  const persist = useCallback(() => {
    cache.current.set({ active: activeRef.current, completed: completedRef.current })
  }, [])

  const writeActive = useCallback((next: ExpandedOrder[]) => {
    activeRef.current = next
    setActiveOrdersState(next)
  }, [])

  const writeCompleted = useCallback((next: ExpandedOrder[]) => {
    completedRef.current = next
    setCompletedOrdersState(next)
  }, [])

  const fetchBucket = useCallback(
    async (status: 'active' | 'completed'): Promise<void> => {
      const setIsLoading = status === 'active' ? setIsLoadingActive : setIsLoadingCompleted
      setIsLoading(true)
      setError('')
      try {
        const response = await fetchDeduped(
          `/api/businesses/${businessId}/orders?status=${status}`
        )
        const data = await response.json()
        if (response.ok && data.success) {
          const fetched: ExpandedOrder[] = data.orders
          if (status === 'active') {
            writeActive(fetched)
            setIsActiveLoaded(true)
            lastFetchedActiveAt.current = Date.now()
          } else {
            writeCompleted(fetched)
            setIsCompletedLoaded(true)
            lastFetchedCompletedAt.current = Date.now()
          }
          persist()
        } else {
          setError(data.error || 'Failed to load orders')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load orders')
      } finally {
        setIsLoading(false)
        if (status === 'active') {
          inFlightActive.current = null
        } else {
          inFlightCompleted.current = null
        }
      }
    },
    [businessId, persist, writeActive, writeCompleted],
  )

  const ensureActiveLoaded = useCallback((): Promise<void> => {
    if (inFlightActive.current) return inFlightActive.current
    if (isFresh(lastFetchedActiveAt.current, Date.now())) return Promise.resolve()
    inFlightActive.current = fetchBucket('active')
    return isActiveLoaded ? Promise.resolve() : inFlightActive.current
  }, [isActiveLoaded, fetchBucket])

  const ensureCompletedLoaded = useCallback((): Promise<void> => {
    if (inFlightCompleted.current) return inFlightCompleted.current
    if (isFresh(lastFetchedCompletedAt.current, Date.now())) return Promise.resolve()
    inFlightCompleted.current = fetchBucket('completed')
    return isCompletedLoaded ? Promise.resolve() : inFlightCompleted.current
  }, [isCompletedLoaded, fetchBucket])

  const refetchActive = useCallback((): Promise<void> => {
    if (inFlightActive.current) return inFlightActive.current
    inFlightActive.current = fetchBucket('active')
    return inFlightActive.current
  }, [fetchBucket])

  const refetchCompleted = useCallback((): Promise<void> => {
    if (inFlightCompleted.current) return inFlightCompleted.current
    inFlightCompleted.current = fetchBucket('completed')
    return inFlightCompleted.current
  }, [fetchBucket])

  // Revalidate the active bucket on tab return — that's the bucket users
  // care about as a live "what's pending" view. The completed bucket is a
  // history view; users only land there intentionally and won't expect
  // surprise updates while they're scrolling it.
  useRevalidateOnFocus(ensureActiveLoaded)

  // Register both buckets behind one realtime key so a single
  // `callRefetch('orders')` covers any order.* event regardless of which
  // bucket the changed row currently belongs to (a receive flips an order
  // from active → completed, an edit can land in either). The registry
  // de-duplicates the simultaneous calls per the leading-edge debounce.
  const refetchAllBuckets = useCallback((): Promise<void> => {
    return Promise.all([refetchActive(), refetchCompleted()]).then(() => {})
  }, [refetchActive, refetchCompleted])
  useEffect(() => {
    return registerRefetch('orders', refetchAllBuckets)
  }, [refetchAllBuckets])

  const setOrders = useCallback((updater: OrdersUpdater) => {
    const prev = [...activeRef.current, ...completedRef.current]
    const next = typeof updater === 'function' ? updater(prev) : updater
    const nextActive: ExpandedOrder[] = []
    const nextCompleted: ExpandedOrder[] = []
    for (const order of next) {
      if (isReceived(order)) {
        nextCompleted.push(order)
      } else {
        nextActive.push(order)
      }
    }
    writeActive(nextActive)
    writeCompleted(nextCompleted)
    persist()
  }, [persist, writeActive, writeCompleted])

  const orders = useMemo(
    () => [...activeOrders, ...completedOrders],
    [activeOrders, completedOrders],
  )

  const value = useMemo<OrdersContextValue>(
    () => ({
      orders,
      setOrders,
      isActiveLoaded,
      isCompletedLoaded,
      isLoadingActive,
      isLoadingCompleted,
      error,
      ensureActiveLoaded,
      ensureCompletedLoaded,
      refetchActive,
      refetchCompleted,
    }),
    [
      orders,
      setOrders,
      isActiveLoaded,
      isCompletedLoaded,
      isLoadingActive,
      isLoadingCompleted,
      error,
      ensureActiveLoaded,
      ensureCompletedLoaded,
      refetchActive,
      refetchCompleted,
    ],
  )

  return (
    <OrdersContext.Provider value={value}>
      {children}
    </OrdersContext.Provider>
  )
}
