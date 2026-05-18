'use client'

import { useIntl } from 'react-intl';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useMemo,
  type ReactNode,
} from 'react'
import { useRouter } from '@/lib/next-navigation-shim'
import { useAuth } from './auth-context'
import { usePageTransition } from './page-transition-context'
import type { BusinessRole } from '@kasero/shared/business-role'
import { ApiError, apiRequest } from '@/lib/api-client'

// Re-export for backwards compatibility
export type { BusinessRole }

// ============================================
// TYPES
// ============================================

export interface Business {
  id: string
  name: string
  icon: string | null
  locale: string
  currency: string
}

interface BusinessContextType {
  business: Business | null
  businessId: string | null
  role: BusinessRole | null
  isLoading: boolean
  error: string | null
  // Helpers
  canManage: boolean  // owner or partner
  isOwner: boolean
  refreshBusiness: () => Promise<void>
}

// ============================================
// CONTEXT
// ============================================

const BusinessContext = createContext<BusinessContextType | null>(null)

// ============================================
// PROVIDER
// ============================================

interface BusinessProviderProps {
  children: ReactNode
  businessId: string | null
}

export function BusinessProvider({ children, businessId }: BusinessProviderProps) {
  const router = useRouter()
  const t = useIntl()
  const { user, isLoading: authLoading } = useAuth()
  const { getCachedBusiness, setCachedBusiness } = usePageTransition()
  const [business, setBusiness] = useState<Business | null>(null)
  const [role, setRole] = useState<BusinessRole | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const validateAccess = useCallback(async () => {
    if (!businessId) return
    try {
      setIsLoading(true)
      setError(null)
      const data = await apiRequest<{
        businessId: string
        businessName: string
        businessIcon?: string | null
        businessLocale?: string
        businessCurrency?: string
        role: BusinessRole
      }>(`/api/businesses/${businessId}/access`)
      setBusiness({
        id: data.businessId,
        name: data.businessName,
        icon: data.businessIcon ?? null,
        locale: data.businessLocale ?? 'en-US',
        currency: data.businessCurrency ?? 'USD',
      })
      setRole(data.role as BusinessRole)
      setCachedBusiness(data.businessId, {
        name: data.businessName,
        icon: data.businessIcon ?? null,
        locale: data.businessLocale ?? 'en-US',
        currency: data.businessCurrency ?? 'USD',
        role: data.role,
        isOwner: data.role === 'owner',
      })
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.statusCode === 404) { setError(t.formatMessage({
          id: 'business.error_not_found'
        })); router.replace('/'); return }
        if (err.statusCode === 403) { setError(t.formatMessage({
          id: 'business.error_no_access'
        })); router.replace('/'); return }
      }
      console.error('Business access validation error:', err)
      setError(t.formatMessage({
        id: 'business.error_failed_to_validate'
      }))
    } finally {
      setIsLoading(false)
    }
  }, [businessId, router, setCachedBusiness, t])

  useEffect(() => {
    // No business ID - reset state and skip validation
    if (!businessId) {
      setBusiness(null)
      setRole(null)
      setIsLoading(false)
      setError(null)
      return
    }

    // Check cache for instant display
    const cached = getCachedBusiness(businessId)
    if (cached) {
      setBusiness({
        id: businessId,
        name: cached.name,
        icon: cached.icon ?? null,
        locale: cached.locale,
        currency: cached.currency,
      })
      setRole(cached.role as BusinessRole)
      setIsLoading(false)
      // Cache hit - skip API call, server validates on actual data operations
      return
    }

    // Wait for auth to be ready
    if (authLoading) return

    // Must be authenticated
    if (!user) {
      router.replace('/')
      return
    }

    // No cache - validate business access via API
    validateAccess()
  }, [businessId, user, authLoading, router, getCachedBusiness, validateAccess])

  // ============================================
  // CONTEXT VALUE
  // ============================================

  const value = useMemo<BusinessContextType>(() => ({
    business,
    businessId: business?.id ?? null,
    role,
    isLoading: isLoading || authLoading,
    error,
    canManage: role === 'owner' || role === 'partner',
    isOwner: role === 'owner',
    refreshBusiness: validateAccess,
  }), [business, role, isLoading, authLoading, error, validateAccess])

  return (
    <BusinessContext.Provider value={value}>
      {children}
    </BusinessContext.Provider>
  )
}

// ============================================
// HOOKS
// ============================================

export function useBusiness(): BusinessContextType {
  const context = useContext(BusinessContext)
  if (!context) {
    throw new Error('useBusiness must be used within a BusinessProvider')
  }
  return context
}

/**
 * Optional version that returns null when outside BusinessProvider.
 * Useful for components that work in both hub and business contexts.
 */
export function useOptionalBusiness(): BusinessContextType | null {
  return useContext(BusinessContext)
}

/**
 * Get just the business ID (useful for API calls)
 */
export function useBusinessId(): string | null {
  const { businessId } = useBusiness()
  return businessId
}

/**
 * Get the business role
 */
export function useBusinessRole(): BusinessRole | null {
  const { role } = useBusiness()
  return role
}
