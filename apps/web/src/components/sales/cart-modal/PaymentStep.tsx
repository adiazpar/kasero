'use client'

import { useIntl } from 'react-intl';
import { PriceInput } from '@/components/ui'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'
import { roundToCurrencyDecimals, nextRoundBills } from '@kasero/shared/sales-helpers'
import { PAYMENT_METHODS } from '@/lib/payment-methods'
import type { PaymentMethod } from '@kasero/shared/types/sale'

interface PaymentStepContentProps {
  total: number
  currency: string
  methodId: PaymentMethod
  setMethodId: (id: PaymentMethod) => void
  tenderedStr: string
  setTenderedStr: (value: string) => void
  error: string
  errorMessageCode?: string
  onGoToCart: () => void
  tenderedSufficient: boolean
}

const STOCK_RELATED_CODES = new Set([
  'SALE_INSUFFICIENT_STOCK',
  'SALE_PRODUCT_NOT_FOUND',
  'SALE_PRODUCT_INACTIVE',
])

/**
 * Content for the payment step. Renders the method picker, the cash form
 * (revealed via gridTemplateRows when cash is selected), the change row,
 * the error banner, and the sticky Total.
 */
export function PaymentStepContent({
  total,
  currency,
  methodId,
  setMethodId,
  tenderedStr,
  setTenderedStr,
  error,
  errorMessageCode,
  onGoToCart,
  tenderedSufficient,
}: PaymentStepContentProps) {
  const t = useIntl()
  const { formatCurrency } = useBusinessFormat()

  const isCash = methodId === 'cash'
  const tendered = parseFloat(tenderedStr) || 0
  const change = isCash ? roundToCurrencyDecimals(tendered - total, currency) : 0
  const showChangeRow = isCash && tenderedStr !== ''
  const isExact = isCash && Math.abs(change) < 1e-9 && tenderedStr !== ''
  const isStockError =
    errorMessageCode != null && STOCK_RELATED_CODES.has(errorMessageCode)

  const quickBills = nextRoundBills(total, currency)

  return (
    <>
      <div className="modal-step-item">
        <div className="cart-modal__eyebrow">
          {t.formatMessage({ id: 'sales.cart.modal_payment_eyebrow' })}
        </div>
        <h2 className="cart-modal__title">
          {t.formatMessage(
            { id: 'sales.cart.modal_payment_title' },
            { em: (chunks) => <em>{chunks}</em> },
          )}
        </h2>
      </div>

      {/* Method picker — three printed stamps. */}
      <div className="modal-step-item">
        <div id="payment-method-picker-label" className="payment-step__field-label">
          {t.formatMessage({ id: 'sales.cart.modal_pay_with_label' })}
        </div>
        <div role="group" aria-labelledby="payment-method-picker-label" className="payment-methods">
          {PAYMENT_METHODS.map((method) => {
            const Icon = method.icon
            const active = method.id === methodId
            const style = {
              ['--method-color' as string]: method.colorToken,
              ['--method-bg' as string]: method.subtleBg ?? 'var(--color-bg-surface)',
            } as React.CSSProperties
            return (
              <button
                key={method.id}
                type="button"
                className="payment-method"
                style={style}
                aria-pressed={active}
                onClick={() => {
                  setMethodId(method.id)
                  // Single invariant: clear tendered on every method change.
                  setTenderedStr('')
                }}
              >
                <span className="payment-method__icon">
                  <Icon size={22} strokeWidth={1.75} />
                </span>
                <span className="payment-method__label">
                  {t.formatMessage({ id: method.labelKey })}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Cash form reveal — gridTemplateRows 0fr ↔ 1fr collapse trick. */}
      <div className="modal-step-item">
        <div
          className="grid transition-[grid-template-rows] duration-300 ease-in-out"
          style={{ gridTemplateRows: isCash ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden min-h-0">
            <div className="payment-cash">
              <div>
                <label className="payment-cash__label" htmlFor="payment-tendered">
                  {t.formatMessage({ id: 'sales.cart.modal_tendered_label' })}
                </label>
                <PriceInput
                  id="payment-tendered"
                  value={tenderedStr}
                  onValueChange={setTenderedStr}
                  placeholder="0"
                />
              </div>

              {/* Quick-fill row: Exact (reset to total) leads, then
                 * denomination chips that ADD to the current tendered. The
                 * chip whose value matches the current tendered gets a
                 * terracotta selected ring. */}
              <div className="quick-bills">
                <button
                  type="button"
                  className={`quick-bill${
                    Math.abs(tendered - total) < 1e-9 && tenderedStr !== ''
                      ? ' quick-bill--selected'
                      : ''
                  }`}
                  onClick={() => {
                    setTenderedStr(total.toString())
                  }}
                >
                  {t.formatMessage({ id: 'sales.cart.modal_tendered_exact' })}
                </button>
                {quickBills.map((amount) => {
                  const selected = Math.abs(tendered - amount) < 1e-9 && tenderedStr !== ''
                  return (
                    <button
                      key={amount}
                      type="button"
                      className={`quick-bill${selected ? ' quick-bill--selected' : ''}`}
                      onClick={() => {
                        // Denomination chips ADD to the current tender so
                        // a vendor can stack S/ 10 + S/ 20 quickly. If the
                        // current tender is the auto-EXACT total, replace
                        // it instead (otherwise the first chip tap would
                        // overshoot).
                        const isExactAuto = Math.abs(tendered - total) < 1e-9
                        const next = isExactAuto ? amount : tendered + amount
                        setTenderedStr(roundToCurrencyDecimals(next, currency).toString())
                      }}
                    >
                      {formatCurrency(amount)}
                    </button>
                  )
                })}
              </div>

              {showChangeRow && (
                <div className="payment-change">
                  <span className="payment-change__label">
                    {change < 0
                      ? t.formatMessage({ id: 'sales.cart.modal_short_label' })
                      : t.formatMessage({ id: 'sales.cart.modal_change_label' })}
                  </span>
                  <span className="flex items-baseline">
                    <span
                      className={`payment-change__value ${
                        change < 0 ? 'payment-change__value--negative' : ''
                      }`}
                    >
                      {formatCurrency(Math.abs(change))}
                    </span>
                    {isExact && (
                      <span className="payment-change__qualifier">
                        {t.formatMessage({ id: 'sales.cart.modal_change_exact' })}
                      </span>
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="modal-step-item">
          <div className="payment-error">
            <span className="payment-error__body">{error}</span>
            {isStockError && (
              <button
                type="button"
                className="payment-error__back"
                onClick={() => {
                  onGoToCart()
                }}
              >
                {t.formatMessage({ id: 'sales.cart.modal_error_back_to_cart' })}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Sticky Total stamp — italic Fraunces label, oversized mono total. */}
      <div className="payment-total">
        <div className="payment-total__row">
          <span className="payment-total__label">
            {t.formatMessage({ id: 'sales.cart.modal_total_label' })}
          </span>
          <span className="payment-total__value">{formatCurrency(total)}</span>
        </div>
        <div
          className={`payment-total__meta ${
            tenderedSufficient
              ? 'payment-total__meta--ready'
              : 'payment-total__meta--awaiting'
          }`}
        >
          {tenderedSufficient
            ? t.formatMessage({ id: 'sales.cart.modal_total_meta_ready' })
            : t.formatMessage({ id: 'sales.cart.modal_total_meta_awaiting' })}
        </div>
      </div>
    </>
  );
}
