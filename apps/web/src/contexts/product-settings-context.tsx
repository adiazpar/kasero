'use client'

import { useIntl } from 'react-intl';
/**
 * Product settings + categories store, shared across every page under
 * `/[businessId]/**`.
 *
 * Previously `useProductSettings` was a hook called independently by
 * `products/page.tsx` and by `useOrderFlows` (which is itself consumed
 * on multiple pages). Each call produced its own state + mount effect
 * + sessionStorage writes, so optimistic updates from one instance
 * were invisible to the other until a remount. Lifting the state into
 * a single provider keyed on `businessId` means all consumers share
 * one source of truth.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  apiRequest,
  apiPost,
  apiPatch,
  apiDelete,
  ApiError,
  type ApiResponse,
} from '@/lib/api-client'
import { useApiMessage } from '@/hooks/useApiMessage'
import { CACHE_KEYS, scopedCache } from '@/hooks/useSessionCache'
import { registerRefetch } from '@/lib/realtime/refetch-registry'
import type { ProductCategory, ProductSettings, SortPreference } from '@kasero/shared/types'

// ============================================
// SESSION CACHE
// ============================================
// Both caches go through the shared scopedCache primitive + the central
// CACHE_KEYS registry so `clearPerBusinessCaches(businessId)` (called from
// leave / delete-business / delete-account paths) drops them alongside
// PRODUCTS / PROVIDERS / ORDERS in one sweep.

function getCachedCategories(businessId: string): ProductCategory[] | null {
  return scopedCache<ProductCategory[]>(CACHE_KEYS.CATEGORIES, businessId).get()
}

function setCachedCategories(businessId: string, categories: ProductCategory[]): void {
  scopedCache<ProductCategory[]>(CACHE_KEYS.CATEGORIES, businessId).set(categories)
}

function getCachedSettings(businessId: string): ProductSettings | null {
  return scopedCache<ProductSettings>(CACHE_KEYS.PRODUCT_SETTINGS, businessId).get()
}

function setCachedSettings(businessId: string, settings: ProductSettings): void {
  scopedCache<ProductSettings>(CACHE_KEYS.PRODUCT_SETTINGS, businessId).set(settings)
}

// ============================================
// API RESPONSE TYPES
// ============================================

type CategoriesResponse = ApiResponse & {
  categories: ProductCategory[]
}

type CategoryResponse = ApiResponse & {
  category: ProductCategory
}

type SettingsResponse = ApiResponse & {
  settings: ProductSettings
}

type DeleteResponse = ApiResponse

type ReorderResponse = ApiResponse

// ============================================
// CONTEXT SHAPE
// ============================================

interface ProductSettingsValue {
  // Categories
  categories: ProductCategory[]
  isLoadingCategories: boolean
  createCategory: (name: string) => Promise<ProductCategory | null>
  updateCategory: (id: string, name: string) => Promise<ProductCategory | null>
  deleteCategory: (id: string) => Promise<boolean>
  reorderCategories: (categoryIds: string[]) => Promise<boolean>

  // Settings
  settings: ProductSettings | null
  isLoadingSettings: boolean
  updateSettings: (updates: { defaultCategoryId?: string | null; sortPreference?: SortPreference }) => Promise<ProductSettings | null>

  // Error handling
  error: string
  clearError: () => void

  // Operation states
  isCreating: boolean
  isUpdating: boolean
  isDeleting: boolean
  isSavingSettings: boolean

  // Refresh data
  refreshCategories: () => Promise<void>
  refreshSettings: () => Promise<void>
}

const ProductSettingsContext = createContext<ProductSettingsValue | null>(null)

// ============================================
// PROVIDER
// ============================================

export function ProductSettingsProvider({
  businessId,
  children,
}: {
  businessId: string
  children: React.ReactNode
}) {
  const t = useIntl()
  const translateApiMessage = useApiMessage()

  const [categories, setCategoriesState] = useState<ProductCategory[]>(() => getCachedCategories(businessId) || [])
  const [settings, setSettingsState] = useState<ProductSettings | null>(() => getCachedSettings(businessId))
  const [isLoadingCategories, setIsLoadingCategories] = useState(() => !getCachedCategories(businessId))
  const [isLoadingSettings, setIsLoadingSettings] = useState(() => !getCachedSettings(businessId))
  const [error, setError] = useState('')

  const [isCreating, setIsCreating] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isSavingSettings, setIsSavingSettings] = useState(false)

  const setCategories = useCallback(
    (updater: ProductCategory[] | ((prev: ProductCategory[]) => ProductCategory[])) => {
      setCategoriesState(prev => {
        const next = typeof updater === 'function' ? updater(prev) : updater
        setCachedCategories(businessId, next)
        return next
      })
    },
    [businessId],
  )

  const setSettings = useCallback(
    (updater: ProductSettings | null | ((prev: ProductSettings | null) => ProductSettings | null)) => {
      setSettingsState(prev => {
        const next = typeof updater === 'function' ? updater(prev) : updater
        if (next) setCachedSettings(businessId, next)
        return next
      })
    },
    [businessId],
  )

  const refreshCategories = useCallback(async () => {
    if (!businessId) return
    setIsLoadingCategories(true)
    try {
      const data = await apiRequest<CategoriesResponse>(`/api/businesses/${businessId}/categories`)
      setCategories(data.categories)
    } catch (err) {
      console.error('Error loading categories:', err)
      setError(
        err instanceof ApiError && err.envelope
          ? translateApiMessage(err.envelope)
          : t.formatMessage({
          id: 'productSettings.error_failed_to_load_categories'
        }),
      )
    } finally {
      setIsLoadingCategories(false)
    }
  }, [businessId, setCategories, t, translateApiMessage])

  const refreshSettings = useCallback(async () => {
    if (!businessId) return
    setIsLoadingSettings(true)
    try {
      const data = await apiRequest<SettingsResponse>(`/api/businesses/${businessId}/product-settings`)
      setSettings(data.settings)
    } catch (err) {
      console.error('Error loading settings:', err)
      setError(
        err instanceof ApiError && err.envelope
          ? translateApiMessage(err.envelope)
          : t.formatMessage({
          id: 'productSettings.error_failed_to_load_settings'
        }),
      )
    } finally {
      setIsLoadingSettings(false)
    }
  }, [businessId, setSettings, t, translateApiMessage])

  // Initial load — only when nothing's in the session cache. One fetch
  // per businessId for the lifetime of the provider; consumers share it.
  useEffect(() => {
    if (businessId && !getCachedCategories(businessId)) {
      refreshCategories()
    }
  }, [businessId, refreshCategories])

  useEffect(() => {
    if (businessId && !getCachedSettings(businessId)) {
      refreshSettings()
    }
  }, [businessId, refreshSettings])

  // Register refresh callbacks with the realtime layer.
  // - 'product-settings': fires on product.settings.updated events.
  // - 'categories': fires on category.created / category.updated /
  //   category.deleted / category.reordered events from other devices.
  useEffect(() => {
    return registerRefetch('product-settings', refreshSettings)
  }, [refreshSettings])

  useEffect(() => {
    return registerRefetch('categories', refreshCategories)
  }, [refreshCategories])

  const createCategory = useCallback(
    async (name: string): Promise<ProductCategory | null> => {
      setIsCreating(true)
      setError('')
      try {
        const data = await apiPost<CategoryResponse>(
          `/api/businesses/${businessId}/categories`,
          { name },
        )
        setCategories(prev => [...prev, data.category])
        return data.category
      } catch (err) {
        console.error('Error creating category:', err)
        setError(
          err instanceof ApiError && err.envelope
            ? translateApiMessage(err.envelope)
            : t.formatMessage({
            id: 'productSettings.error_failed_to_create_category'
          }),
        )
        return null
      } finally {
        setIsCreating(false)
      }
    },
    [businessId, setCategories, t, translateApiMessage],
  )

  const updateCategory = useCallback(
    async (id: string, name: string): Promise<ProductCategory | null> => {
      setIsUpdating(true)
      setError('')
      try {
        const data = await apiPatch<CategoryResponse>(
          `/api/businesses/${businessId}/categories/${id}`,
          { name },
        )
        setCategories(prev => prev.map(c => (c.id === id ? data.category : c)))
        return data.category
      } catch (err) {
        console.error('Error updating category:', err)
        setError(
          err instanceof ApiError && err.envelope
            ? translateApiMessage(err.envelope)
            : t.formatMessage({
            id: 'productSettings.error_failed_to_update_category'
          }),
        )
        return null
      } finally {
        setIsUpdating(false)
      }
    },
    [businessId, setCategories, t, translateApiMessage],
  )

  const deleteCategory = useCallback(
    async (id: string): Promise<boolean> => {
      setIsDeleting(true)
      setError('')
      try {
        await apiDelete<DeleteResponse>(`/api/businesses/${businessId}/categories/${id}`)
        setCategories(prev => prev.filter(c => c.id !== id))
        // If the deleted category was the business default, clear it locally
        // to keep the UI consistent with the server (the DELETE route nulls
        // out businesses.defaultCategoryId in the same transaction).
        if (settings?.defaultCategoryId === id) {
          setSettings(prev => (prev ? { ...prev, defaultCategoryId: null } : null))
        }
        return true
      } catch (err) {
        console.error('Error deleting category:', err)
        setError(
          err instanceof ApiError && err.envelope
            ? translateApiMessage(err.envelope)
            : t.formatMessage({
            id: 'productSettings.error_failed_to_delete_category'
          }),
        )
        return false
      } finally {
        setIsDeleting(false)
      }
    },
    [businessId, setCategories, setSettings, settings?.defaultCategoryId, t, translateApiMessage],
  )

  const reorderCategories = useCallback(
    async (categoryIds: string[]): Promise<boolean> => {
      setIsUpdating(true)
      setError('')
      const previousCategories = categories
      const reordered = categoryIds
        .map((id, index) => {
          const cat = categories.find(c => c.id === id)
          return cat ? { ...cat, sortOrder: index + 1 } : null
        })
        .filter((c): c is ProductCategory => c !== null)
      setCategories(reordered)
      try {
        await apiPost<ReorderResponse>(
          `/api/businesses/${businessId}/categories/reorder`,
          { categoryIds },
        )
        return true
      } catch (err) {
        setCategories(previousCategories)
        console.error('Error reordering categories:', err)
        setError(
          err instanceof ApiError && err.envelope
            ? translateApiMessage(err.envelope)
            : t.formatMessage({
            id: 'productSettings.error_failed_to_reorder_categories'
          }),
        )
        return false
      } finally {
        setIsUpdating(false)
      }
    },
    [businessId, categories, setCategories, t, translateApiMessage],
  )

  const updateSettings = useCallback(
    async (
      updates: { defaultCategoryId?: string | null; sortPreference?: SortPreference },
    ): Promise<ProductSettings | null> => {
      setIsSavingSettings(true)
      setError('')
      try {
        setSettings(prev => (prev ? { ...prev, ...updates } : null))
        await apiPatch<SettingsResponse>(
          `/api/businesses/${businessId}/product-settings`,
          updates,
        )
        return settings ? { ...settings, ...updates } : null
      } catch (err) {
        console.error('Error updating settings:', err)
        setError(
          err instanceof ApiError && err.envelope
            ? translateApiMessage(err.envelope)
            : t.formatMessage({
            id: 'productSettings.error_failed_to_update_settings'
          }),
        )
        return null
      } finally {
        setIsSavingSettings(false)
      }
    },
    [businessId, settings, setSettings, t, translateApiMessage],
  )

  const clearError = useCallback(() => setError(''), [])

  // Memoize the context value so consumers only re-render when something
  // they care about actually changed. Without this, every provider render
  // would rebuild the object and propagate through every consumer.
  const value = useMemo<ProductSettingsValue>(
    () => ({
      categories,
      isLoadingCategories,
      createCategory,
      updateCategory,
      deleteCategory,
      reorderCategories,
      settings,
      isLoadingSettings,
      updateSettings,
      error,
      clearError,
      isCreating,
      isUpdating,
      isDeleting,
      isSavingSettings,
      refreshCategories,
      refreshSettings,
    }),
    [
      categories,
      isLoadingCategories,
      createCategory,
      updateCategory,
      deleteCategory,
      reorderCategories,
      settings,
      isLoadingSettings,
      updateSettings,
      error,
      clearError,
      isCreating,
      isUpdating,
      isDeleting,
      isSavingSettings,
      refreshCategories,
      refreshSettings,
    ],
  )

  return (
    <ProductSettingsContext.Provider value={value}>
      {children}
    </ProductSettingsContext.Provider>
  )
}

// ============================================
// CONSUMER HOOK
// ============================================

export function useProductSettings(): ProductSettingsValue {
  const ctx = useContext(ProductSettingsContext)
  if (!ctx) {
    throw new Error(
      'useProductSettings must be used inside a ProductSettingsProvider',
    )
  }
  return ctx
}
