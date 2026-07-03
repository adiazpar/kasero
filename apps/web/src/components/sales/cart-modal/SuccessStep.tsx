'use client'

import { useIntl } from 'react-intl';
import { useIonToast } from '@ionic/react'
import { Share2 } from 'lucide-react'
import { LottiePlayerDynamic as LottiePlayer } from '@/components/animations'
import { useBusiness } from '@/contexts/business-context'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'
import { buildReceiptText, shareReceiptText } from '@/lib/receipt'
import type { Sale } from '@kasero/shared/types/sale'

export interface ConfirmedSaleRecap {
  /** Full sale as returned by the server — items, discount, tax, totals. */
  sale: Sale
  // Cash-only fields. Null for card / other.
  tendered: number | null
  change: number | null
}

interface SuccessStepContentProps {
  confirmedSale: ConfirmedSaleRecap | null
}

/**
 * Content for the cart-payment success step. Lottie is gated on
 * confirmedSale != null so it only mounts after the API has actually
 * landed (matches OpenSessionModal's `opened` gate).
 *
 * Step 2 footer (the Done button) lives in ViewCartModal so it can
 * share the terracotta `.charge-pill` chrome with step 1.
 */
export function SuccessStepContent({ confirmedSale }: SuccessStepContentProps) {
  const t = useIntl()
  const { business } = useBusiness()
  const { formatCurrency, formatDate, formatTime } = useBusinessFormat()
  const [presentToast] = useIonToast()

  const sale = confirmedSale?.sale ?? null
  const showCashRows = sale?.paymentMethod === 'cash'
  // Build the full message id as a template literal so the type narrows
  // to the union of declared ids instead of `string`. Mirrors the shape
  // returned by PAYMENT_METHODS[i].labelKey so call sites can pass it
  // straight to formatMessage.
  const methodLabelKey = sale
    ? (`sales.cart.modal_method_${sale.paymentMethod}` as const)
    : null

  // Pad sale number to 4 digits with leading zeros so the stamp reads
  // like a printed receipt run number (SALE 0042 · COMPLETE).
  const stampNumber = sale ? String(sale.saleNumber).padStart(4, '0') : null

  const subtotal = sale ? sale.items.reduce((acc, it) => acc + it.subtotal, 0) : 0
  const hasDiscount = (sale?.discountAmount ?? 0) > 0
  const hasTax = sale != null && sale.taxMode !== 'none' && sale.taxAmount > 0

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

  return (
    <div className="cart-success">
      <div className="cart-success__lottie">
        {sale && (
          <LottiePlayer
            src="/animations/success.json"
            loop={false}
            autoplay={true}
            delay={300}
            style={{ width: 140, height: 140 }}
          />
        )}
      </div>

        {sale && stampNumber && (
          <span className="cart-success__stamp">
            <span>{t.formatMessage({ id: 'sales.cart.modal_success_stamp_lead' })}</span>
            <span className="cart-success__stamp-id">{stampNumber}</span>
            <span className="cart-success__stamp-dot" aria-hidden="true">·</span>
            <span className="cart-success__stamp-state">
              {t.formatMessage({ id: 'sales.cart.modal_success_stamp_state' })}
            </span>
          </span>
        )}

        {sale && (
          <h2 className="cart-success__heading">
            {t.formatMessage(
              { id: 'sales.cart.modal_success_heading_alt' },
              { em: (chunks) => <em key="em">{chunks}</em> },
            )}
          </h2>
        )}

        {sale && (
          <p className="cart-success__caption">
            {t.formatMessage(
              { id: 'sales.cart.modal_success_caption' },
              { number: sale.saleNumber },
            )}
          </p>
        )}

        {sale && methodLabelKey && confirmedSale && (
          <div className="cart-success__ledger">
            <div className="cart-success__ledger-row">
              <span className="cart-success__ledger-label">
                {t.formatMessage({ id: 'sales.cart.modal_success_method_label' })}
              </span>
              <span className="cart-success__ledger-value">
                {t.formatMessage({ id: methodLabelKey })}
              </span>
            </div>
            {(hasDiscount || hasTax) && (
              <div className="cart-success__ledger-row">
                <span className="cart-success__ledger-label">
                  {t.formatMessage({ id: 'sales.cart.modal_success_subtotal_label' })}
                </span>
                <span className="cart-success__ledger-value">
                  {formatCurrency(subtotal)}
                </span>
              </div>
            )}
            {hasDiscount && (
              <div className="cart-success__ledger-row">
                <span className="cart-success__ledger-label">
                  {t.formatMessage({ id: 'sales.cart.modal_success_discount_label' })}
                </span>
                <span className="cart-success__ledger-value">
                  -{formatCurrency(sale.discountAmount)}
                </span>
              </div>
            )}
            {hasTax && (
              <div className="cart-success__ledger-row">
                <span className="cart-success__ledger-label">
                  {sale.taxMode === 'inclusive'
                    ? t.formatMessage({ id: 'sales.cart.tax_row_inclusive' }, { rate: sale.taxRate })
                    : t.formatMessage({ id: 'sales.cart.tax_row_exclusive' }, { rate: sale.taxRate })}
                </span>
                <span className="cart-success__ledger-value">
                  {formatCurrency(sale.taxAmount)}
                </span>
              </div>
            )}
            {showCashRows && confirmedSale.tendered != null && (
              <div className="cart-success__ledger-row">
                <span className="cart-success__ledger-label">
                  {t.formatMessage({ id: 'sales.cart.modal_success_tendered_label' })}
                </span>
                <span className="cart-success__ledger-value">
                  {formatCurrency(confirmedSale.tendered)}
                </span>
              </div>
            )}
            {showCashRows && confirmedSale.change != null && (
              <div className="cart-success__ledger-row cart-success__ledger-row--change">
                <span className="cart-success__ledger-label">
                  {t.formatMessage({ id: 'sales.cart.modal_success_change_label' })}
                </span>
                <span className="cart-success__ledger-value">
                  {formatCurrency(confirmedSale.change)}
                </span>
              </div>
            )}
          <div className="cart-success__ledger-row cart-success__ledger-row--emphasis">
            <span className="cart-success__ledger-label">
              {t.formatMessage({ id: 'sales.cart.modal_success_total_label' })}
            </span>
            <span className="cart-success__ledger-value">
              {formatCurrency(sale.total)}
            </span>
          </div>
        </div>
      )}

      {sale && (
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
      )}
    </div>
  );
}
