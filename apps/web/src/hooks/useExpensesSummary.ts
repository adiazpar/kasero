'use client'

import { useIntl } from 'react-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, apiRequest } from '@/lib/api-client'
import { useApiMessage } from '@/hooks/useApiMessage'
import { isFresh } from '@/lib/freshness'
import { useRevalidateOnFocus } from '@/hooks/useRevalidateOnFocus'
import { registerRefetch } from '@/lib/realtime/refetch-registry'
import type { ExpenseSummary } from '@kasero/shared/types'
import type { ApiResponse } from '@/lib/api-client'

interface UseExpensesSummaryResult {
  summary: ExpenseSummary | null
  loading: boolean
  refresh: () => Promise<void>
}

/**
 * Fetches the current-month expenses summary for a business. Subscribes
 * to both 'expenses' and 'sales' refetch keys so any mutation on either
 * domain triggers a refresh. Stale-while-revalidate on focus.
 */
export function useExpensesSummary(businessId: string): UseExpensesSummaryResult {
  const t = useIntl()
  const translateApiMessage = useApiMessage()

  const [summary, setSummary] = useState<ExpenseSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const lastFetchedAt = useRef<number | null>(null)
  const inFlight = useRef<Promise<void> | null>(null)

  const fetchSummary = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const res = await apiRequest<ApiResponse & { data: ExpenseSummary }>(
        `/api/businesses/${businessId}/expenses/summary`
      )
      setSummary((res.data ?? null) as ExpenseSummary | null)
      lastFetchedAt.current = Date.now()
    } catch (err) {
      // Non-blocking: summary is a UI hint; log and leave stale data visible.
      if (err instanceof ApiError && err.envelope) {
        console.warn('[useExpensesSummary]', translateApiMessage(err.envelope))
      } else {
        console.warn('[useExpensesSummary]', t.formatMessage({ id: 'navigation.load_failed' }))
      }
    } finally {
      setLoading(false)
      inFlight.current = null
    }
  }, [businessId, t, translateApiMessage])

  const ensureLoaded = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current
    if (isFresh(lastFetchedAt.current, Date.now())) return Promise.resolve()
    inFlight.current = fetchSummary()
    return summary !== null ? Promise.resolve() : inFlight.current
  }, [fetchSummary, summary])

  const refresh = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current
    inFlight.current = fetchSummary()
    return inFlight.current
  }, [fetchSummary])

  useEffect(() => {
    if (!businessId) return
    void ensureLoaded()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId])

  useRevalidateOnFocus(ensureLoaded)

  // Refresh when expenses or sales change — either domain affects the net figure.
  useEffect(() => {
    const unregExpenses = registerRefetch('expenses', refresh)
    const unregSales = registerRefetch('sales', refresh)
    return () => {
      unregExpenses()
      unregSales()
    }
  }, [refresh])

  return { summary, loading, refresh }
}
