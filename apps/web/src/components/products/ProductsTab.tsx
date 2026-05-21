'use client'

import { useIntl } from 'react-intl'

import Image from '@/lib/Image'
import { Fragment, memo } from 'react'
import {
  X,
  Plus,
  ChevronUp,
  Loader2,
  Tags,
  ListFilter,
  ScanLine,
  ImagePlus,
  SlidersHorizontal,
  Printer,
  Trash2,
  Check,
  Settings2,
} from 'lucide-react'
import {
  IonItem,
  IonList,
} from '@ionic/react'
import { SwipeRow } from '@/components/ui'
import { ModalShell } from '@/components/ui'
import { printBarcodeLabel } from '@/lib/barcode-print'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'
import { getProductIconUrl } from '@/lib/utils'
import { isPresetIcon, getPresetIcon } from '@/lib/preset-icons'
import { scrollToTop } from '@/lib/scroll'
import {
  SORT_OPTIONS,
  getFilterLabel,
  type FilterCategory,
  type SortOption,
} from '@/lib/products'
import type { Product, ProductCategory, SortPreference } from '@kasero/shared/types'

const SearchIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
)

export interface ProductsTabProps {
  // Data
  products: Product[]
  filteredProducts: Product[]
  categories: ProductCategory[]
  availableFilters: string[]

  // Search state
  searchQuery: string
  onSearchChange: (query: string) => void

  // Filter state
  selectedFilter: FilterCategory
  onFilterChange: (filter: FilterCategory) => void

  // Sort state
  sortBy: SortOption
  onSortChange: (sort: SortOption) => void

  // Modal controls
  isSortSheetOpen: boolean
  onSortSheetOpenChange: (open: boolean) => void

  // Handlers
  onAddProduct: () => void
  onEditProduct: (product: Product) => void
  onViewProduct?: (product: Product) => void
  onAdjustInventory?: (product: Product) => void
  onDeleteProduct?: (product: Product) => void
  onOpenSettings: () => void

  // Permissions
  canModify?: boolean
  canManage?: boolean

  // Error state
  error?: string
  isModalOpen?: boolean

  // Scan-to-search
  onScanClick?: () => void
  scanBusy?: boolean
  scanHiddenInput?: React.ReactNode
}

