'use client'

import { useIntl } from 'react-intl'
import { useEffect, useState } from 'react'
import { IonSpinner, useIonToast } from '@ionic/react'
import { Share2 } from 'lucide-react'
import { useBusiness } from '@/contexts/business-context'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'
import { useApiMessage } from '@/hooks/useApiMessage'
import { apiRequest, apiPost, ApiError } from '@/lib/api-client'
import { buildReceiptText, shareReceiptText } from '@/lib/receipt'
import type { Sale } from '@kasero/shared/types/sale'

interface SaleDetailContentProps {
  businessId: string
  saleId: string | null
}

type VoidPhase = 'idle' | 'confirm' | 'submitting'

/**
 * Receipt-format detail for a single sale. Fetches the full Sale
 * (with line items) from /api/businesses/[businessId]/sales/[id] when
 * saleId changes. Receipt layout:
 *   - Fraunces italic stamp at the top with sale number + date
 *   - Mono ledger of line items (qty × unit = subtotal)
 *   - Dashed printed-style divider
 *   - Totals block — Fraunces italic "Total" label, oversized mono
 *     terracotta total, then mono caption rows for method + time.
 *   - Share receipt action; managers additionally get a destructive
 *     Void action with an inline confirm step (stock is restored and
 *     the sale drops out of every revenue aggregate).
 *
 * Used by both ActiveSessionSalesModal (current session sales) and
 * SessionHistoryModal (historic session sales).
 */
