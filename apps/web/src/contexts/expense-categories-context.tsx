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
import { ApiError, apiPost, apiPatch, apiDelete, apiRequest } from '@/lib/api-client'
import { CACHE_KEYS, createSessionCache } from '@/hooks'
import { isFresh } from '@/lib/freshness'
import { useRevalidateOnFocus } from '@/hooks/useRevalidateOnFocus'
import { registerRefetch } from '@/lib/realtime/refetch-registry'
import { useApiMessage } from '@/hooks/useApiMessage'
import type { ExpenseCategory } from '@kasero/shared/types'
import type { ApiResponse } from '@/lib/api-client'

type CategoriesUpdater = ExpenseCategory[] | ((prev: ExpenseCategory[]) => ExpenseCategory[])

interface CreateExpenseCategoryInput {
  name: string
  sortOrder?: number
}

interface UpdateExpenseCategoryInput {
  name?: string
  sortOrder?: number
}

interface ExpenseCategoriesContextValue {
  categories: ExpenseCategory[]
  setCategories: (updater: CategoriesUpdater) => void
  isLoading: boolean
  isLoaded: boolean
  error: string
  ensureLoaded: () => Promise<void>
  refetch: () => Promise<void>
  create: (input: CreateExpenseCategoryInput) => Promise<ExpenseCategory>
  update: (id: string, input: UpdateExpenseCategoryInput) => Promise<ExpenseCategory>
  remove: (id: string) => Promise<void>
}

const ExpenseCategoriesContext = createContext<ExpenseCategoriesContextValue | null>(null)

export function useExpenseCategories(): ExpenseCategoriesContextValue {
  const ctx = useContext(ExpenseCategoriesContext)
  if (!ctx) {
    throw new Error('useExpenseCategories must be used within an ExpenseCategoriesProvider')
  }
  return ctx
}

interface ExpenseCategoriesProviderProps {
  businessId: string
  children: ReactNode
}

// Business-scoped expense-categories store. Shared across the ledger
// and expense-modal surfaces. Lazy-loads on first ensureLoaded() and
// persists to sessionStorage for instant return visits.
//
// Mount with key={businessId} so state is re-initialized when the user
// switches businesses.
export function ExpenseCategoriesProvider({ businessId, children }: ExpenseCategoriesProviderProps) {
  const t = useIntl()
  const translateApiMessage = useApiMessage()

  const cache = useRef(
    createSessionCache<ExpenseCategory[]>(`${CACHE_KEYS.EXPENSE_CATEGORIES}_${businessId}`)
  )
  const [categories, setCategoriesState] = useState<ExpenseCategory[]>(
    () => cache.current.get() || []
  )
  const [isLoading, setIsLoading] = useState(false)
  const [isLoaded, setIsLoaded] = useState(() => !!cache.current.get())
  const [error, setError] = useState('')
  const inFlight = useRef<Promise<void> | null>(null)
  const lastFetchedAt = useRef<number | null>(null)

  const setCategories = useCallback((updater: CategoriesUpdater) => {
    setCategoriesState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      cache.current.set(next)
      return next
    })
  }, [])

  const fetchCategories = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    setError('')
    try {
      const res = await apiRequest<ApiResponse & { data: ExpenseCategory[] }>(
        `/api/businesses/${businessId}/expense-categories`
      )
      const list = (res.data ?? []) as ExpenseCategory[]
      setCategoriesState(list)
      cache.current.set(list)
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
    inFlight.current = fetchCategories()
    return isLoaded ? Promise.resolve() : inFlight.current
  }, [isLoaded, fetchCategories])

  const refetch = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current
    inFlight.current = fetchCategories()
    return inFlight.current
  }, [fetchCategories])

  useRevalidateOnFocus(ensureLoaded)

  useEffect(() => registerRefetch('expense-categories', refetch), [refetch])

  const create = useCallback(async (input: CreateExpenseCategoryInput): Promise<ExpenseCategory> => {
    const res = await apiPost<ApiResponse & { data: ExpenseCategory }>(
      `/api/businesses/${businessId}/expense-categories`,
      input as unknown as Record<string, unknown>
    )
    const created = res.data as ExpenseCategory
    setCategories(prev => [...prev, created].sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
      return a.name.localeCompare(b.name)
    }))
    return created
  }, [businessId, setCategories])

  const update = useCallback(async (id: string, input: UpdateExpenseCategoryInput): Promise<ExpenseCategory> => {
    const res = await apiPatch<ApiResponse & { data: ExpenseCategory }>(
      `/api/businesses/${businessId}/expense-categories/${id}`,
      input as unknown as Record<string, unknown>
    )
    const updated = res.data as ExpenseCategory
    setCategories(prev => prev.map(c => (c.id === id ? updated : c)))
    return updated
  }, [businessId, setCategories])

  const remove = useCallback(async (id: string): Promise<void> => {
    await apiDelete(`/api/businesses/${businessId}/expense-categories/${id}`)
    setCategories(prev => prev.filter(c => c.id !== id))
  }, [businessId, setCategories])

  const value = useMemo<ExpenseCategoriesContextValue>(
    () => ({
      categories,
      setCategories,
      isLoading,
      isLoaded,
      error,
      ensureLoaded,
      refetch,
      create,
      update,
      remove,
    }),
    [categories, setCategories, isLoading, isLoaded, error, ensureLoaded, refetch, create, update, remove]
  )

  return (
    <ExpenseCategoriesContext.Provider value={value}>
      {children}
    </ExpenseCategoriesContext.Provider>
  )
}
