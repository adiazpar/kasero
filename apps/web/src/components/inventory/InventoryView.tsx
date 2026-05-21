'use client'

import { useEffect, useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { ArrowUpDown, PackageOpen } from 'lucide-react'
import { useProducts } from '@/contexts/products-context'
import { useProductSettings } from '@/contexts/product-settings-context'
import { sortProducts } from '@/lib/products'
import { InventoryListItem } from './InventoryListItem'
import type { Product, SortPreference } from '@kasero/shared/types'

type InventoryFilter = 'all' | 'low' | 'out'

const FILTER_STORAGE_KEY = 'kasero.inventory.filter'

const SORT_LABEL_KEY = {
  name_asc: 'products.sort_name_asc',
  name_desc: 'products.sort_name_desc',
  price_asc: 'products.sort_price_asc',
  price_desc: 'products.sort_price_desc',
  stock_asc: 'products.sort_stock_asc',
  stock_desc: 'products.sort_stock_desc',
  category: 'products.sort_category',
} as const satisfies Record<SortPreference, string>

function readPersistedFilter(): InventoryFilter {
  if (typeof window === 'undefined') return 'all'
  try {
    const raw = window.sessionStorage.getItem(FILTER_STORAGE_KEY)
    if (raw === 'low' || raw === 'out' || raw === 'all') return raw
  } catch {
    /* ignore */
  }
  return 'all'
}

function writePersistedFilter(value: InventoryFilter) {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(FILTER_STORAGE_KEY, value)
  } catch {
    /* ignore */
  }
}

function isLowProduct(product: Product): boolean {
  const stock = product.stock ?? 0
  return (
    stock > 0 &&
    product.lowStockThreshold != null &&
    stock <= product.lowStockThreshold
  )
}

function isOutProduct(product: Product): boolean {
  return product.stock != null && product.stock <= 0
}

interface InventoryViewProps {
  /** Lifted by ProductsView so a single AdjustStockModal mount serves
   * both the Inventory tab and the Products tab's swipe / Review entry
   * points. */
  onAdjustStock: (product: Product) => void
}

/**
 * Inventory sub-tab.
 *
 * Layout:
 *   - Tally pill above the card (search-bar-shaped, clickable count
 *     segments for `all` / `low` / `out`).
 *   - Card with a thin sort-context strip + newspaper column header
 *     (PRODUCT / ON HAND), then hairline-divided rows.
 *   - Each row: Fraunces italic name on the left, outline-pill stock
 *     count on the right (Shopify-inspired pattern, see Mobbin reference).
 *
 * Sort order mirrors the Products tab's `settings.sortPreference` so
 * both surfaces present the catalog in the same order.
 */
export function InventoryView({ onAdjustStock }: InventoryViewProps) {
  const t = useIntl()
  const { products, ensureLoaded } = useProducts()
  const { categories, settings } = useProductSettings()

  const [filter, setFilter] = useState<InventoryFilter>(() => readPersistedFilter())

  useEffect(() => {
    ensureLoaded()
  }, [ensureLoaded])

  useEffect(() => {
    writePersistedFilter(filter)
  }, [filter])

  const activeProducts = useMemo(() => products.filter((p) => p.active), [products])
  const lowCount = useMemo(
    () => activeProducts.filter(isLowProduct).length,
    [activeProducts]
  )
  const outCount = useMemo(
    () => activeProducts.filter(isOutProduct).length,
    [activeProducts]
  )
  const totalCount = activeProducts.length

  const sortPref: SortPreference = settings?.sortPreference ?? 'name_asc'
  const sortLabel = t.formatMessage({ id: SORT_LABEL_KEY[sortPref] })

  const filtered = useMemo(() => {
    const subset =
      filter === 'low'
        ? activeProducts.filter(isLowProduct)
        : filter === 'out'
        ? activeProducts.filter(isOutProduct)
        : activeProducts
    return sortProducts(subset, sortPref, categories)
  }, [activeProducts, filter, sortPref, categories])

  if (totalCount === 0) {
    return (
      <div className="inventory-empty">
        <PackageOpen size={40} className="inventory-empty__icon" aria-hidden="true" />
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
    <div className="inventory-view">
      {/* Tally pill — search-bar-shaped, clickable count segments. */}
      <div className="inventory-tools-row">
        <div
          role="tablist"
          aria-label={t.formatMessage({ id: 'inventory.filter_aria' })}
          className="inventory-tally-pill"
        >
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'all'}
            className="inventory-tally-pill__segment"
            onClick={() => setFilter('all')}
          >
            <span className="inventory-tally-pill__label">
              {t.formatMessage({ id: 'inventory.header_on_hand' })}
            </span>
          </button>
          {(lowCount > 0 || filter === 'low') && (
            <>
<button
                type="button"
                role="tab"
                aria-selected={filter === 'low'}
                className="inventory-tally-pill__segment inventory-tally-pill__segment--low"
                onClick={() => setFilter(filter === 'low' ? 'all' : 'low')}
              >
                <span className="inventory-tally-pill__count">{lowCount}</span>
                <span className="inventory-tally-pill__label">
                  {t.formatMessage({ id: 'inventory.header_low' })}
                </span>
              </button>
            </>
          )}
          {(outCount > 0 || filter === 'out') && (
            <>
<button
                type="button"
                role="tab"
                aria-selected={filter === 'out'}
                className="inventory-tally-pill__segment inventory-tally-pill__segment--out"
                onClick={() => setFilter(filter === 'out' ? 'all' : 'out')}
              >
                <span className="inventory-tally-pill__count">{outCount}</span>
                <span className="inventory-tally-pill__label">
                  {t.formatMessage({ id: 'inventory.header_out' })}
                </span>
              </button>
            </>
          )}
        </div>
      </div>

      <div className="inventory-ledger">
        {/* Card header — reserved for bulk actions (future). For now
            carries a thin sort-context strip so users see why the list
            is ordered the way it is, and which Products-tab setting
            drives it. */}
        <div className="inventory-ledger__header inventory-ledger__header--context">
          <span className="inventory-sort-strip" aria-live="polite">
            <ArrowUpDown size={12} aria-hidden="true" />
            <span className="inventory-sort-strip__label">
              {t.formatMessage(
                { id: 'inventory.sort_strip' },
                { sort: sortLabel }
              )}
            </span>
          </span>
        </div>

        {/* Newspaper column header — mono uppercase tracked labels, no
            divider, sets the column structure for the rows below. */}
        <div className="inventory-columns" role="presentation">
          <span className="inventory-columns__label">
            {t.formatMessage({ id: 'inventory.column_product' })}
          </span>
          <span className="inventory-columns__label inventory-columns__label--right">
            {t.formatMessage({ id: 'inventory.column_on_hand' })}
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="inventory-ledger__empty">
            {t.formatMessage({ id: 'inventory.filter_empty' })}
          </div>
        ) : (
          <ul className="inventory-ledger__list inventory-ledger__list--inventory">
            {filtered.map((product) => (
              <li key={product.id} className="inventory-ledger__row">
                <InventoryListItem product={product} onAdjust={onAdjustStock} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
