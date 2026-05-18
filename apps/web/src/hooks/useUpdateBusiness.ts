'use client'

import { useState, useCallback } from 'react'
import { apiPatchForm, ApiError } from '@/lib/api-client'
import { useApiMessage } from './useApiMessage'
import { useBusiness } from '@/contexts/business-context'
import { clearHubBusinessesCache } from './useSessionCache'

interface UpdateBusinessPayload {
  name?: string
  locale?: string
  logoFile?: File | null
  removeLogo?: boolean
}

interface UseUpdateBusinessReturn {
  update: (payload: UpdateBusinessPayload) => Promise<boolean>
  isSubmitting: boolean
  error: string
  reset: () => void
}

export function useUpdateBusiness(): UseUpdateBusinessReturn {
  const { businessId, refreshBusiness } = useBusiness()
  const translateApiMessage = useApiMessage()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  const reset = useCallback(() => setError(''), [])

  const update = useCallback(async (payload: UpdateBusinessPayload) => {
    if (!businessId) return false
    setIsSubmitting(true)
    setError('')
    try {
      const fd = new FormData()
      if (payload.name !== undefined) fd.set('name', payload.name)
      if (payload.locale !== undefined) fd.set('locale', payload.locale)
      if (payload.removeLogo) fd.set('removeLogo', 'true')
      if (payload.logoFile) fd.set('logo', payload.logoFile)

      await apiPatchForm(`/api/businesses/${businessId}`, fd)
      await refreshBusiness()
      // The hub list caches name/icon/locale for every business; any of
      // those could have just changed. Drop the hub cache so
      // the next hub render refetches fresh data instead of showing
      // the stale pre-edit values until the session ends.
      clearHubBusinessesCache()
      return true
    } catch (err) {
      console.error('Update business error:', err)
      setError(
        err instanceof ApiError && err.envelope
          ? translateApiMessage(err.envelope)
          : '',
      )
      return false
    } finally {
      setIsSubmitting(false)
    }
  }, [businessId, refreshBusiness, translateApiMessage])

  return { update, isSubmitting, error, reset }
}
