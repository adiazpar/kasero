'use client'

import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import { PackageX } from 'lucide-react'
import { useProducts } from '@/contexts/products-context'
import { InventoryListItem } from './InventoryListItem'
import { AdjustStockModal } from './AdjustStockModal'
import type { Product } from '@kasero/shared/types'

/**
 * Inventory sub-tab content.
 *
 * Lists all active products sorted by stock ASC (lowest stock first) so
 * items that need restocking surface immediately. Tapping a row opens
 * AdjustStockModal for that product.
 *
 * Empty state is shown when there are no products — the user needs to add
 * products via the Products sub-tab first.
 */
export function InventoryView() {
  const t = useIntl()
  const { products, ensureLoaded } = useProducts()

  const [adjustingProduct, setAdjustingProduct] = useState<Product | null>(null)

  useEffect(() => {
    ensureLoaded()
  }, [ensureLoaded])

  const sorted = [...products]
    .filter((p) => p.active)
    .sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0))

  if (sorted.length === 0) {
    return (
      <div className="inventory-empty">
        <PackageX size={40} className="inventory-empty__icon" aria-hidden="true" />
        <h2 className="inventory-empty__title">
          {t.formatMessage({ id: 'inventory.empty_title' })}
        </h2>
        <p className="inventory-empty__desc">
          {t.formatMessage({ id: 'inventory.empty_body' })}
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="inventory-view">
        <div className="inventory-list-card">
          {sorted.map((product) => (
            <InventoryListItem
              key={product.id}
              product={product}
              onAdjust={setAdjustingProduct}
            />
          ))}
        </div>
      </div>

      <AdjustStockModal
        product={adjustingProduct}
        onClose={() => setAdjustingProduct(null)}
      />
    </>
  )
}
