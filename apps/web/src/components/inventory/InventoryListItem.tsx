'use client'

import { useIntl } from 'react-intl'
import { ChevronRight } from 'lucide-react'
import type { Product } from '@kasero/shared/types'

interface InventoryListItemProps {
  product: Product
  onAdjust: (product: Product) => void
}

/**
 * Single row in the Inventory sub-tab list.
 *
 * Displays product name and current stock count. Tapping the row opens
 * the AdjustStockModal for that product. Stock value uses mono numerics
 * and is colour-coded: zero = error, low threshold = warning, else primary.
 */
export function InventoryListItem({ product, onAdjust }: InventoryListItemProps) {
  const t = useIntl()

  const stock = product.stock ?? 0
  const isZero = stock <= 0
  const isLow =
    !isZero &&
    product.lowStockThreshold != null &&
    stock <= product.lowStockThreshold

  const stockClass = isZero
    ? 'inventory-row__stock-value inventory-row__stock-value--zero'
    : isLow
    ? 'inventory-row__stock-value inventory-row__stock-value--low'
    : 'inventory-row__stock-value'

  return (
    <button
      type="button"
      className="inventory-row"
      onClick={() => onAdjust(product)}
      aria-label={`${product.name} — ${t.formatMessage({ id: 'inventory.list_current_stock' })}: ${stock}`}
    >
      <div className="inventory-row__body">
        <div className="inventory-row__name">{product.name}</div>
        <div className="inventory-row__meta">
          <span className="inventory-row__stock-label">
            {t.formatMessage({ id: 'inventory.list_current_stock' })}
          </span>
          <span className={stockClass}>{stock}</span>
        </div>
      </div>
      <ChevronRight size={16} className="inventory-row__chevron" aria-hidden="true" />
    </button>
  )
}
