'use client'

import { useIntl } from 'react-intl'
import type { Product } from '@kasero/shared/types'

interface InventoryListItemProps {
  product: Product
  onAdjust: (product: Product) => void
}

/**
 * Inventory ledger row — two columns.
 *
 *   Mocha                                    ╭─────╮
 *   KSR-7G8Z…                                │ 50  │
 *                                            ╰─────╯
 *
 * Left: Fraunces italic product name + optional mono SKU.
 * Right: an outline pill carrying the stock count. The pill itself is
 * the stock affordance — border + number color shift by stock state
 * (ink default, saffron for low, oxblood for out, tertiary dash for
 * untracked). Tapping the row opens AdjustStockModal.
 *
 * Pattern lifted from Shopify's inventory list (Mobbin reference).
 */
export function InventoryListItem({ product, onAdjust }: InventoryListItemProps) {
  const t = useIntl()

  const stockValue = product.stock ?? 0
  const threshold = product.lowStockThreshold ?? 10
  const isUntracked = product.stock == null
  const isZero = !isUntracked && stockValue === 0
  const isLowStock = !isUntracked && stockValue > 0 && stockValue <= threshold

  const stockState: 'untracked' | 'out' | 'low' | 'in-stock' = isUntracked
    ? 'untracked'
    : isZero
    ? 'out'
    : isLowStock
    ? 'low'
    : 'in-stock'

  const ariaState =
    stockState === 'out'
      ? t.formatMessage({ id: 'inventory.row_aria_state_out' })
      : stockState === 'low'
      ? t.formatMessage({ id: 'inventory.row_aria_state_low' })
      : t.formatMessage({ id: 'inventory.row_aria_state_ok' })

  const ariaLabel = t.formatMessage(
    { id: 'inventory.row_aria_label' },
    { name: product.name, stock: stockValue, state: ariaState }
  )

  const isActive = product.active

  const statusLabel =
    stockState === 'out'
      ? t.formatMessage({ id: 'inventory.row_status_out' })
      : stockState === 'low'
      ? t.formatMessage({ id: 'inventory.row_status_low' })
      : stockState === 'untracked'
      ? t.formatMessage({ id: 'inventory.row_status_untracked' })
      : t.formatMessage({ id: 'inventory.row_status_ok' })

  return (
    <button
      type="button"
      onClick={() => onAdjust(product)}
      aria-label={ariaLabel}
      className={`inventory-row${!isActive ? ' inventory-row--inactive' : ''}`}
      data-state={stockState}
    >
      <div className="inventory-row__body">
        <h3 className="inventory-row__name">{product.name}</h3>
        <span className="inventory-row__status" data-state={stockState}>
          {statusLabel}
        </span>
      </div>

      <span className="inventory-row__pill" data-state={stockState} aria-hidden="true">
        {isUntracked ? '—' : stockValue}
      </span>
    </button>
  )
}
