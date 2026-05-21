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
import type { Expense } from '@kasero/shared/types'
import type { ApiResponse } from '@/lib/api-client'

type ExpensesUpdater = Expense[] | ((prev: Expense[]) => Expense[])

interface CreateExpenseInput {
  amount: number
  date?: string
  categoryId?: string | null
  note?: string | null
  photoUrl?: string | null
}

interface UpdateExpenseInput {
  amount?: number
  date?: string
  categoryId?: string | null
  note?: string | null
  photoUrl?: string | null
}

interface ExpensesContextValue {
  expenses: Expense[]
  setExpenses: (updater: ExpensesUpdater) => void
  isLoading: boolean
  isLoaded: boolean
  error: string
  ensureLoaded: () => Promise<void>
  refetch: () => Promise<void>
  create: (input: CreateExpenseInput) => Promise<Expense>
  update: (id: string, input: UpdateExpenseInput) => Promise<Expense>
  remove: (id: string) => Promise<void>
}

const ExpensesContext = createContext<ExpensesContextValue | null>(null)

export function useExpenses(): ExpensesContextValue {
  const ctx = useContext(ExpensesContext)
  if (!ctx) {
    throw new Error('useExpenses must be used within an ExpensesProvider')
  }
  return ctx
}

interface ExpensesProviderProps {
  businessId: string
  children: ReactNode
}

// Business-scoped expenses store. Shared across the ledger tab surfaces
// so a create/edit on one surface is reflected everywhere without stale-
// cache bugs. Lazy-loads on first ensureLoaded() and persists to
// sessionStorage for instant return visits.
//
// Mount with key={businessId} so state is re-initialized when the user
// switches businesses.
export function ExpensesProvider({ businessId, children }: ExpensesProviderProps) {
  const t = useIntl()
  const translateApiMessage = useApiMessage()

  const cache = useRef(
    createSessionCache<Expense[]>(`${CACHE_KEYS.EXPENSES}_${businessId}`)
  )
  const [expenses, setExpensesState] = useState<Expense[]>(
    () => cache.current.get() || []
  )
  const [isLoading, setIsLoading] = useState(false)
  const [isLoaded, setIsLoaded] = useState(() => !!cache.current.get())
  const [error, setError] = useState('')
  const inFlight = useRef<Promise<void> | null>(null)
  const lastFetchedAt = useRef<number | null>(null)

  const setExpenses = useCallback((updater: ExpensesUpdater) => {
    setExpensesState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      cache.current.set(next)
      return next
    })
  }, [])

  const fetchExpenses = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    setError('')
    try {
      const res = await apiRequest<ApiResponse & { data: Expense[]; nextCursor: string | null }>(
        `/api/businesses/${businessId}/expenses?limit=100`
      )
      const list = (res.data ?? []) as Expense[]
      setExpensesState(list)
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
    inFlight.current = fetchExpenses()
    return isLoaded ? Promise.resolve() : inFlight.current
  }, [isLoaded, fetchExpenses])

  const refetch = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current
    inFlight.current = fetchExpenses()
    return inFlight.current
  }, [fetchExpenses])

  useRevalidateOnFocus(ensureLoaded)

  useEffect(() => registerRefetch('expenses', refetch), [refetch])

  const create = useCallback(async (input: CreateExpenseInput): Promise<Expense> => {
    const res = await apiPost<ApiResponse & { data: Expense }>(
      `/api/businesses/${businessId}/expenses`,
      input as unknown as Record<string, unknown>
    )
    const created = res.data as Expense
    setExpenses(prev => [created, ...prev])
    return created
  }, [businessId, setExpenses])

  const update = useCallback(async (id: string, input: UpdateExpenseInput): Promise<Expense> => {
    const res = await apiPatch<ApiResponse & { data: Expense }>(
      `/api/businesses/${businessId}/expenses/${id}`,
      input as unknown as Record<string, unknown>
    )
    const updated = res.data as Expense
    setExpenses(prev => prev.map(e => (e.id === id ? updated : e)))
    return updated
  }, [businessId, setExpenses])

  const remove = useCallback(async (id: string): Promise<void> => {
    await apiDelete(`/api/businesses/${businessId}/expenses/${id}`)
    setExpenses(prev => prev.filter(e => e.id !== id))
  }, [businessId, setExpenses])

  const value = useMemo<ExpensesContextValue>(
    () => ({
      expenses,
      setExpenses,
      isLoading,
      isLoaded,
      error,
      ensureLoaded,
      refetch,
      create,
      update,
      remove,
    }),
    [expenses, setExpenses, isLoading, isLoaded, error, ensureLoaded, refetch, create, update, remove]
  )

  return (
    <ExpensesContext.Provider value={value}>
      {children}
    </ExpensesContext.Provider>
  )
}
