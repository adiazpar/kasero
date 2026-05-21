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
import { useIntl } from 'react-intl'
import { ApiError, apiPost, apiRequest } from '@/lib/api-client'
import { isFresh } from '@/lib/freshness'
import { useRevalidateOnFocus } from '@/hooks/useRevalidateOnFocus'
import { registerRefetch } from '@/lib/realtime/refetch-registry'
import { useApiMessage } from '@/hooks/useApiMessage'
import type { InventoryAdjustment } from '@kasero/shared/types'
import type { ApiResponse } from '@/lib/api-client'

export interface CreateInventoryAdjustmentInput {
  productId: string
  delta: number
  reason?: string | null
  expense?: {
    amount: number
    categoryId?: string | null
  } | null
}

interface InventoryAdjustmentsContextValue {
  adjustments: InventoryAdjustment[]
  isLoading: boolean
  isLoaded: boolean
  error: string
  ensureLoaded: () => Promise<void>
  refetch: () => Promise<void>
  create: (input: CreateInventoryAdjustmentInput) => Promise<InventoryAdjustment>
}

const InventoryAdjustmentsContext = createContext<InventoryAdjustmentsContextValue | null>(null)

export function useInventoryAdjustments(): InventoryAdjustmentsContextValue {
  const ctx = useContext(InventoryAdjustmentsContext)
  if (!ctx) {
    throw new Error('useInventoryAdjustments must be used within an InventoryAdjustmentsProvider')
  }
  return ctx
}

interface InventoryAdjustmentsProviderProps {
  businessId: string
  children: ReactNode
}

// Business-scoped inventory adjustments store. Lazy-loads the last 50
// adjustments on first ensureLoaded() call. The realtime handler fires
// refetch() on `inventory.adjusted` events so the list stays current
// without manual polling.
//
// Mount with key={businessId} so state resets when the user switches.
export function InventoryAdjustmentsProvider({
  businessId,
  children,
}: InventoryAdjustmentsProviderProps) {
  const t = useIntl()
  const translateApiMessage = useApiMessage()

  const [adjustments, setAdjustments] = useState<InventoryAdjustment[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef<Promise<void> | null>(null)
  const lastFetchedAt = useRef<number | null>(null)

  const fetchAdjustments = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    setError('')
    try {
      const res = await apiRequest<ApiResponse & { data: InventoryAdjustment[]; nextCursor: string | null }>(
        `/api/businesses/${businessId}/inventory-adjustments?limit=50`
      )
      const list = (res.data ?? []) as InventoryAdjustment[]
      setAdjustments(list)
      setIsLoaded(true)
      lastFetchedAt.current = Date.now()
    } catch (err) {
      if (err instanceof ApiError && err.envelope) {
        setError(translateApiMessage(err.envelope))
      } else {
        setError(t.formatMessage({ id: 'navigation.load_failed' }))
      }
    } finally {
      setIsLoading(false)
      inFlight.current = null
    }
  }, [businessId, t, translateApiMessage])

  const ensureLoaded = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current
    if (isFresh(lastFetchedAt.current, Date.now())) return Promise.resolve()
    inFlight.current = fetchAdjustments()
    return isLoaded ? Promise.resolve() : inFlight.current
  }, [isLoaded, fetchAdjustments])

  const refetch = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current
    inFlight.current = fetchAdjustments()
    return inFlight.current
  }, [fetchAdjustments])

  useRevalidateOnFocus(ensureLoaded)

  useEffect(() => registerRefetch('inventory-adjustments', refetch), [refetch])

  const create = useCallback(
    async (input: CreateInventoryAdjustmentInput): Promise<InventoryAdjustment> => {
      const res = await apiPost<ApiResponse & { data: { adjustment: InventoryAdjustment } }>(
        `/api/businesses/${businessId}/inventory-adjustments`,
        input as unknown as Record<string, unknown>
      )
      const created = (res.data as { adjustment: InventoryAdjustment }).adjustment
      // Realtime will fire a refetch, but optimistically prepend for instant feedback.
      setAdjustments((prev) => [created, ...prev])
      return created
    },
    [businessId]
  )

  const value = useMemo<InventoryAdjustmentsContextValue>(
    () => ({
      adjustments,
      isLoading,
      isLoaded,
      error,
      ensureLoaded,
      refetch,
      create,
    }),
    [adjustments, isLoading, isLoaded, error, ensureLoaded, refetch, create]
  )

  return (
    <InventoryAdjustmentsContext.Provider value={value}>
      {children}
    </InventoryAdjustmentsContext.Provider>
  )
}
