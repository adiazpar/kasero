'use client'

import { useIntl, type IntlShape } from 'react-intl';
import { useApiMessage } from '@/hooks/useApiMessage'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'
import { useSales } from '@/contexts/sales-context'
import { useProducts } from '@/contexts/products-context'
import { ApiError } from '@/lib/api-client'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { roundToCurrencyDecimals } from '@kasero/shared/sales-helpers'
import type { UseCartResult } from '@/hooks/useCart'
import type { PaymentMethod } from '@kasero/shared/types/sale'
import type { ConfirmedSaleRecap } from './SuccessStep'

interface ChargeButtonProps {
  cart: UseCartResult
  currency: string
  methodId: PaymentMethod
  tenderedStr: string
  /** Final charge total (subtotal - discount + exclusive tax). */
  chargeTotal: number
  /** Cart-level discount as an absolute amount (0 when none). */
  discountAmount: number
  submitting: boolean
  setSubmitting: (v: boolean) => void
  setConfirmedSale: (recap: ConfirmedSaleRecap | null) => void
  setError: (message: string) => void
  setErrorMessageCode: (code: string | undefined) => void
  canConfirm: boolean
  onGoToSuccess: () => void
  onLock: () => void
  onUnlock: () => void
}

/**
 * Footer button for the payment step. Charges the sale via
 * SalesContext.commitSale, locks the modal during the round-trip, then
 * navigates to step 2 (success) on success, or surfaces a localized
 * error inline on failure (sequential pattern, no fake success).
 *
 * Renders a custom terracotta `.charge-pill` instead of an IonButton so
 * we can fully own the chrome — mono uppercase "Charge · $7.50",
 * elevated drop shadow, two-step pressed feedback. Echoes the
 * `.cart-fab__pill` mood from the surface that opened this modal.
 */
export function ChargeButton({
  cart,
  currency,
  methodId,
  tenderedStr,
  chargeTotal,
  discountAmount,
  submitting,
  setSubmitting,
  setConfirmedSale,
  setError,
  setErrorMessageCode,
  canConfirm,
  onGoToSuccess,
  onLock,
  onUnlock,
}: ChargeButtonProps) {
  const t = useIntl()
  const { formatCurrency } = useBusinessFormat()
  const translateApiMessage = useApiMessage()
  const sales = useSales()
  const products = useProducts()

  const tendered = parseFloat(tenderedStr) || 0

  const handleClick = async () => {
    setSubmitting(true)
    setError('')
    setErrorMessageCode(undefined)
    onLock()
    try {
      const sale = await sales.commitSale({
        items: cart.lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
        })),
        paymentMethod: methodId,
        // Only the absolute amount travels — the server recomputes the
        // authoritative total (discount + tax) from its own snapshots.
        ...(discountAmount > 0 ? { discountAmount } : {}),
      })
      // Server decremented stock atomically inside the sale transaction —
      // refresh the products cache in the background so the picker reflects
      // the new stock numbers without waiting for focus revalidation. Fire
      // and forget; the user keeps moving to the success step.
      void products.refetch()
      const isCash = methodId === 'cash'
      setConfirmedSale({
        sale,
        tendered: isCash ? tendered : null,
        change: isCash ? roundToCurrencyDecimals(tendered - sale.total, currency) : null,
      })
      onGoToSuccess()
    } catch (err) {
      const { message, code } = translateError(err, translateApiMessage, t)
      setError(message)
      setErrorMessageCode(code)
    } finally {
      setSubmitting(false)
      onUnlock()
    }
  }

  return (
    <button
      type="button"
      className="charge-pill"
      disabled={!canConfirm}
      onClick={handleClick}
      aria-busy={submitting}
      data-haptic
    >
      {submitting ? (
        <span className="charge-pill__spinner" aria-hidden="true" />
      ) : (
        <>
          <span>
            {t.formatMessage({ id: 'sales.cart.modal_charge_label' })}
          </span>
          <span className="charge-pill__divider" aria-hidden="true">·</span>
          <span className="charge-pill__amount">
            {formatCurrency(chargeTotal)}
          </span>
        </>
      )}
    </button>
  )
}

function translateError(
  err: unknown,
  translate: ReturnType<typeof useApiMessage>,
  t: IntlShape,
): { message: string; code: string | undefined } {
  if (err instanceof ApiError) {
    const code = err.messageCode ?? undefined
    switch (err.messageCode) {
      case ApiMessageCode.SESSION_NOT_OPEN:
        return { message: t.formatMessage({ id: 'sales.cart.modal_error_session_closed' }), code }
      case ApiMessageCode.SALE_INSUFFICIENT_STOCK:
        return { message: t.formatMessage({ id: 'sales.cart.modal_error_stock_changed' }), code }
      case ApiMessageCode.SALE_PRODUCT_NOT_FOUND:
      case ApiMessageCode.SALE_PRODUCT_INACTIVE:
        return { message: t.formatMessage({ id: 'sales.cart.modal_error_product_unavailable' }), code }
      case ApiMessageCode.SALE_INVALID_DATE:
        // Defensive — server clock skew. Spec routes this to the generic
        // copy rather than the envelope translation since the apiMessages
        // text is server-instrumentation-shaped, not POS-facing.
        return { message: t.formatMessage({ id: 'sales.cart.modal_error_generic' }), code }
      // Rate-limit (429) and offline-mutation envelopes have apiMessages.*
      // entries already; fall through to the envelope translator so the
      // user gets the localized "wait a moment" / "you're offline" copy.
      default:
        if (err.envelope) {
          return { message: translate(err.envelope), code }
        }
        return { message: t.formatMessage({ id: 'sales.cart.modal_error_generic' }), code: undefined }
    }
  }
  return { message: t.formatMessage({ id: 'sales.cart.modal_error_generic' }), code: undefined }
}
