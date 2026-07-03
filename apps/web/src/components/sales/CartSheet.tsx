'use client'

import { useIntl } from 'react-intl'
import { useState } from 'react'
import { ShoppingCart } from 'lucide-react'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'
import type { UseCartResult } from '@/hooks/useCart'
import { ViewCartModal } from '@/components/sales/ViewCartModal'

interface CartSheetProps {
  cart: UseCartResult
}

/**
 * Persistent terracotta pill FAB anchored to the bottom of the POS
 * workspace. Shows item count + running total in mono. Disabled state
 * is a flat ghost — same shape, no shadow lift — so the "alive" cue
 * only fires when there's something to charge.
 *
 * Anchoring lives in `.cart-fab` (absolute) and the host container in
 * SalesView is `relative`, so the pill floats above the product grid
 * scroll without forcing it to reserve bottom padding.
 */
export function CartSheet({ cart }: CartSheetProps) {
  const t = useIntl()
  const { formatCurrency } = useBusinessFormat()
  const [open, setOpen] = useState(false)

  const itemCount = cart.lines.reduce((acc, l) => acc + l.quantity, 0)
  const isEmpty = cart.lines.length === 0

  return (
    <>
      <div className="cart-fab">
        <button
          type="button"
          className="cart-fab__pill"
          disabled={isEmpty}
          data-haptic
          onClick={() => {
            setOpen(true)
          }}
          aria-label={t.formatMessage(
            { id: 'sales.cart.view_cart' },
            { count: itemCount },
          )}
        >
          <ShoppingCart className="cart-fab__icon" size={18} strokeWidth={2} />
          <span className="cart-fab__label">
            {t.formatMessage({ id: 'sales.cart.fab_label' })}
          </span>
          <span className="cart-fab__separator" aria-hidden="true">·</span>
          <span className="cart-fab__count">{itemCount}</span>
          <span className="cart-fab__separator" aria-hidden="true">·</span>
          <span className="cart-fab__total">{formatCurrency(cart.total)}</span>
        </button>
      </div>
      <ViewCartModal
        isOpen={open}
        onClose={() => setOpen(false)}
        cart={cart}
      />
    </>
  )
}
