'use client'

import { useIntl } from 'react-intl'
import Image from '@/lib/Image'
import { memo, useEffect, useMemo, useState, type MouseEvent } from 'react'
import { Loader2, Minus, Package, Plus, ScanLine, SearchX, X } from 'lucide-react'
import { useIonRouter, useIonToast } from '@ionic/react'
import { useBusiness } from '@/contexts/business-context'
import { useProducts } from '@/contexts/products-context'
import { useBarcodeScan } from '@/hooks/useBarcodeScan'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'
import { getProductIconUrl } from '@/lib/utils'
import { isPresetIcon, getPresetIcon } from '@/lib/preset-icons'
import type { Product } from '@kasero/shared/types'
import type { UseCartResult } from '@/hooks/useCart'

interface ProductPickerProps {
  cart: UseCartResult
}


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

/**
 * POS product picker. Search + scan row at the top, then a 2-column
 * grid of product tiles. A tile shows the product name, mono price,
 * and an inline qty stepper revealed once the line is in the cart.
 * Tile classes live in sales-tab.css and follow the Modern Mercantile
 * tile vocabulary: terracotta selected border + cream tint, soft
 * scale-down on press, "n LEFT" mono chip when stock < 10.
 */
export function ProductPicker({ cart }: ProductPickerProps) {
  const t = useIntl()
  const { business } = useBusiness()
  const { products, ensureLoaded } = useProducts()
  const { formatCurrency } = useBusinessFormat()
  const ionRouter = useIonRouter()
  const [presentToast] = useIonToast()
  const [search, setSearch] = useState('')

  // Non-blocking POS feedback. window.alert() froze the sell loop mid-
  // rush; a short brand-styled toast (styled via .kasero-toast in
  // ionic-theme.css) keeps the cashier's hands on the grid.
  const showPosToast = (
    id: 'sales.cart.out_of_stock' | 'sales.toast.no_barcode_match',
  ) => {
    void presentToast({
      message: t.formatMessage({ id }),
      duration: 2200,
      position: 'top',
      cssClass: 'kasero-toast',
    })
  }

  useEffect(() => {
    void ensureLoaded()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const visibleProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products
      .filter((p) => p.active !== false)
      .filter((p) => (q ? p.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [products, search])

  const qtyMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const line of cart.lines) m.set(line.productId, line.quantity)
    return m
  }, [cart.lines])

  // Look up a product by barcode and add it to the cart. cart.addLine
  // increments qty for an existing line, so a repeat scan of the same
  // code naturally bumps the count. Stock-aware: scans for out-of-
  // stock products or already-at-max-qty are rejected.
  const handleScanResult = async (result: { value: string }) => {
    if (!business?.id) return
    try {
      const url = `/api/businesses/${business.id}/products?barcode=${encodeURIComponent(result.value)}`
      const res = await fetch(url)
      const data = await res.json()
      if (res.ok && data.success && data.product) {
        const product = data.product as Product
        const stock = product.stock ?? 0
        const current = cart.lines.find((l) => l.productId === product.id)?.quantity ?? 0
        if (stock <= 0 || current >= stock) {
          showPosToast('sales.cart.out_of_stock')
          return
        }
        cart.addLine(product)
        return
      }
    } catch {
      /* fall through to no-match */
    }
    showPosToast('sales.toast.no_barcode_match')
  }

  const { open: openScanner, busy: scanBusy, hiddenInput: scanHiddenInput } =
    useBarcodeScan({
      onResult: handleScanResult,
      onError: () => showPosToast('sales.toast.no_barcode_match'),
    })

  const isSearching = search.trim().length > 0
  const hasResults = visibleProducts.length > 0

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3">
        {/* Search + scan row — same .app-search vocabulary as the Hub. */}
        <div className="pos-search-row">
          <label className="app-search">
            <span className="app-search__icon">{SearchIcon}</span>
            <input
              type="search"
              className="app-search__input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.formatMessage({ id: 'sales.search_placeholder' })}
              aria-label={t.formatMessage({ id: 'sales.search_placeholder' })}
              autoComplete="off"
              spellCheck={false}
            />
            {search && (
              <button
                type="button"
                className="app-search__clear"
                onClick={() => setSearch('')}
                aria-label={t.formatMessage({ id: 'products.search_clear' })}
              >
                <X />
              </button>
            )}
          </label>
          <button
            type="button"
            className="tools-button"
            onClick={openScanner}
            disabled={scanBusy}
            aria-label={t.formatMessage({ id: 'sales.scan_barcode_aria' })}
          >
            {scanBusy ? (
              <Loader2 className="animate-spin" size={18} strokeWidth={1.8} />
            ) : (
              <ScanLine size={18} strokeWidth={1.8} />
            )}
          </button>
          {scanHiddenInput}
        </div>

        {hasResults ? (
          <div className="product-grid stagger-children">
            {visibleProducts.map((product) => (
              <ProductTile
                key={product.id}
                product={product}
                qty={qtyMap.get(product.id) ?? 0}
                addLine={cart.addLine}
                removeLine={cart.removeLine}
                updateQty={cart.updateQty}
                formatCurrency={formatCurrency}
                t={t}
              />
            ))}
          </div>
        ) : (
          <div className="pos-empty">
            <SearchX className="pos-empty__icon" />
            <h3 className="pos-empty__title">
              {isSearching
                ? t.formatMessage({ id: 'sales.search_no_results_title' })
                : t.formatMessage({ id: 'sales.empty_state.no_products_title' })}
            </h3>
            <p className="pos-empty__desc">
              {isSearching
                ? t.formatMessage({ id: 'sales.search_no_results_desc' }, { query: search.trim() })
                : t.formatMessage({ id: 'sales.empty_state.no_products_desc' })}
            </p>
            {!isSearching && business?.id && (
              <button
                type="button"
                className="pos-empty__cta"
                onClick={() => ionRouter.push(`/${business.id}/products`, 'forward', 'push')}
              >
                <Plus size={14} strokeWidth={2.5} />
                {t.formatMessage({ id: 'sales.empty_state.no_products_cta' })}
              </button>
            )}
          </div>
        )}

        {/* Sentinel: clears the cart FAB so the last row isn't occluded. */}
        <div aria-hidden="true" className="product-grid-sentinel" />
      </div>
    </div>
  )
}

