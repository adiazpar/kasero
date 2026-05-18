'use client'

import { useIntl } from 'react-intl';
import { useState, useCallback, useEffect } from 'react'
import { apiPost, ApiError, ApiResponse } from '@/lib/api-client'
import { useApiMessage } from '@/hooks/useApiMessage'
import { getCurrencyForLocale, getLocaleByCountryCode } from '@kasero/shared/locale-config'

interface CreateBusinessResponse extends ApiResponse {
  business?: {
    id: string
    name: string
  }
}

interface BusinessFormData {
  name: string
  locale: string
  currency: string
  icon: string | null
  logoFile: File | null
  logoPreview: string | null
}

export interface UseCreateBusinessReturn {
  // Modal state
  isOpen: boolean
  handleOpen: () => void
  handleClose: () => void
  handleExitComplete: () => void

  // Form data
  formData: BusinessFormData
  setName: (name: string) => void
  setLocale: (locale: string) => void
  setIcon: (icon: string | null) => void
  setLogoFile: (file: File | null) => void
  clearLogo: () => void

  // Submit state
  isCreating: boolean
  createSuccess: boolean
  error: string | null
  createdBusiness: { id: string; name: string } | null

  // Validation
  isNameValid: boolean
  isLocaleValid: boolean

  // Actions
  handleCreateBusiness: () => Promise<boolean>
}

function getInitialFormData(): BusinessFormData {
  return {
    name: '',
    locale: 'en-US',
    currency: 'USD',
    icon: null,
    logoFile: null,
    logoPreview: null,
  }
}

// Session-scoped geolocation cache. The user's physical location doesn't
// change mid-session, so we only hit /api/geolocation once per page load.
let cachedGeolocation: { country?: string } | null = null

export function useCreateBusiness(): UseCreateBusinessReturn {
  const t = useIntl()
  const translateApiMessage = useApiMessage()
  // Modal state
  const [isOpen, setIsOpen] = useState(false)

  // Form data
  const [formData, setFormData] = useState<BusinessFormData>(getInitialFormData)

  // Submit state
  const [isCreating, setIsCreating] = useState(false)
  const [createSuccess, setCreateSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdBusiness, setCreatedBusiness] = useState<{ id: string; name: string } | null>(null)

  // Auto-update currency when locale changes
  useEffect(() => {
    setFormData(prev => ({
      ...prev,
      currency: getCurrencyForLocale(formData.locale),
    }))
  }, [formData.locale])

  // Validation
  const isNameValid = formData.name.trim().length > 0
  const isLocaleValid = formData.locale.length > 0 && formData.currency.length > 0

  const resetState = useCallback(() => {
    setFormData(getInitialFormData())
    setError(null)
    setIsCreating(false)
    setCreateSuccess(false)
    setCreatedBusiness(null)
  }, [])

  const handleOpen = useCallback(async () => {
    resetState()
    setIsOpen(true)

    // Fetch geolocation to set locale defaults (cached for the session)
    if (!cachedGeolocation) {
      try {
        const res = await fetch('/api/geolocation')
        if (res.ok) {
          cachedGeolocation = await res.json()
        }
      } catch {
        // Silently fail - defaults will be used, retry on next open
      }
    }

    if (cachedGeolocation?.country) {
      const locale = getLocaleByCountryCode(cachedGeolocation.country)
      if (locale) {
        setFormData(prev => ({
          ...prev,
          locale: locale.code,
          currency: locale.currency,
        }))
      }
    }
  }, [resetState])

  const handleClose = useCallback(() => {
    setIsOpen(false)
  }, [])

  const handleExitComplete = useCallback(() => {
    resetState()
  }, [resetState])

  // Form setters
  const setName = useCallback((name: string) => {
    setFormData(prev => ({ ...prev, name }))
  }, [])

  const setLocale = useCallback((locale: string) => {
    setFormData(prev => ({ ...prev, locale }))
    // Currency will auto-update via useEffect
  }, [])

  const setIcon = useCallback((icon: string | null) => {
    // When selecting an emoji, clear the logo
    setFormData(prev => ({
      ...prev,
      icon,
      logoFile: null,
      logoPreview: null,
    }))
  }, [])

  const setLogoFile = useCallback((file: File | null) => {
    if (file) {
      // Create preview URL and convert to base64
      const reader = new FileReader()
      reader.onloadend = () => {
        const base64 = reader.result as string
        setFormData(prev => ({
          ...prev,
          logoFile: file,
          logoPreview: base64,
          icon: base64, // Store base64 as icon for submission
        }))
      }
      reader.readAsDataURL(file)
    } else {
      setFormData(prev => ({
        ...prev,
        logoFile: null,
        logoPreview: null,
      }))
    }
  }, [])

  const clearLogo = useCallback(() => {
    setFormData(prev => ({
      ...prev,
      logoFile: null,
      logoPreview: null,
      icon: null,
    }))
  }, [])

  const handleCreateBusiness = useCallback(async (): Promise<boolean> => {
    if (!isNameValid || !isLocaleValid) {
      setError(t.formatMessage({
        id: 'createBusiness.error_all_fields_required'
      }))
      return false
    }

    setIsCreating(true)
    setError(null)

    try {
      const data = await apiPost<CreateBusinessResponse>('/api/businesses/create', {
        name: formData.name.trim(),
        locale: formData.locale,
        currency: formData.currency,
        icon: formData.icon,
      })

      if (data.success && data.business) {
        setCreatedBusiness(data.business)
        setCreateSuccess(true)
        setIsCreating(false)
        return true
      } else {
        setError(t.formatMessage({
          id: 'createBusiness.error_failed_to_create'
        }))
        setIsCreating(false)
        return false
      }
    } catch (err) {
      setError(
        err instanceof ApiError && err.envelope
          ? translateApiMessage(err.envelope)
          : t.formatMessage({
          id: 'createBusiness.error_failed_to_create'
        })
      )
      setIsCreating(false)
      return false
    }
  }, [formData, isNameValid, isLocaleValid, t, translateApiMessage])

  return {
    // Modal state
    isOpen,
    handleOpen,
    handleClose,
    handleExitComplete,

    // Form data
    formData,
    setName,
    setLocale,
    setIcon,
    setLogoFile,
    clearLogo,

    // Submit state
    isCreating,
    createSuccess,
    error,
    createdBusiness,

    // Validation
    isNameValid,
    isLocaleValid,

    // Actions
    handleCreateBusiness,
  }
}
