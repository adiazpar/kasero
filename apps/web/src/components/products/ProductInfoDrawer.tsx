'use client'

import { useCallback, useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import { useDismissOnDelete } from '@/hooks/useDismissOnDelete'
import { useResyncOnUpdate } from '@/hooks/useResyncOnUpdate'
import { useProducts } from '@/contexts/products-context'
import Image from '@/lib/Image'
import { ImagePlus } from 'lucide-react'
import { ModalShell } from '@/components/ui/modal-shell'
import { BarcodeDisplay } from './BarcodeDisplay'
import { isPresetIcon, getPresetIcon } from '@/lib/preset-icons'
import { getProductIconUrl } from '@/lib/utils'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'
import type { Product, ProductCategory, BarcodeFormat } from '@kasero/shared/types'

const BARCODE_FORMAT_LABELS: Record<BarcodeFormat, string> = {
  CODABAR: 'Codabar',
  CODE_39: 'Code 39',
  CODE_93: 'Code 93',
  CODE_128: 'Code 128',
  ITF: 'ITF',
  EAN_13: 'EAN-13',
  EAN_8: 'EAN-8',
  UPC_A: 'UPC-A',
  UPC_E: 'UPC-E',
  UPC_EAN_EXTENSION: 'UPC/EAN Extension',
}

export interface ProductInfoDrawerProps {
  isOpen: boolean
  onClose: () => void
  onExitComplete?: () => void
  product: Product | null
  categories: ProductCategory[]
}

export function ProductInfoDrawer({
  isOpen,
  onClose,
  onExitComplete: _onExitComplete,
  product,
  categories,
}: ProductInfoDrawerProps) {
  const intl = useIntl()
  const { formatCurrency, formatDate } = useBusinessFormat()
  const { products: productsList } = useProducts()

  // Mirror the incoming product prop into local state so we can resync
  // from the products context when a remote update arrives.
  const [snapshot, setSnapshot] = useState(product)
  useEffect(() => {
    setSnapshot(product)
  }, [product])

  const stableDismiss = useCallback(() => onClose(), [onClose])
  useDismissOnDelete('product', snapshot?.id ?? null, stableDismiss)

  // When a remote device updates this product, callRefetch('products') has
  // already fired in the handler before this callback runs, so productsList
  // contains the latest data. If the product was concurrently deleted, the
  // useDismissOnDelete above handles dismissal — we simply skip the resync.
  const handleProductUpdate = useCallback(() => {
    const fresh = productsList.find((p) => p.id === snapshot?.id)
    if (fresh) setSnapshot(fresh)
  }, [productsList, snapshot?.id])

  useResyncOnUpdate('product', snapshot?.id ?? null, handleProductUpdate)

  // Render nothing if no product is set. The parent's open-state is
  // typically gated on `!!product`, so this branch only fires during the
  // brief window between close and onExitComplete-cleanup.
  if (!snapshot) return null

  const iconUrl = getProductIconUrl(snapshot)
  const categoryName =
    categories.find((c) => c.id === snapshot.categoryId)?.name ??
    intl.formatMessage({ id: 'products.uncategorized' })
  const formatLabel = snapshot.barcodeFormat
    ? BARCODE_FORMAT_LABELS[snapshot.barcodeFormat]
    : null

  const stockValue = snapshot.stock ?? 0
  const threshold = snapshot.lowStockThreshold ?? 10
  const hasStock = snapshot.stock !== null && snapshot.stock !== undefined
  const isLowStock = hasStock && stockValue <= threshold
  const isActive = snapshot.active

  const stockDisplay = hasStock
    ? intl.formatMessage({ id: 'products.units_count' }, { count: stockValue })
    : intl.formatMessage({ id: 'products.info_drawer_stock_untracked' })

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={intl.formatMessage({ id: 'products.info_drawer_title' })}
    >
      <article className="info-drawer">
        {/* Hero — large product photo / icon, eyebrow with category, and
            the product name in italic Fraunces. The "stamped catalog
            card" voice begins here. */}
        <header className="info-drawer__hero">
          <div className="info-drawer__portrait" aria-hidden="true">
            {iconUrl && isPresetIcon(iconUrl) ? (
              (() => {
                const p = getPresetIcon(iconUrl)
                return p ? (
                  <p.icon size={120} className="info-drawer__portrait-icon" />
                ) : null
              })()
            ) : iconUrl ? (
              <Image
                src={iconUrl}
                alt={snapshot.name}
                width={224}
                height={224}
                className="info-drawer__portrait-img"
                unoptimized
              />
            ) : (
              <ImagePlus className="info-drawer__portrait-fallback" />
            )}
          </div>

          <div className="info-drawer__caption">
            <span className="info-drawer__eyebrow">
              <span className="info-drawer__eyebrow-rule" aria-hidden="true" />
              {categoryName}
              {!isActive && (
                <>
                  <span
                    className="info-drawer__eyebrow-dot"
                    aria-hidden="true"
                  />
                  <span className="info-drawer__eyebrow-flag">
                    {intl.formatMessage({
                      id: 'products.info_drawer_inactive_flag',
                    })}
                  </span>
                </>
              )}
            </span>
            <h2 className="info-drawer__name">{snapshot.name}</h2>
          </div>
        </header>

        {/* Quick stats — three stamped columns. Mono uppercase eyebrows
            sit above mono numerals. Stock turns oxblood when it dips
            below the low-stock threshold. */}
        <div className="info-drawer__stats" role="list">
          <div className="info-drawer__stat" role="listitem">
            <span className="info-drawer__stat-label">
              {intl.formatMessage({ id: 'products.info_drawer_stat_price' })}
            </span>
            <span className="info-drawer__stat-value">
              {formatCurrency(snapshot.price)}
            </span>
          </div>
          <div
            className={`info-drawer__stat info-drawer__stat--center${
              isLowStock ? ' info-drawer__stat--low' : ''
            }`}
            role="listitem"
          >
            <span className="info-drawer__stat-label">
              {intl.formatMessage({ id: 'products.info_drawer_stat_stock' })}
            </span>
            <span className="info-drawer__stat-value">{stockDisplay}</span>
            {isLowStock && (
              <span className="info-drawer__stat-flag">
                {intl.formatMessage({
                  id: 'products.info_drawer_stock_low_flag',
                })}
              </span>
            )}
          </div>
          <div className="info-drawer__stat info-drawer__stat--right" role="listitem">
            <span className="info-drawer__stat-label">
              {intl.formatMessage({ id: 'products.info_drawer_stat_status' })}
            </span>
            <span className="info-drawer__stat-value info-drawer__stat-value--mono-sm">
              {isActive
                ? intl.formatMessage({
                    id: 'products.info_drawer_status_active',
                  })
                : intl.formatMessage({
                    id: 'products.info_drawer_status_inactive',
                  })}
            </span>
          </div>
        </div>

        {/* Specifications ledger — printed-receipt style dotted-leader
            rows. Stays in mono everywhere a number lives so the eye
            tracks left → right cleanly. */}
        <section className="info-drawer__ledger">
          <h3 className="info-drawer__ledger-heading">
            {intl.formatMessage({
              id: 'products.info_drawer_section_specs',
            })}
          </h3>
          <dl className="info-drawer__ledger-rows">
            <div className="info-drawer__ledger-row">
              <dt className="info-drawer__ledger-label">
                {intl.formatMessage({
                  id: 'products.info_drawer_field_category',
                })}
              </dt>
              <span
                className="info-drawer__ledger-leader"
                aria-hidden="true"
              />
              <dd className="info-drawer__ledger-value">{categoryName}</dd>
            </div>

            <div className="info-drawer__ledger-row">
              <dt className="info-drawer__ledger-label">
                {intl.formatMessage({
                  id: 'products.info_drawer_field_price',
                })}
              </dt>
              <span
                className="info-drawer__ledger-leader"
                aria-hidden="true"
              />
              <dd className="info-drawer__ledger-value info-drawer__ledger-value--strong">
                {formatCurrency(snapshot.price)}
              </dd>
            </div>

            {snapshot.costPrice !== null && snapshot.costPrice !== undefined && (
              <div className="info-drawer__ledger-row">
                <dt className="info-drawer__ledger-label">
                  {intl.formatMessage({
                    id: 'products.info_drawer_field_cost',
                  })}
                </dt>
                <span
                  className="info-drawer__ledger-leader"
                  aria-hidden="true"
                />
                <dd className="info-drawer__ledger-value info-drawer__ledger-value--muted">
                  {formatCurrency(snapshot.costPrice)}
                </dd>
              </div>
            )}

            <div className="info-drawer__ledger-row">
              <dt className="info-drawer__ledger-label">
                {intl.formatMessage({
                  id: 'products.info_drawer_field_stock',
                })}
              </dt>
              <span
                className="info-drawer__ledger-leader"
                aria-hidden="true"
              />
              <dd
                className={`info-drawer__ledger-value${
                  isLowStock ? ' info-drawer__ledger-value--alert' : ''
                }`}
              >
                {stockDisplay}
              </dd>
            </div>

            {hasStock && (
              <div className="info-drawer__ledger-row">
                <dt className="info-drawer__ledger-label">
                  {intl.formatMessage({
                    id: 'products.info_drawer_field_low_stock_at',
                  })}
                </dt>
                <span
                  className="info-drawer__ledger-leader"
                  aria-hidden="true"
                />
                <dd className="info-drawer__ledger-value info-drawer__ledger-value--muted">
                  {intl.formatMessage(
                    { id: 'products.units_count' },
                    { count: threshold },
                  )}
                </dd>
              </div>
            )}

            {formatLabel && (
              <div className="info-drawer__ledger-row">
                <dt className="info-drawer__ledger-label">
                  {intl.formatMessage({
                    id: 'products.info_drawer_field_barcode_format',
                  })}
                </dt>
                <span
                  className="info-drawer__ledger-leader"
                  aria-hidden="true"
                />
                <dd className="info-drawer__ledger-value info-drawer__ledger-value--muted">
                  {formatLabel}
                </dd>
              </div>
            )}

            {snapshot.updatedAt && (
              <div className="info-drawer__ledger-row">
                <dt className="info-drawer__ledger-label">
                  {intl.formatMessage({
                    id: 'products.info_drawer_field_last_updated',
                  })}
                </dt>
                <span
                  className="info-drawer__ledger-leader"
                  aria-hidden="true"
                />
                <dd className="info-drawer__ledger-value info-drawer__ledger-value--muted">
                  {formatDate(new Date(snapshot.updatedAt))}
                </dd>
              </div>
            )}
          </dl>
        </section>

        {/* Barcode block — terracotta-tinted hairline card. When the
            product has a code, the SVG renders inside; the value sits
            beneath in mono numerals. When it doesn't, the slot fills
            with an italic Fraunces "no barcode set" line. */}
        <section className="info-drawer__barcode">
          {snapshot.barcode && snapshot.barcodeFormat ? (
            <>
              <div className="info-drawer__barcode-eyebrow">
                <span
                  className="info-drawer__barcode-tick"
                  aria-hidden="true"
                />
                <span>
                  {intl.formatMessage({
                    id: 'products.info_drawer_barcode_eyebrow',
                  })}
                </span>
                <span
                  className="info-drawer__barcode-eyebrow-sep"
                  aria-hidden="true"
                >
                  ·
                </span>
                <span className="info-drawer__barcode-format">
                  {formatLabel}
                </span>
              </div>
              <div className="info-drawer__barcode-frame">
                <BarcodeDisplay
                  value={snapshot.barcode}
                  format={snapshot.barcodeFormat}
                />
              </div>
              <div className="info-drawer__barcode-value">
                {snapshot.barcode}
              </div>
            </>
          ) : (
            <div className="info-drawer__barcode--empty">
              <span
                className="info-drawer__barcode-tick info-drawer__barcode-tick--muted"
                aria-hidden="true"
              />
              <p className="info-drawer__barcode-empty-headline">
                {intl.formatMessage({
                  id: 'products.info_drawer_no_barcode',
                })}
              </p>
              <p className="info-drawer__barcode-empty-caption">
                {intl.formatMessage({
                  id: 'products.info_drawer_no_barcode_caption',
                })}
              </p>
            </div>
          )}
        </section>
      </article>
    </ModalShell>
  )
}