export function SaleDetailContent({ businessId, saleId }: SaleDetailContentProps) {
  const t = useIntl()
  const { business, canManage } = useBusiness()
  const { formatCurrency, formatDate, formatTime } = useBusinessFormat()
  const translateApiMessage = useApiMessage()
  const [presentToast] = useIonToast()

  const [sale, setSale] = useState<Sale | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [voidPhase, setVoidPhase] = useState<VoidPhase>('idle')
  const [voidError, setVoidError] = useState<string>('')

  useEffect(() => {
    if (!saleId) {
      setSale(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    setVoidPhase('idle')
    setVoidError('')
    apiRequest<{ sale: Sale }>(`/api/businesses/${businessId}/sales/${saleId}`)
      .then(({ sale: fetched }) => {
        if (!cancelled) setSale(fetched)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load sale')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [businessId, saleId])

  const handleShare = async () => {
    if (!sale) return
    const text = buildReceiptText({
      intl: t,
      sale,
      businessName: business?.name ?? '',
      formatCurrency,
      formatDate,
      formatTime,
    })
    const outcome = await shareReceiptText(text)
    if (outcome === 'copied') {
      void presentToast({
        message: t.formatMessage({ id: 'sales.receipt.copied_toast' }),
        duration: 2200,
        position: 'top',
        cssClass: 'kasero-toast',
      })
    } else if (outcome === 'failed') {
      void presentToast({
        message: t.formatMessage({ id: 'sales.receipt.share_failed_toast' }),
        duration: 2200,
        position: 'top',
        cssClass: 'kasero-toast',
      })
    }
  }

  const handleVoid = async () => {
    if (!sale || !saleId) return
    setVoidPhase('submitting')
    setVoidError('')
    try {
      const { sale: voided } = await apiPost<{ sale: Omit<Sale, 'items'> }>(
        `/api/businesses/${businessId}/sales/${saleId}/void`,
        {},
      )
      // The void response has no line items — merge the status flip onto
      // the already-hydrated local sale. List views refresh themselves via
      // the sale.voided realtime refetch (fires on this device too).
      setSale({ ...sale, ...voided, items: sale.items })
      setVoidPhase('idle')
    } catch (err) {
      console.error('Void sale failed:', err)
      setVoidError(
        err instanceof ApiError && err.envelope
          ? translateApiMessage(err.envelope)
          : t.formatMessage({ id: 'sales.void.error_generic' }),
      )
      setVoidPhase('confirm')
    }
  }

  if (!saleId || loading) {
    return (
      <div className="modal-step-item">
        <div className="session-sales-loading">
          <IonSpinner name="crescent" style={{ '--color': 'var(--color-brand)' } as React.CSSProperties} />
          <span className="session-sales-loading__caption">
            {t.formatMessage({ id: 'sales.session.receipt_loading' })}
          </span>
        </div>
      </div>
    )
  }

  if (error || !sale) {
    return (
      <div className="modal-step-item">
        <div className="sale-receipt-error">
          <span className="sale-receipt-error__rule" />
          {error || t.formatMessage({ id: 'sales.cart.modal_error_generic' })}
        </div>
      </div>
    )
  }

  const methodKey = `sales.cart.modal_method_${sale.paymentMethod}` as const
  const createdAt = new Date(sale.createdAt)
  const isVoided = sale.status === 'voided'
  const subtotal = sale.items.reduce((acc, it) => acc + it.subtotal, 0)
  const hasDiscount = sale.discountAmount > 0
  const hasTax = sale.taxMode !== 'none' && sale.taxAmount > 0

  return (
    <>
      <div className="modal-step-item">
        <div className="sale-receipt-stamp">
          <span className="sale-receipt-stamp__eyebrow">
            {t.formatMessage({ id: 'sales.session.receipt_eyebrow' })}
          </span>
          <h2 className="sale-receipt-stamp__number">
            {t.formatMessage(
              { id: 'sales.session.sale_stamp' },
              { number: sale.saleNumber },
            )}
          </h2>
          <span className="sale-receipt-stamp__meta">
            {formatDate(createdAt)} · {formatTime(createdAt)}
          </span>
          {isVoided && (
            <span className="sale-receipt-voided-stamp">
              {t.formatMessage({ id: 'sales.void.voided_stamp' })}
              {sale.voidedAt ? ` · ${formatDate(new Date(sale.voidedAt))}` : ''}
            </span>
          )}
        </div>
      </div>

      <div className="modal-step-item">
        <div className={`sale-receipt-items${isVoided ? ' sale-receipt--voided' : ''}`}>
          {sale.items.map((item, idx) => (
            <div
              key={`${item.productId ?? 'item'}-${idx}`}
              className="sale-receipt-item"
            >
              <span className="sale-receipt-item__name">
                {item.productName}
              </span>
              <span className="sale-receipt-item__subtotal">
                {formatCurrency(item.subtotal)}
              </span>
              <span className="sale-receipt-item__breakdown">
                <span className="sale-receipt-item__qty">
                  {t.formatMessage(
                    { id: 'sales.session.receipt_item_qty' },
                    { qty: item.quantity },
                  )}
                </span>
                <span className="sale-receipt-item__times">×</span>
                <span className="sale-receipt-item__unit">
                  {formatCurrency(item.unitPrice)}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="modal-step-item">
        <hr className="sale-receipt-divider" aria-hidden="true" />
      </div>

      <div className="modal-step-item">
        <div className={`sale-receipt-totals${isVoided ? ' sale-receipt--voided' : ''}`}>
          {(hasDiscount || hasTax) && (
            <div className="sale-receipt-totals__row">
              <span className="sale-receipt-totals__label">
                {t.formatMessage({ id: 'sales.cart.modal_subtotal_label' })}
              </span>
              <span className="sale-receipt-totals__value">
                {formatCurrency(subtotal)}
              </span>
            </div>
          )}
          {hasDiscount && (
            <div className="sale-receipt-totals__row">
              <span className="sale-receipt-totals__label">
                {t.formatMessage({ id: 'sales.cart.discount_label' })}
              </span>
              <span className="sale-receipt-totals__value">
                -{formatCurrency(sale.discountAmount)}
              </span>
            </div>
          )}
          {hasTax && (
            <div className="sale-receipt-totals__row">
              <span className="sale-receipt-totals__label">
                {sale.taxMode === 'inclusive'
                  ? t.formatMessage({ id: 'sales.cart.tax_row_inclusive' }, { rate: sale.taxRate })
                  : t.formatMessage({ id: 'sales.cart.tax_row_exclusive' }, { rate: sale.taxRate })}
              </span>
              <span className="sale-receipt-totals__value">
                {formatCurrency(sale.taxAmount)}
              </span>
            </div>
          )}
          <div className="sale-receipt-totals__row sale-receipt-totals__row--total">
            <span className="sale-receipt-totals__label">
              {t.formatMessage({ id: 'sales.session.active_sales_modal.detail_total_label' })}
            </span>
            <span className="sale-receipt-totals__value sale-receipt-totals__value--strikeable">
              {formatCurrency(sale.total)}
            </span>
          </div>
          <div className="sale-receipt-totals__row">
            <span className="sale-receipt-totals__label">
              {t.formatMessage({ id: 'sales.session.active_sales_modal.detail_method_label' })}
            </span>
            <span className="sale-receipt-totals__method-value">
              <span
                className={`session-sales-row__dot session-sales-row__dot--${sale.paymentMethod}`}
                aria-hidden="true"
              />
              <span className="sale-receipt-totals__method-text">
                {t.formatMessage({ id: methodKey })}
              </span>
            </span>
          </div>
          <div className="sale-receipt-totals__row">
            <span className="sale-receipt-totals__label">
              {t.formatMessage({ id: 'sales.session.active_sales_modal.detail_time_label' })}
            </span>
            <span className="sale-receipt-totals__value">
              {formatTime(createdAt)}
            </span>
          </div>
        </div>
      </div>

      <div className="modal-step-item">
        <div className="sale-receipt-actions">
          <button
            type="button"
            className="receipt-share-button"
            onClick={() => {
              void handleShare()
            }}
          >
            <Share2 size={14} strokeWidth={2} aria-hidden="true" />
            {t.formatMessage({ id: 'sales.receipt.share_button' })}
          </button>

          {canManage && !isVoided && voidPhase === 'idle' && (
            <button
              type="button"
              className="sale-void-button"
              onClick={() => {
                setVoidError('')
                setVoidPhase('confirm')
              }}
            >
              {t.formatMessage({ id: 'sales.void.action' })}
            </button>
          )}

          {canManage && !isVoided && voidPhase !== 'idle' && (
            <div className="sale-void-confirm" role="alertdialog" aria-live="polite">
              <p className="sale-void-confirm__title">
                {t.formatMessage({ id: 'sales.void.confirm_title' })}
              </p>
              <p className="sale-void-confirm__desc">
                {t.formatMessage({ id: 'sales.void.confirm_desc' })}
              </p>
              {voidError && (
                <p className="sale-void-confirm__error">{voidError}</p>
              )}
              <div className="sale-void-confirm__actions">
                <button
                  type="button"
                  className="sale-void-confirm__cancel"
                  disabled={voidPhase === 'submitting'}
                  onClick={() => {
                    setVoidPhase('idle')
                    setVoidError('')
                  }}
                >
                  {t.formatMessage({ id: 'common.cancel' })}
                </button>
                <button
                  type="button"
                  className="sale-void-confirm__confirm"
                  disabled={voidPhase === 'submitting'}
                  onClick={() => {
                    void handleVoid()
                  }}
                >
                  {voidPhase === 'submitting' ? (
                    <IonSpinner
                      name="crescent"
                      style={{ '--color': 'currentColor', width: 16, height: 16 } as React.CSSProperties}
                    />
                  ) : (
                    t.formatMessage({ id: 'sales.void.confirm_cta' })
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