interface ProductTileProps {
  product: Product
  qty: number
  addLine: UseCartResult['addLine']
  removeLine: UseCartResult['removeLine']
  updateQty: UseCartResult['updateQty']
  formatCurrency: (n: number) => string
  t: ReturnType<typeof useIntl>
}

// Memoized: the POS grid re-renders on every cart change, but only the
// tile whose qty changed gets new props — the cart callbacks are
// useCallback-stable and product references are stable across cart
// mutations, so untouched tiles skip re-rendering entirely.
const ProductTile = memo(function ProductTile({
  product,
  qty,
  addLine,
  removeLine,
  updateQty,
  formatCurrency,
  t,
}: ProductTileProps) {
  const stockTotal = product.stock ?? 0
  const outOfStock = stockTotal <= 0
  const isSelected = qty > 0
  const atMaxQty = qty >= stockTotal
  const iconUrl = getProductIconUrl(product)

  const handleToggle = () => {
    if (outOfStock) return
    if (isSelected) removeLine(product.id)
    else addLine(product)
  }
  const handleKey = (e: React.KeyboardEvent) => {
    if (outOfStock) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleToggle()
    }
  }

  const tileClass = [
    'product-tile',
    isSelected ? 'product-tile--selected' : '',
    outOfStock ? 'product-tile--sold-out' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      role="button"
      aria-pressed={isSelected}
      aria-disabled={outOfStock}
      tabIndex={outOfStock ? -1 : 0}
      onClick={handleToggle}
      onKeyDown={handleKey}
      className={tileClass}
      // Haptic on the core sell loop — HapticFeedbackProvider picks this
      // up via its [data-haptic] allow-list. Out-of-stock tiles are
      // silenced by the provider's aria-disabled opt-out check.
      data-haptic
    >
      <div className="product-tile__head">
        <div
          className={`product-list-image product-tile__icon${
            iconUrl && !isPresetIcon(iconUrl) ? ' product-tile__icon--photo' : ''
          }`}
        >
          {renderProductIcon(product, iconUrl)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="product-tile__name">{product.name}</div>
          <div className="product-tile__price">{formatCurrency(product.price)}</div>
        </div>
      </div>

      <div className="product-tile__trailing">
        {outOfStock ? (
          <div className="product-tile__sold-out-stamp">
            {t.formatMessage({ id: 'sales.product.sold_out_stamp' })}
          </div>
        ) : isSelected ? (
          <div className="product-tile__qty-row">
            <QtyButton
              variant="minus"
              active={isSelected}
              disabled={!isSelected}
              ariaLabel={t.formatMessage({ id: 'sales.cart.qty_decrease' })}
              onClick={(e) => {
                e.stopPropagation()
                updateQty(product.id, qty - 1)
              }}
            >
              <Minus size={14} strokeWidth={2.5} />
            </QtyButton>
            <span className="product-tile__qty-value">{qty}</span>
            <QtyButton
              variant="plus"
              active={isSelected}
              disabled={!isSelected || atMaxQty}
              ariaLabel={t.formatMessage({ id: 'sales.cart.qty_increase' })}
              onClick={(e) => {
                e.stopPropagation()
                if (atMaxQty) return
                addLine(product)
              }}
            >
              <Plus size={14} strokeWidth={2.5} />
            </QtyButton>
          </div>
        ) : (
          <span className="product-tile__add-cta" aria-hidden="true">
            {t.formatMessage({ id: 'sales.product.add_short' })}
          </span>
        )}
      </div>
    </div>
  )
})

function renderProductIcon(product: Product, iconUrl: string | null) {
  if (iconUrl && isPresetIcon(iconUrl)) {
    const preset = getPresetIcon(iconUrl)
    return preset ? (
      <preset.icon size={24} className="text-text-primary" />
    ) : null
  }
  if (iconUrl) {
    return (
      <Image
        src={iconUrl}
        alt={product.name}
        width={40}
        height={40}
        className="product-list-image-img"
        unoptimized
      />
    )
  }
  return <Package className="w-5 h-5 text-text-tertiary" />
}

interface QtyButtonProps {
  variant: 'plus' | 'minus'
  active: boolean
  disabled: boolean
  ariaLabel: string
  onClick: (e: MouseEvent<HTMLButtonElement>) => void
  children: React.ReactNode
}

function QtyButton({ variant, active, disabled, ariaLabel, onClick, children }: QtyButtonProps) {
  return (
    <button
      type="button"
      className={`product-tile__qty-button product-tile__qty-button--${variant}${active ? ' is-active' : ''}`}
      aria-label={ariaLabel}
      disabled={disabled}
      data-haptic
      onClick={(e) => {
        onClick(e)
      }}
    >
      {children}
    </button>
  )
}
