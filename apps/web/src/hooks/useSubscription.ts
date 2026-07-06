'use client'

import { useIntl } from 'react-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, apiRequest, apiPost, type ApiResponse } from '@/lib/api-client'
import { useApiMessage } from '@/hooks/useApiMessage'
import { CACHE_KEYS, scopedCache } from '@/hooks/useSessionCache'
import { registerRefetch } from '@/lib/realtime/refetch-registry'

export interface SubscriptionState {
  plan: 'free' | 'pro'
  /** ISO string; null = free tier or a non-expiring pro grant. */
  expiresAt: string | null
  source: 'none' | 'apple' | 'google' | 'promo'
}

interface UseSubscriptionResult {
  subscription: SubscriptionState | null
  isLoading: boolean
  refresh: () => Promise<void>
  /** Redeem a promo code. Resolves true on success (state already refreshed). */
  redeem: (code: string) => Promise<boolean>
  isRedeeming: boolean
  redeemError: string
  resetRedeemError: () => void
}

/**
 * Per-business Kasero Pro subscription state, sessionStorage
 * stale-while-revalidate: cached shape renders instantly, a background
 * GET revalidates on mount and on the realtime 'business' refetch key
 * (plan changes publish business.updated fields:['plan']).
 */
export function useSubscription(businessId: string | null): UseSubscriptionResult {
  const intl = useIntl()
  const translateApiMessage = useApiMessage()

  const cache = useMemo(
    () =>
      businessId
        ? scopedCache<SubscriptionState>(CACHE_KEYS.SUBSCRIPTION, businessId)
        : null,
    [businessId],
  )

  const [subscription, setSubscription] = useState<SubscriptionState | null>(
    () => cache?.get() ?? null,
  )
  const [isLoading, setIsLoading] = useState(subscription === null)
  const [isRedeeming, setIsRedeeming] = useState(false)
  const [redeemError, setRedeemError] = useState('')
  const inFlight = useRef<Promise<void> | null>(null)

  const fetchSubscription = useCallback(async (): Promise<void> => {
    if (!businessId) return
    try {
      const data = await apiRequest<ApiResponse & SubscriptionState>(
        `/api/businesses/${businessId}/subscription`,
      )
      const next: SubscriptionState = {
        plan: data.plan ?? 'free',
        expiresAt: data.expiresAt ?? null,
        source: data.source ?? 'none',
      }
      setSubscription(next)
      cache?.set(next)
    } catch (err) {
      // Non-blocking hint surface: keep whatever we had (cached or null).
      console.warn('[useSubscription] fetch failed:', err)
    } finally {
      setIsLoading(false)
      inFlight.current = null
    }
  }, [businessId, cache])

  const refresh = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current
    inFlight.current = fetchSubscription()
    return inFlight.current
  }, [fetchSubscription])

  // Revalidate on mount / business switch (cached copy shows meanwhile).
  useEffect(() => {
    if (!businessId) return
    setSubscription(cache?.get() ?? null)
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId])

  // Plan mutations publish business.updated fields:['plan'] — piggyback
  // on the 'business' refetch key so remote redeems update this surface.
  useEffect(() => {
    return registerRefetch('business', refresh)
  }, [refresh])

  const resetRedeemError = useCallback(() => setRedeemError(''), [])

  const redeem = useCallback(
    async (code: string): Promise<boolean> => {
      if (!businessId) return false
      setIsRedeeming(true)
      setRedeemError('')
      try {
        const data = await apiPost<ApiResponse & { plan: 'pro'; expiresAt: string | null }>(
          `/api/businesses/${businessId}/subscription/redeem`,
          { code },
        )
        const next: SubscriptionState = {
          plan: 'pro',
          expiresAt: data.expiresAt ?? null,
          source: 'promo',
        }
        setSubscription(next)
        cache?.set(next)
        return true
      } catch (err) {
        console.error('Promo redeem failed:', err)
        setRedeemError(
          err instanceof ApiError && err.envelope
            ? translateApiMessage(err.envelope)
            : intl.formatMessage({ id: 'manage.pro_error_generic' }),
        )
        return false
      } finally {
        setIsRedeeming(false)
      }
    },
    [businessId, cache, intl, translateApiMessage],
  )

  return {
    subscription,
    isLoading,
    refresh,
    redeem,
    isRedeeming,
    redeemError,
    resetRedeemError,
  }
}
