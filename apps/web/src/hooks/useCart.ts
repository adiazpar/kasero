'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CACHE_KEYS, scopedCache } from '@/hooks/useSessionCache'
import type { Product } from '@kasero/shared/types'

export interface CartLine {
  productId: string
  productName: string
  unitPrice: number
  quantity: number
}

interface CartState {
  lines: CartLine[]
}

export interface UseCartResult {
  lines: CartLine[]
  total: number
  addLine: (product: Product, quantity?: number) => void
  updateQty: (productId: string, quantity: number) => void
  removeLine: (productId: string) => void
  clear: () => void
}

const empty: CartState = { lines: [] }

/**
 * Local ephemeral cart state for the in-progress sale, scoped per business.
 * Persisted to sessionStorage so a refresh doesn't drop the cart. Survives
 * tab switches because consumers live under SalesView, which TabShell
 * keeps mounted.
 *
 * Note: `unitPrice` here is a snapshot at cart-add time. The server
 * re-snapshots prices at commit; the checkout surface is responsible
 * for surfacing any drift before the user confirms.
 */
export function useCart(businessId: string): UseCartResult {
  const cache = useRef(scopedCache<CartState>(CACHE_KEYS.SALES_CART, businessId))
  const [state, setState] = useState<CartState>(() => cache.current.get() ?? empty)

  // Persist on every state change.
  useEffect(() => {
    cache.current.set(state)
  }, [state])

  const addLine = useCallback((product: Product, quantity = 1) => {
    setState((prev) => {
      const idx = prev.lines.findIndex((l) => l.productId === product.id)
      if (idx >= 0) {
        const next = prev.lines.slice()
        next[idx] = { ...next[idx], quantity: next[idx].quantity + quantity }
        return { lines: next }
      }
      return {
        lines: [
          ...prev.lines,
          {
            productId: product.id,
            productName: product.name,
            unitPrice: product.price,
            quantity,
          },
        ],
      }
    })
  }, [])

  const updateQty = useCallback((productId: string, quantity: number) => {
    setState((prev) => {
      if (quantity <= 0) {
        return { lines: prev.lines.filter((l) => l.productId !== productId) }
      }
      return {
        lines: prev.lines.map((l) =>
          l.productId === productId ? { ...l, quantity } : l,
        ),
      }
    })
  }, [])

  const removeLine = useCallback((productId: string) => {
    setState((prev) => ({
      lines: prev.lines.filter((l) => l.productId !== productId),
    }))
  }, [])

  const clear = useCallback(() => {
    setState(empty)
  }, [])

  const total = useMemo(
    () => state.lines.reduce((acc, l) => acc + l.unitPrice * l.quantity, 0),
    [state.lines],
  )

  // Memoize the result object so consumers that receive the whole cart
  // as a prop (ProductPicker, CartModal) don't re-render on every parent
  // render — the callbacks above are already useCallback-stable.
  return useMemo(
    () => ({ lines: state.lines, total, addLine, updateQty, removeLine, clear }),
    [state.lines, total, addLine, updateQty, removeLine, clear],
  )
}
