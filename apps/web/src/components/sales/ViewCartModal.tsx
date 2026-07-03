'use client'

import { useIntl } from 'react-intl';
import { useMemo, useState, useCallback, type MouseEvent } from 'react'
import { IonButton } from '@ionic/react'
import { Minus, Plus } from 'lucide-react'
import { ModalShell } from '@/components/ui/modal-shell'
import { useProducts } from '@/contexts/products-context'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'
import { computeSaleTotals, computeSubtotal, roundToCurrencyDecimals } from '@kasero/shared/sales-helpers'
import type { Product } from '@kasero/shared/types'
import type { CartLine, UseCartResult } from '@/hooks/useCart'
import { useBusiness } from '@/contexts/business-context'
import type { PaymentMethod } from '@kasero/shared/types/sale'
import { PaymentStepContent, type DiscountMode } from './cart-modal/PaymentStep'
import { ChargeButton } from './cart-modal/ChargeButton'
import { SuccessStepContent, type ConfirmedSaleRecap } from './cart-modal/SuccessStep'

interface ViewCartModalProps {
  isOpen: boolean
  onClose: () => void
  cart: UseCartResult
}

type CartStep = 0 | 1 | 2

export function ViewCartModal({ isOpen, onClose, cart }: ViewCartModalProps) {
  const t = useIntl()
  const { products } = useProducts()
  const { formatCurrency } = useBusinessFormat()

  // Look up the live product for each line to respect current stock when
  // stepping quantity up. Lines store a snapshot of name/price; the products
  // map only supplies stock-cap info.
  const productById = useMemo(() => {
    const m = new Map<string, Product>()
    for (const p of products) m.set(p.id, p)
    return m
  }, [products])

  const isEmpty = cart.lines.length === 0

  const { business } = useBusiness()
  const currency = business?.currency ?? 'USD'

  const [step, setStep] = useState<CartStep>(0)
  const [isLocked, setIsLocked] = useState(false)
  const [methodId, setMethodId] = useState<PaymentMethod>('cash')
  const [tenderedStr, setTenderedStr] = useState<string>('')
  const [discountStr, setDiscountStr] = useState<string>('')
  const [discountMode, setDiscountMode] = useState<DiscountMode>('amount')
  const [submitting, setSubmitting] = useState(false)
  const [confirmedSale, setConfirmedSale] = useState<ConfirmedSaleRecap | null>(null)
  const [error, setError] = useState<string>('')
  const [errorMessageCode, setErrorMessageCode] = useState<string | undefined>(undefined)

  // ----- checkout math (shared helper — the same function the server runs) -----
  const taxRate = business?.taxRate ?? 0
  const taxMode = business?.taxMode ?? 'none'
  // Authoritative rounding order (round each line, then sum) shared with the
  // server — so the displayed Charge total is byte-for-byte the stored total.
  // NOT round(cart.total): cart.total is the raw sum and diverges by a cent
  // from the server for sub-cent unit prices.
  const subtotal = computeSubtotal(cart.lines, currency)

  const parsedDiscountInput = parseFloat(discountStr) || 0
  // Percent entry is a UI convenience: convert to an absolute amount here;
  // only the amount is ever sent to (and stored by) the server.
  const requestedDiscount =
    discountMode === 'percent'
      ? roundToCurrencyDecimals(subtotal * (parsedDiscountInput / 100), currency)
      : roundToCurrencyDecimals(parsedDiscountInput, currency)
  const discountInvalid =
    discountMode === 'percent'
      ? parsedDiscountInput > 100
      : requestedDiscount > subtotal

  const totals = useMemo(
    () =>
      computeSaleTotals(
        subtotal,
        discountInvalid ? 0 : requestedDiscount,
        taxRate,
        taxMode,
        currency,
      ),
    [subtotal, requestedDiscount, discountInvalid, taxRate, taxMode, currency],
  )
  const chargeTotal = totals.total

  const tendered = parseFloat(tenderedStr) || 0
  const isCash = methodId === 'cash'
  const tenderedSufficient = !isCash || tendered >= chargeTotal
  // A $0 charge total is chargeable when it's a genuine fully-comped sale:
  // real line value (subtotal > 0) that a 100% discount brought to zero.
  // Gating on `subtotal > 0` (not `chargeTotal > 0`) keeps the empty-cart
  // case disabled via the lines check while letting a legitimately free
  // sale — cash tender 0 satisfies `tenderedSufficient` at total 0 — commit.
  const canConfirm =
    !submitting &&
    cart.lines.length > 0 &&
    subtotal > 0 &&
    !discountInvalid &&
    tenderedSufficient

  const lineCount = cart.lines.reduce((n, l) => n + l.quantity, 0)

  // Single invariant, mirroring the method-change tender reset: any discount
  // edit re-defaults the tender to the NEW exact charge total so the Charge
  // pill stays live and the change math never shows a stale "short".
  const handleDiscountChange = (value: string, mode: DiscountMode) => {
    setDiscountStr(value)
    setDiscountMode(mode)
    const parsed = parseFloat(value) || 0
    const nextDiscount =
      mode === 'percent'
        ? roundToCurrencyDecimals(subtotal * (parsed / 100), currency)
        : roundToCurrencyDecimals(parsed, currency)
    const invalid = mode === 'percent' ? parsed > 100 : nextDiscount > subtotal
    const next = computeSaleTotals(
      subtotal,
      invalid ? 0 : nextDiscount,
      taxRate,
      taxMode,
      currency,
    )
    setTenderedStr(next.total.toString())
  }

  const resetState = useCallback(() => {
    setStep(0)
    setIsLocked(false)
    setMethodId('cash')
    setTenderedStr('')
    setDiscountStr('')
    setDiscountMode('amount')
    setSubmitting(false)
    setConfirmedSale(null)
    setError('')
    setErrorMessageCode(undefined)
  }, [])

  const handleClose = () => {
    if (isLocked) return
    onClose()
    // Reset local step/payment state after the close animation completes so
    // the success step doesn't flash back to the cart step mid-dismiss. The
    // cart itself is cleared at commit time (see onGoToSuccess) for committed
    // sales; a checkout cancelled before commit intentionally keeps its lines
    // so the user can resume where they left off.
    setTimeout(resetState, 250)
  }

  const handleBack = () => {
    if (isLocked || step === 0) return
    if (step === 1) setStep(0)
  }

  // Step 0 title
  const cartTitle = t.formatMessage({ id: 'sales.cart.modal_title' })
  // Step 1 title
  const paymentTitle = t.formatMessage({ id: 'sales.cart.modal_payment_step_title' })
  // Step 2 is chromeless — no toolbar title
  const isSuccess = step === 2

  const title = step === 0 ? cartTitle : step === 1 ? paymentTitle : undefined

  // Step 0 footer: secondary IonButton — the visual mood is reserved for
  // step 1's terracotta Charge pill. Default chrome on the confirm button
  // keeps the receipt step quiet so the line items + subtotal are the
  // moments of attention.
  // Step 0 → 1 transition: default tender to the charge total (EXACT —
  // including any tax) so the Charge button is active from frame 1 for the
  // 70%+ of small-vendor sales that are exact cash. Method stays 'cash'
  // from resetState. Users can override by tapping a denomination chip or
  // editing the input.
  const handleConfirmCart = () => {
    setTenderedStr(chargeTotal.toString())
    setStep(1)
  }

  // Confirm + running total inline, mirroring the bottom-bar
  // VIEW CART · N · S/ X.XX pattern so the user always sees the amount
  // they're about to commit to. Total is rendered in mono so the digits
  // sit on a tabular baseline next to the body-font label.
  const cartFooter = (
    <IonButton disabled={isEmpty} onClick={handleConfirmCart}>
      <span>{t.formatMessage({ id: 'common.confirm' })}</span>
      {!isEmpty && (
        <>
          <span
            aria-hidden="true"
            style={{ margin: '0 var(--space-2)' }}
          >
            ·
          </span>
          <span style={{ fontFamily: 'var(--font-mono)' }}>
            {/* The amount the user is about to commit to — includes
                exclusive tax, so it matches the payment step's Total. */}
            {formatCurrency(chargeTotal)}
          </span>
        </>
      )}
    </IonButton>
  )

  // Step 1 footer — terracotta Charge pill (custom button, not IonButton).
  const paymentFooter = (
    <ChargeButton
      cart={cart}
      currency={currency}
      methodId={methodId}
      tenderedStr={tenderedStr}
      chargeTotal={chargeTotal}
      discountAmount={totals.discountAmount}
      submitting={submitting}
      setSubmitting={setSubmitting}
      setConfirmedSale={setConfirmedSale}
      setError={setError}
      setErrorMessageCode={setErrorMessageCode}
      canConfirm={canConfirm}
      onGoToSuccess={() => {
        // Clear the cart the instant the sale commits — not deferred to the
        // Done tap. The background POS (cart pill + product tile qty badges)
        // immediately reflects an empty cart, and there is no delayed-clear
        // race where a quick tap on the next product could be wiped by a
        // pending timer. The success step renders from the `confirmedSale`
        // snapshot, so emptying the live cart here is invisible to it.
        cart.clear()
        setStep(2)
      }}
      onLock={() => setIsLocked(true)}
      onUnlock={() => setIsLocked(false)}
    />
  )

  // Step 2 footer — terracotta Done pill (custom button, not IonButton).
  const successFooter = (
    <button
      type="button"
      className="charge-pill"
      onClick={() => {
        handleClose()
      }}
    >
      <span className="charge-pill__amount">
        {t.formatMessage({ id: 'common.done' })}
      </span>
    </button>
  )

  const footer = step === 0 ? cartFooter : step === 1 ? paymentFooter : successFooter

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      chromeless={isSuccess}
      onBack={step === 1 ? handleBack : undefined}
      footer={footer}
      noSwipeDismiss
    >
      {/* Step 0: Cart receipt */}
      {step === 0 && (
        <>
          {isEmpty ? (
            <div className="cart-receipt__empty">
              <span className="cart-receipt__empty-stamp">
                {t.formatMessage({ id: 'sales.cart.modal_empty_stamp' })}
              </span>
              <p className="cart-receipt__empty-message">
                {t.formatMessage({ id: 'sales.cart.modal_empty' })}
              </p>
            </div>
          ) : (
            <>
              <div className="modal-step-item">
                <div className="cart-modal__eyebrow">
                  {t.formatMessage({ id: 'sales.cart.modal_eyebrow' })}
                </div>
                <h2 className="cart-modal__title">
                  {t.formatMessage(
                    { id: 'sales.cart.modal_receipt_title' },
                    { em: (chunks) => <em key="em">{chunks}</em> },
                  )}
                </h2>
                <div className="cart-modal__rule">
                  <span className="cart-modal__rule-line" />
                  <span className="cart-modal__rule-caption">
                    {t.formatMessage(
                      { id: 'sales.cart.modal_lines_caption' },
                      { count: lineCount },
                    )}
                  </span>
                </div>
                <div className="cart-receipt__lines">
                  {cart.lines.map((line) => (
                    <CartLineRow
                      key={line.productId}
                      line={line}
                      product={productById.get(line.productId)}
                      cart={cart}
                      formatCurrency={formatCurrency}
                    />
                  ))}
                </div>
              </div>
              <div className="cart-receipt__subtotal">
                <div className="cart-receipt__subtotal-row">
                  <span className="cart-receipt__subtotal-label">
                    {t.formatMessage({ id: 'sales.cart.modal_subtotal_label' })}
                  </span>
                  <span className="cart-receipt__subtotal-value">
                    {formatCurrency(subtotal)}
                  </span>
                </div>
                <div className="cart-receipt__subtotal-meta">
                  {t.formatMessage(
                    { id: 'sales.cart.modal_subtotal_meta' },
                    { count: lineCount },
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* Step 1: Payment */}
      {step === 1 && (
        <PaymentStepContent
          total={chargeTotal}
          subtotal={subtotal}
          discountStr={discountStr}
          discountMode={discountMode}
          onDiscountChange={handleDiscountChange}
          discountAmount={totals.discountAmount}
          discountInvalid={discountInvalid}
          taxRate={taxRate}
          taxMode={taxMode}
          taxAmount={totals.taxAmount}
          currency={currency}
          methodId={methodId}
          setMethodId={setMethodId}
          tenderedStr={tenderedStr}
          setTenderedStr={setTenderedStr}
          error={error}
          errorMessageCode={errorMessageCode}
          onGoToCart={() => setStep(0)}
          tenderedSufficient={tenderedSufficient}
        />
      )}

      {/* Step 2: Success */}
      {step === 2 && (
        <SuccessStepContent confirmedSale={confirmedSale} />
      )}
    </ModalShell>
  );
}

interface CartLineRowProps {
  line: CartLine
  product: Product | undefined
  cart: UseCartResult
  formatCurrency: (value: number) => string
}

function CartLineRow({ line, product, cart, formatCurrency }: CartLineRowProps) {
  const t = useIntl()
  const stockTotal = product?.stock ?? 0
  const atMaxQty = product != null && line.quantity >= stockTotal
  const lineTotal = line.unitPrice * line.quantity

  return (
    <div className="cart-line">
      <div className="cart-line__head">
        <div className="cart-line__name">{line.productName}</div>
        <div className="cart-line__math">
          <span>{formatCurrency(line.unitPrice)}</span>
          <span className="cart-line__math-op">{'×'}</span>
          <span>{line.quantity}</span>
          <span className="cart-line__math-op">{'='}</span>
          <span className="cart-line__math-total">
            {formatCurrency(lineTotal)}
          </span>
        </div>
      </div>
      <div className="cart-line__qty">
        <QtyButton
          variant="minus"
          ariaLabel={t.formatMessage({ id: 'sales.cart.qty_decrease' })}
          onClick={(e) => {
            e.stopPropagation()
            cart.updateQty(line.productId, line.quantity - 1)
          }}
        >
          <Minus style={{ width: 14, height: 14 }} />
        </QtyButton>
        <span className="cart-line__qty-value">{line.quantity}</span>
        <QtyButton
          variant="plus"
          ariaLabel={t.formatMessage({ id: 'sales.cart.qty_increase' })}
          disabled={atMaxQty}
          onClick={(e) => {
            e.stopPropagation()
            if (atMaxQty) return
            cart.updateQty(line.productId, line.quantity + 1)
          }}
        >
          <Plus style={{ width: 14, height: 14 }} />
        </QtyButton>
      </div>
    </div>
  );
}

type QtyButtonVariant = 'plus' | 'minus'

function QtyButton({
  variant,
  ariaLabel,
  disabled,
  onClick,
  children,
}: {
  variant: QtyButtonVariant
  ariaLabel: string
  disabled?: boolean
  onClick: (e: MouseEvent<HTMLButtonElement>) => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={`cart-line__qty-button cart-line__qty-button--${variant}`}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(e) => {
        onClick(e)
      }}
    >
      {children}
    </button>
  )
}
