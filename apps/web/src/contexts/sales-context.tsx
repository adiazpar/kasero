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
import { CACHE_KEYS, scopedCache } from '@/hooks'
import { isFresh } from '@/lib/freshness'
import { useRevalidateOnFocus } from '@/hooks/useRevalidateOnFocus'
import { registerRefetch } from '@/lib/realtime/refetch-registry'
import type { Sale, SalesStats, PaymentMethod } from '@kasero/shared/types/sale'

interface SalesCacheShape {
  sales: Sale[]
  stats: SalesStats | null
  nextCursor: string | null
}

interface CommitSaleParams {
  paymentMethod: PaymentMethod
  date?: string
  notes?: string
  /** Cart-level discount as an absolute amount (server re-validates). */
  discountAmount?: number
  items: Array<{ productId: string; quantity: number }>
}

interface SalesContextValue {
  sales: Sale[]
  stats: SalesStats | null
  isLoaded: boolean
  isLoading: boolean
  error: string
  ensureLoaded: () => Promise<void>
  refetch: () => Promise<void>
  loadMore: () => Promise<void>
  commitSale: (params: CommitSaleParams) => Promise<Sale>
}

const SalesContext = createContext<SalesContextValue | null>(null)

export function useSales(): SalesContextValue {
  const ctx = useContext(SalesContext)
  if (!ctx) throw new Error('useSales must be used within a SalesProvider')
  return ctx
}

interface SalesProviderProps {
  businessId: string
  children: ReactNode
}

const PAGE_SIZE = 50

export function SalesProvider({ businessId, children }: SalesProviderProps) {
  const cache = useRef(scopedCache<SalesCacheShape>(CACHE_KEYS.SALES, businessId))
  const initial = useRef(
    cache.current.get() ?? { sales: [], stats: null, nextCursor: null },
  ).current

  const [sales, setSalesState] = useState<Sale[]>(initial.sales)
  const [stats, setStatsState] = useState<SalesStats | null>(initial.stats)
  const [, setNextCursorState] = useState<string | null>(initial.nextCursor)
  const [isLoaded, setIsLoaded] = useState(initial.sales.length > 0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const salesRef = useRef<Sale[]>(initial.sales)
  const statsRef = useRef<SalesStats | null>(initial.stats)
  const cursorRef = useRef<string | null>(initial.nextCursor)
  const inFlight = useRef<Promise<void> | null>(null)
  const lastFetchedAt = useRef<number | null>(null)

  const persist = useCallback(() => {
    cache.current.set({
      sales: salesRef.current,
      stats: statsRef.current,
      nextCursor: cursorRef.current,
    })
  }, [])

  const writeSales = useCallback((next: Sale[]) => {
    salesRef.current = next
    setSalesState(next)
  }, [])

  const writeStats = useCallback((next: SalesStats | null) => {
    statsRef.current = next
    setStatsState(next)
  }, [])

  const writeCursor = useCallback((next: string | null) => {
    cursorRef.current = next
    setNextCursorState(next)
  }, [])

  const fetchPage = useCallback(
    async ({ append }: { append: boolean }): Promise<void> => {
      setIsLoading(true)
      setError('')
      try {
        const cursorParam =
          append && cursorRef.current
            ? `&cursor=${encodeURIComponent(cursorRef.current)}`
            : ''
        const url = `/api/businesses/${businessId}/sales?include=stats&limit=${PAGE_SIZE}${cursorParam}`
        const response = await fetchDeduped(url)
        const data = await response.json()
        if (response.ok && data.success) {
          const fetched: Sale[] = data.sales
          const newCursor: string | null = data.nextCursor ?? null
          if (append) {
            writeSales([...salesRef.current, ...fetched])
          } else {
            writeSales(fetched)
          }
          if (data.stats !== undefined) writeStats(data.stats)
          writeCursor(newCursor)
          setIsLoaded(true)
          lastFetchedAt.current = Date.now()
          persist()
        } else {
          setError(data.error || 'Failed to load sales')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load sales')
      } finally {
        setIsLoading(false)
        inFlight.current = null
      }
    },
    [businessId, persist, writeSales, writeStats, writeCursor],
  )

  const ensureLoaded = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current
    if (isFresh(lastFetchedAt.current, Date.now())) return Promise.resolve()
    inFlight.current = fetchPage({ append: false })
    return isLoaded ? Promise.resolve() : inFlight.current
  }, [fetchPage, isLoaded])

  const refetch = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current
    inFlight.current = fetchPage({ append: false })
    return inFlight.current
  }, [fetchPage])

  const loadMore = useCallback((): Promise<void> => {
    if (!cursorRef.current) return Promise.resolve()
    if (inFlight.current) return inFlight.current
    inFlight.current = fetchPage({ append: true })
    return inFlight.current
  }, [fetchPage])

  useRevalidateOnFocus(ensureLoaded)

  // Register the sales refetch with the realtime layer so `sale.created`
  // events from teammates trigger a list refresh on this device.
  useEffect(() => {
    return registerRefetch('sales', refetch)
  }, [refetch])

  const commitSale = useCallback(
    async (params: CommitSaleParams): Promise<Sale> => {
      const { sale } = await apiRequest<{ sale: Sale }>(
        `/api/businesses/${businessId}/sales`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        },
      )
      // Prepend the new sale to the local list and refresh stats inline.
      writeSales([sale, ...salesRef.current])
      // Bump stats by re-fetching in the background. Cheap, single round-trip.
      void refetch()
      persist()
      return sale
    },
    [businessId, persist, refetch, writeSales],
  )

  const value = useMemo<SalesContextValue>(
    () => ({
      sales,
      stats,
      isLoaded,
      isLoading,
      error,
      ensureLoaded,
      refetch,
      loadMore,
      commitSale,
    }),
    [sales, stats, isLoaded, isLoading, error, ensureLoaded, refetch, loadMore, commitSale],
  )

  return <SalesContext.Provider value={value}>{children}</SalesContext.Provider>
}
