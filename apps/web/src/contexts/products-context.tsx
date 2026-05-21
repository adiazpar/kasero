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
import type { Product } from '@kasero/shared/types'

type ProductsUpdater =
  | Product[]
  | ((prev: Product[]) => Product[])

interface ProductsContextValue {
  products: Product[]
  setProducts: (updater: ProductsUpdater) => void
  isLoading: boolean
  isLoaded: boolean
  error: string
  ensureLoaded: () => Promise<void>
  refetch: () => Promise<void>
}

const ProductsContext = createContext<ProductsContextValue | null>(null)

export function useProducts(): ProductsContextValue {
  const ctx = useContext(ProductsContext)
  if (!ctx) {
    throw new Error('useProducts must be used within a ProductsProvider')
  }
  return ctx
}

interface ProductsProviderProps {
  businessId: string
  children: ReactNode
}

// Business-scoped products store. Shared across the app so navigation
// between pages doesn't trigger duplicate fetches. Lazy-loads on first
// ensureLoaded() call and persists to sessionStorage so return visits
// paint instantly.
//
// Mount this with key={businessId} so state is re-initialized when the
// user switches businesses.
export function ProductsProvider({ businessId, children }: ProductsProviderProps) {
  const cache = useRef(
    createSessionCache<Product[]>(`${CACHE_KEYS.PRODUCTS}_${businessId}`)
  )
  const [products, setProductsState] = useState<Product[]>(
    () => cache.current.get() || []
  )
  const [isLoading, setIsLoading] = useState(false)
  const [isLoaded, setIsLoaded] = useState(() => !!cache.current.get())
  const [error, setError] = useState('')
  const inFlight = useRef<Promise<void> | null>(null)
  // Timestamp of the most recent successful fetch for this context mount.
  // Used by isFresh() to gate ensureLoaded(): within the freshness window,
  // calls no-op; outside, they fire a background revalidate. A failed
  // fetch leaves the previous timestamp in place — a transient error
  // doesn't invalidate cached data that was good 30s ago.
  const lastFetchedAt = useRef<number | null>(null)

  const setProducts = useCallback((updater: ProductsUpdater) => {
    setProductsState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      cache.current.set(next)
      return next
    })
  }, [])

  const fetchProducts = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    setError('')
    try {
      const response = await fetchDeduped(
        `/api/businesses/${businessId}/products`
      )
      const data = await response.json()
      if (response.ok && data.success) {
        setProductsState(data.products)
        cache.current.set(data.products)
        setIsLoaded(true)
        lastFetchedAt.current = Date.now()
      } else {
        setError(data.error || 'Failed to load products')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load products')
    } finally {
      setIsLoading(false)
      inFlight.current = null
    }
  }, [businessId])

  // Lazy load + stale-while-revalidate.
  // - Cache present and within freshness window: no-op (data is fresh).
  // - Cache present but stale: return immediately, kick off background
  //   refetch silently. fetchDeduped collapses duplicate concurrent calls.
  // - No cache: await the fetch (consumers will see isLoading=true).
  const ensureLoaded = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current
    if (isFresh(lastFetchedAt.current, Date.now())) return Promise.resolve()
    inFlight.current = fetchProducts()
    return isLoaded ? Promise.resolve() : inFlight.current
  }, [isLoaded, fetchProducts])

  const refetch = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current
    inFlight.current = fetchProducts()
    return inFlight.current
  }, [fetchProducts])

  // When the tab/window becomes visible after being hidden, revalidate
  // (debounced inside the hook). Routes through ensureLoaded so the
  // freshness window still applies — quick alt-tabs won't refetch.
  useRevalidateOnFocus(ensureLoaded)

  // Register this context's refetch with the realtime layer so
  // product.* events published by other devices (or this one's own
  // publishing tab) trigger a refetch here. Mirrors the
  // `registerRefetch('business', ...)` wiring in business-context.tsx.
  useEffect(() => {
    return registerRefetch('products', refetch)
  }, [refetch])

  // Memoize so consumers don't re-render on every parent tick. Multiple
  // pages subscribe; the blast radius of an unmemoized value is the
  // entire business-scoped page tree.
  const value = useMemo<ProductsContextValue>(
    () => ({ products, setProducts, isLoading, isLoaded, error, ensureLoaded, refetch }),
    [products, setProducts, isLoading, isLoaded, error, ensureLoaded, refetch],
  )

  return (
    <ProductsContext.Provider value={value}>
      {children}
    </ProductsContext.Provider>
  )
}
