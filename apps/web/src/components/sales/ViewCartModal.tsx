'use client'

import { useIntl } from 'react-intl';
import { useMemo, useState, useCallback, type MouseEvent } from 'react'
import { IonButton } from '@ionic/react'
import { Minus, Plus } from 'lucide-react'
import { ModalShell } from '@/components/ui/modal-shell'
import { useProducts } from '@/contexts/products-context'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'
import type { Product } from '@kasero/shared/types'
import type { CartLine, UseCartResult } from '@/hooks/useCart'
import { useBusiness } from '@/contexts/business-context'
import type { PaymentMethod } from '@kasero/shared/types/sale'
import { PaymentStepContent } from './cart-modal/PaymentStep'
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
  const [submitting, setSubmitting] = useState(false)
  const [confirmedSale, setConfirmedSale] = useState<ConfirmedSaleRecap | null>(null)
  const [error, setError] = useState<string>('')
  const [errorMessageCode, setErrorMessageCode] = useState<string | undefined>(undefined)

  const tendered = parseFloat(tenderedStr) || 0
  const isCash = methodId === 'cash'
  const tenderedSufficient = !isCash || tendered >= cart.total
  const canConfirm =
    !submitting &&
    cart.lines.length > 0 &&
    cart.total > 0 &&
    tenderedSufficient

  const lineCount = cart.lines.reduce((n, l) => n + l.quantity, 0)

  const resetState = useCallback(() => {
    setStep(0)
    setIsLocked(false)
    setMethodId('cash')
    setTenderedStr('')
    setSubmitting(false)
    setConfirmedSale(null)
    setError('')
    setErrorMessageCode(undefined)
  }, [])

  const handleClose = () => {
    if (isLocked) return
    onClose()
    setTimeout(() => {
      if (confirmedSale != null) {
        cart.clear()
      }
      resetState()
    }, 250)
  }

  const handleBack = () => {
    if (isLocked || step === 0) return
    if (step === 1) setStep(0)
  }

  // Step 0 title
  const cartTitle = t.formatMessage({ id: 'sales.cart.modal_title' })
  // Step 1 title
  const paymentTitle = t.formatMessage({ id: 'sales.cart.modal_payment_step_title' })
  // Step 2 title
  const successTitle = t.formatMessage({ id: 'sales.cart.modal_success_title' })

  const title = step === 0 ? cartTitle : step === 1 ? paymentTitle : successTitle

  // Step 0 footer: secondary IonButton — the visual mood is reserved for
  // step 1's terracotta Charge pill. Default chrome on the confirm button
  // keeps the receipt step quiet so the line items + subtotal are the
  // moments of attention.
  // Step 0 → 1 transition: default tender to the cart total (EXACT) so the
  // Charge button is active from frame 1 for the 70%+ of small-vendor sales
  // that are exact cash. Method stays 'cash' from resetState. Users can
  // override by tapping a denomination chip or editing the input.
  const handleConfirmCart = () => {
    setTenderedStr(cart.total.toString())
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
            {formatCurrency(cart.total)}
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
      submitting={submitting}
      setSubmitting={setSubmitting}
      setConfirmedSale={setConfirmedSale}
      setError={setError}
      setErrorMessageCode={setErrorMessageCode}
      canConfirm={canConfirm}
      onGoToSuccess={() => setStep(2)}
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
                    { em: (chunks) => <em>{chunks}</em> },
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
                    {formatCurrency(cart.total)}
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
          total={cart.total}
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