export function ProductsTab({
  products,
  filteredProducts,
  categories,
  availableFilters,
  searchQuery,
  onSearchChange,
  selectedFilter,
  onFilterChange,
  sortBy,
  onSortChange,
  isSortSheetOpen,
  onSortSheetOpenChange,
  onAddProduct,
  onEditProduct,
  onViewProduct,
  onAdjustInventory,
  onDeleteProduct,
  onOpenSettings,
  canModify = false,
  canManage = false,
  error,
  isModalOpen,
  onScanClick,
  scanBusy,
  scanHiddenInput,
}: ProductsTabProps) {
  const intl = useIntl()

  const sortLabels: Record<SortPreference, string> = {
    name_asc: intl.formatMessage({ id: 'products.sort_name_asc' }),
    name_desc: intl.formatMessage({ id: 'products.sort_name_desc' }),
    price_asc: intl.formatMessage({ id: 'products.sort_price_asc' }),
    price_desc: intl.formatMessage({ id: 'products.sort_price_desc' }),
    category: intl.formatMessage({ id: 'products.sort_category' }),
    stock_asc: intl.formatMessage({ id: 'products.sort_stock_asc' }),
    stock_desc: intl.formatMessage({ id: 'products.sort_stock_desc' }),
  }

  const hasProducts = products.length > 0

  return (
    <div className="flex flex-col gap-4">
      {error && !isModalOpen && (
        <div className="products-error">{error}</div>
      )}

      {hasProducts ? (
        <>
          {/* Search + scan + sort row — same chrome family as the POS
              search row. .app-search bar grows; tools-buttons are 48px
              circles for scan and sort/filter. */}
          <div className="products-tools-row">
            <label className="app-search">
              <span className="app-search__icon">{SearchIcon}</span>
              <input
                type="search"
                className="app-search__input"
                placeholder={intl.formatMessage({ id: 'products.search_placeholder' })}
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                aria-label={intl.formatMessage({ id: 'products.search_placeholder' })}
                autoComplete="off"
                spellCheck={false}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="app-search__clear"
                  onClick={() => onSearchChange('')}
                  aria-label={intl.formatMessage({ id: 'products.search_clear' })}
                >
                  <X />
                </button>
              )}
            </label>

            {onScanClick && (
              <button
                type="button"
                className="tools-button"
                onClick={onScanClick}
                disabled={scanBusy}
                aria-label={intl.formatMessage({ id: 'products.scan_aria' })}
              >
                {scanBusy ? (
                  <Loader2 className="animate-spin" size={18} strokeWidth={1.8} />
                ) : (
                  <ScanLine size={18} strokeWidth={1.8} />
                )}
              </button>
            )}

            <button
              type="button"
              className="tools-button"
              onClick={() => onSortSheetOpenChange(true)}
              aria-label={intl.formatMessage({ id: 'products.sort_filter_aria' })}
            >
              <ListFilter size={18} strokeWidth={1.8} />
            </button>
          </div>
          {scanHiddenInput}

          {/* Inventory ledger card.
              Header row (manager-only): `+ Add` pill on the LEFT, circular
              Settings icon button on the RIGHT. The count moved out of
              the header and into the column-header strip below.
              Then a newspaper column-header strip (`{N} PRODUCTS` /
              `PRICE · STOCK`) sets the structure for the rows beneath. */}
          <div className="inventory-ledger">
            {canManage && (
              <div className="inventory-ledger__header inventory-ledger__header--bulk">
                <button
                  type="button"
                  className="inventory-ledger__add-button"
                  onClick={onAddProduct}
                >
                  <Plus size={14} strokeWidth={2.5} />
                  {intl.formatMessage({ id: 'products.add_button' })}
                </button>
                <button
                  type="button"
                  className="inventory-ledger__settings-button"
                  onClick={onOpenSettings}
                >
                  <Settings2 size={14} strokeWidth={2.5} />
                  {intl.formatMessage({ id: 'products.settings_link' })}
                </button>
              </div>
            )}

            <div className="inventory-columns" role="presentation">
              <span className="inventory-columns__label">
                {intl.formatMessage(
                  { id: 'products.column_count' },
                  { count: filteredProducts.length },
                )}
              </span>
              <span className="inventory-columns__label inventory-columns__label--right">
                {intl.formatMessage({ id: 'products.column_price_stock' })}
              </span>
            </div>

            {filteredProducts.length === 0 ? (
              <div className="inventory-ledger__empty">
                {intl.formatMessage({ id: 'products.no_results' })}
              </div>
            ) : (
              <IonList lines="none" className="inventory-ledger__list">
                {filteredProducts.map((product) => (
                  <Fragment key={product.id}>
                    <ProductListItem
                      product={product}
                      categories={categories}
                      onEdit={onEditProduct}
                      onView={onViewProduct}
                      onAdjustInventory={onAdjustInventory}
                      onDeleteProduct={onDeleteProduct}
                      canModify={canModify}
                    />
                  </Fragment>
                ))}
              </IonList>
            )}
          </div>

          {filteredProducts.length > 5 && (
            <button
              type="button"
              className="products-back-to-top"
              onClick={() => scrollToTop()}
            >
              <ChevronUp size={14} strokeWidth={2} />
              {intl.formatMessage({ id: 'products.back_to_top' })}
            </button>
          )}
        </>
      ) : (
        // Empty state — Fraunces italic title, mono caption, terracotta CTA
        <div className="products-empty">
          <Tags className="products-empty__icon" aria-hidden="true" />
          <h2 className="products-empty__title">
            {intl.formatMessage({ id: 'products.empty_state_title' })}
          </h2>
          <p className="products-empty__desc">
            {intl.formatMessage({ id: 'products.empty_state_description' })}
          </p>
          {canManage && (
            <button
              type="button"
              className="products-empty__cta"
              onClick={onAddProduct}
            >
              <Plus size={14} strokeWidth={2.5} />
              {intl.formatMessage({ id: 'products.empty_state_button' })}
            </button>
          )}
        </div>
      )}

      {/* Sort + filter sheet */}
      <ModalShell
        isOpen={isSortSheetOpen}
        onClose={() => onSortSheetOpenChange(false)}
        title={intl.formatMessage({ id: 'products.sort_filter_title' })}
        variant="half"
      >
        <div className="modal-step-item">
          <div className="sort-sheet-section">
            <span className="sort-sheet-section__label">
              {intl.formatMessage({ id: 'products.sort_by_label' })}
            </span>
            <div>
              {SORT_OPTIONS.map((option) => {
                const selected = sortBy === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onSortChange(option.value)}
                    className={`sort-sheet-row${selected ? ' sort-sheet-row--selected' : ''}`}
                  >
                    <span className="sort-sheet-row__label">
                      {sortLabels[option.value]}
                    </span>
                    {selected && (
                      <span className="sort-sheet-row__check" aria-hidden="true">
                        <Check size={18} strokeWidth={2.4} />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {availableFilters.length > 0 && (
          <div className="modal-step-item">
            <div className="sort-sheet-section">
              <span className="sort-sheet-section__label">
                {intl.formatMessage({ id: 'products.filter_by_category_label' })}
              </span>
              <div>
                <button
                  type="button"
                  onClick={() => onFilterChange('all')}
                  className={`sort-sheet-row${selectedFilter === 'all' ? ' sort-sheet-row--selected' : ''}`}
                >
                  <span className="sort-sheet-row__label">
                    {intl.formatMessage({ id: 'products.filter_all' })}
                  </span>
                  {selectedFilter === 'all' && (
                    <span className="sort-sheet-row__check" aria-hidden="true">
                      <Check size={18} strokeWidth={2.4} />
                    </span>
                  )}
                </button>
                {availableFilters.map((filter) => {
                  const selected = selectedFilter === filter
                  return (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => onFilterChange(filter)}
                      className={`sort-sheet-row${selected ? ' sort-sheet-row--selected' : ''}`}
                    >
                      <span className="sort-sheet-row__label">
                        {getFilterLabel(filter, categories)}
                      </span>
                      {selected && (
                        <span className="sort-sheet-row__check" aria-hidden="true">
                          <Check size={18} strokeWidth={2.4} />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </ModalShell>
    </div>
  )
}

interface ProductListItemProps {
  product: Product
  categories: ProductCategory[]
  onEdit: (product: Product) => void
  onView?: (product: Product) => void
  onAdjustInventory?: (product: Product) => void
  onDeleteProduct?: (product: Product) => void
  canModify?: boolean
}

const ProductListItem = memo(function ProductListItem({
  product,
  categories,
  onEdit,
  onView,
  onAdjustInventory,
  onDeleteProduct,
  canModify = false,
}: ProductListItemProps) {
  const intl = useIntl()
  const { formatCurrency } = useBusinessFormat()
  const iconUrl = getProductIconUrl(product)
  const stockValue = product.stock ?? 0
  const threshold = product.lowStockThreshold ?? 10
  const isUntracked = product.stock == null
  const isZero = !isUntracked && stockValue === 0
  const isLowStock = !isUntracked && stockValue > 0 && stockValue <= threshold
  // Stock-state token: 4-state model.
  //   UNTRACKED      — stock is null (inventory disabled for this row)
  //   IN STOCK · n   — stock > 0 (moss)
  //   LOW STOCK · n  — stock > 0 but ≤ lowStockThreshold (saffron)
  //   OUT OF STOCK   — stock === 0 AND the product has sold before (saffron)
  //   READY · SET    — stock === 0 AND the product has never sold (tertiary)
  // Splitting the zero-stock case on hasSold means a freshly-created
  // product never reads as an error (READY is calm), while a depleted
  // SKU that has actually moved units surfaces the saffron alarm so the
  // owner restocks before the next sale.
  // Stock — single "Stock · n" label across all states; color (via a 6px
  // leading dot) signals state. Drops the per-state labels (LOW STOCK,
  // OUT OF STOCK, READY · SET STOCK) — the user just wants to see the
  // count and a quick visual cue. Three color states:
  //   in-stock  (moss)     — above threshold
  //   low       (saffron)  — at or below threshold (including zero)
  //   untracked (tertiary) — stock=null, no inventory tracking
  const stockState: 'untracked' | 'out' | 'low' | 'in-stock' = isUntracked
    ? 'untracked'
    : isZero
      ? 'out'
      : isLowStock
        ? 'low'
        : 'in-stock'
  const hasBarcode = !!product.barcode
  const isActive = product.active
  // Category lookup — falls back to a "Not categorized" label when the
  // product has no categoryId or the id doesn't match any known
  // category (defensive against stale categoryIds during a delete).
  const categoryName = product.categoryId
    ? categories.find((c) => c.id === product.categoryId)?.name ?? null
    : null

  // Swipe actions render left-to-right. Same semantic contract as every
  // other list in the app: primary leftmost, secondary middle, destructive
  // rightmost — so muscle memory carries across Products, Orders,
  // Providers, etc.
  const swipeActions = canModify && onAdjustInventory && onDeleteProduct
    ? [
        {
          id: `${product.id}-inventory`,
          icon: <SlidersHorizontal size={20} />,
          label: intl.formatMessage({ id: 'products.action_inventory' }),
          variant: 'primary' as const,
          onClick: () => onAdjustInventory(product),
        },
        {
          id: `${product.id}-print`,
          icon: <Printer size={20} />,
          label: intl.formatMessage({ id: 'products.action_print' }),
          variant: 'neutral' as const,
          disabled: !hasBarcode,
          onClick: () =>
            printBarcodeLabel({
              barcode: product.barcode ?? '',
              barcodeFormat: product.barcodeFormat ?? null,
              name: product.name,
            }),
        },
        {
          id: `${product.id}-delete`,
          icon: <Trash2 size={20} />,
          label: intl.formatMessage({ id: 'products.action_delete' }),
          variant: 'danger' as const,
          onClick: () => onDeleteProduct(product),
        },
      ]
    : []

  // Tap dispatch: managers (canModify) open the edit modal; everyone
  // else gets the read-only ProductInfoDrawer. Row is always tappable.
  const activate = canModify
    ? () => onEdit(product)
    : onView
      ? () => onView(product)
      : undefined

  return (
    <SwipeRow actions={swipeActions}>
      {/* lines="none" + a custom flex layout — IonItem's slot system was
          forcing a too-tight rhythm between the name and the metadata
          rows, and pushing the icon a fixed 16px away from the price
          column. The custom row gives each metadata line proper breath
          and lets the price anchor render in italic Fraunces. */}
      <IonItem
        button={!!activate}
        detail={false}
        onClick={activate}
        lines="none"
        className="product-row-host"
      >
        <div
          className={`product-row${!isActive ? ' product-row--inactive' : ''}`}
        >
          {/* Specimen portrait — generous 64px so AI-generated custom
              icons (background-removed product photos) actually have
              room to read. Custom photos fill the tile edge-to-edge;
              preset Lucide glyphs render centered on cream paper. */}
          {/* Icon wrap — keeps `overflow: hidden` scoped to the inner
              .product-row__icon (so photos clip to the rounded tile)
              while letting the stock-state dot sit OUTSIDE the clip
              region without being trimmed. */}
          <div className="product-row__icon-wrap">
            <div
              className={`product-row__icon${
                !isActive ? ' product-row__icon--inactive' : ''
              }${
                iconUrl && !isPresetIcon(iconUrl)
                  ? ' product-row__icon--photo'
                  : ''
              }`}
            >
              {iconUrl && isPresetIcon(iconUrl) ? (
                (() => {
                  const p = getPresetIcon(iconUrl)
                  return p ? <p.icon size={32} className="text-text-primary" /> : null
                })()
              ) : iconUrl ? (
                <Image
                  src={iconUrl}
                  alt=""
                  width={64}
                  height={64}
                  className="object-cover w-full h-full"
                  unoptimized
                />
              ) : (
                <ImagePlus size={22} className="text-text-tertiary" />
              )}
            </div>
            {/* Stock-state dot — sibling of the icon tile so it lives
                outside the parent's overflow clip. */}
            {isActive && (stockState === 'low' || stockState === 'out') && (
              <span
                className={`product-row__icon-badge product-row__icon-badge--${stockState}`}
                role="img"
                aria-label={intl.formatMessage({
                  id: stockState === 'out'
                    ? 'inventory.row_status_out'
                    : 'inventory.row_status_low',
                })}
              />
            )}
          </div>

          <div className="product-row__body">
            <h3 className="product-row__name">{product.name}</h3>
            <span className="product-row__category" data-set={categoryName ? 'true' : 'false'}>
              {categoryName ?? intl.formatMessage({ id: 'products.uncategorized' })}
            </span>
          </div>

          {/* Trail anchor: italic Fraunces price + barcode caption
              beneath. Stock state is now signaled by the icon-tile
              badge + the column-header context, not a redundant
              dot+label here. */}
          <div className="product-row__trail">
            <span className="product-row__price">
              {formatCurrency(product.price)}
            </span>
            {hasBarcode && (
              <span className="product-row__barcode">{product.barcode}</span>
            )}
          </div>
        </div>
      </IonItem>
    </SwipeRow>
  )
})
