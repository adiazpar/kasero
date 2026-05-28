'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonFooter,
  IonButtons,
  IonButton,
  IonIcon,
  IonSpinner,
} from '@ionic/react'
import { close } from 'ionicons/icons'
import { Minus, Plus } from 'lucide-react'
import { ModalShell, PriceInput } from '@/components/ui'
import { ConfirmationAnimation } from '@/components/ui/ConfirmationAnimation'
import { ApiError } from '@/lib/api-client'
import { useApiMessage } from '@/hooks/useApiMessage'
import { useInventoryAdjustments } from '@/contexts/inventory-adjustments-context'
import { useExpenseCategories } from '@/contexts/expense-categories-context'
import { useProducts } from '@/contexts/products-context'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'
import { useDismissOnDelete } from '@/hooks/useDismissOnDelete'
import { useResyncOnUpdate } from '@/hooks/useResyncOnUpdate'
import { ExpenseCategoryPicker } from '@/components/expenses/ExpenseCategoryPicker'
import { AddExpenseCategoryModal } from '@/components/expenses/AddExpenseCategoryModal'
import type { Product } from '@kasero/shared/types'

export interface AdjustStockModalProps {
  /** Non-null means the modal is open for this product. */
  product: Product | null
  onClose: () => void
}

type Step = 'form' | 'success'

const QUICK_PICKS = [-10, -5, -1, 1, 5, 10] as const

/**
 * Adjust-stock modal — printed-ledger restock entry.
 *
 * Two steps:
 *  - 'form' — hero (eyebrow + Fraunces italic product name + ON HAND
 *    number), ± stepper + numeric input + replace-style quick-pick chips,
 *    live AFTER preview, reason textarea, opt-in "Stamp as expense"
 *    sub-section.
 *  - 'success' — Lottie + old→new summary; "Done" closes.
 *
 * Realtime: subscribes to the product's delete event (closes modal) and
 * update event (resyncs the displayed ON HAND value). Cleanup runs on
 * the next open (state-reset is gated on `isOpen`), not via a timeout.
 */
export function AdjustStockModal({ product, onClose }: AdjustStockModalProps) {
  const t = useIntl()
  const translateApiMessage = useApiMessage()
  const { create } = useInventoryAdjustments()
  const { create: createCategory } = useExpenseCategories()
  const { products } = useProducts()
  const { formatCurrency } = useBusinessFormat()

  const isOpen = product !== null

  // Step stack — single state value because there are only two steps and
  // the success step is always reached from 'form'. Reset on (re)open.
  const [step, setStep] = useState<Step>('form')

  // Live current-stock snapshot. Updated when realtime fires
  // `product.updated` for this product id.
  const [liveStock, setLiveStock] = useState<number>(product?.stock ?? 0)
  const [stockResyncFlash, setStockResyncFlash] = useState(false)

  // Form state
  const [delta, setDelta] = useState('')
  const [reason, setReason] = useState('')
  const [logAsExpense, setLogAsExpense] = useState(false)
  const [expenseAmount, setExpenseAmount] = useState('')
  const [expenseCategoryId, setExpenseCategoryId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [showAddCategory, setShowAddCategory] = useState(false)

  // Snapshot for the success step (frozen at save-time so the summary
  // doesn't flicker if `product` updates after we navigate to success).
  const [savedSummary, setSavedSummary] = useState<{
    name: string
    oldStock: number
    newStock: number
    expenseAmount: number | null
  } | null>(null)

  // Reset every time the modal opens for a (new) product.
  useEffect(() => {
    if (isOpen) {
      setStep('form')
      setDelta('')
      setReason('')
      setLogAsExpense(false)
      setExpenseAmount('')
      setExpenseCategoryId(null)
      setError('')
      setIsSaving(false)
      setSavedSummary(null)
      setLiveStock(product?.stock ?? 0)
      setStockResyncFlash(false)
    }
  }, [isOpen, product?.id, product?.stock])

  // Realtime: close on remote delete.
  useDismissOnDelete('product', product?.id, onClose)

  // Realtime: resync the ON HAND value when another device updates the
  // product. By the time this fires, the products context has already
  // refetched, so the fresh value is on `products`.
  const resyncStock = useCallback(() => {
    if (!product) return
    const fresh = products.find((p) => p.id === product.id)
    if (!fresh) return
    const next = fresh.stock ?? 0
    setLiveStock((prev) => {
      if (prev === next) return prev
      setStockResyncFlash(true)
      return next
    })
  }, [product, products])

  useResyncOnUpdate('product', product?.id, resyncStock)

  // Auto-fade the "stock updated elsewhere" inline notice.
  useEffect(() => {
    if (!stockResyncFlash) return
    const timer = window.setTimeout(() => setStockResyncFlash(false), 4000)
    return () => window.clearTimeout(timer)
  }, [stockResyncFlash])

  const parsedDelta = parseInt(delta, 10)
  const isDeltaValid = !isNaN(parsedDelta) && parsedDelta !== 0
  const isExpenseValid =
    !logAsExpense || (expenseAmount.trim() !== '' && parseFloat(expenseAmount) > 0)
  const isValid = isDeltaValid && isExpenseValid

  const projectedStock = isDeltaValid ? liveStock + parsedDelta : liveStock

  const afterColorClass = useMemo(() => {
    if (!isDeltaValid) return ''
    if (projectedStock < 0) return 'adjust-modal__preview-value--error'
    if (
      product?.lowStockThreshold != null &&
      projectedStock <= product.lowStockThreshold &&
      projectedStock > 0
    ) {
      return 'adjust-modal__preview-value--warning'
    }
    if (projectedStock <= 0) return 'adjust-modal__preview-value--error'
    if (parsedDelta > 0) return 'adjust-modal__preview-value--success'
    return ''
  }, [isDeltaValid, projectedStock, parsedDelta, product?.lowStockThreshold])

  const updateDelta = useCallback((next: number) => {
    if (Number.isNaN(next)) {
      setDelta('')
      return
    }
    setDelta(String(next))
  }, [])

  const applyStep = useCallback(
    (direction: 1 | -1) => {
      const current = parseInt(delta, 10)
      const base = Number.isNaN(current) ? 0 : current
      updateDelta(base + direction)
    },
    [delta, updateDelta]
  )

  const applyQuickPick = useCallback(
    (value: number) => {
      // Replace semantics — chips set the delta directly.
      updateDelta(value)
    },
    [updateDelta]
  )

  const handleSave = async () => {
    if (!isValid || isSaving || !product) return
    setError('')
    setIsSaving(true)

    const oldStock = liveStock
    const newStock = oldStock + parsedDelta
    const expenseSnapshot = logAsExpense ? parseFloat(expenseAmount) : null

    try {
      await create({
        productId: product.id,
        delta: parsedDelta,
        reason: reason.trim() || null,
        expense: logAsExpense
          ? {
              amount: parseFloat(expenseAmount),
              categoryId: expenseCategoryId,
            }
          : null,
      })
      // Freeze the summary and navigate to success.
      setSavedSummary({
        name: product.name,
        oldStock,
        newStock,
        expenseAmount: expenseSnapshot,
      })
      setStep('success')
    } catch (err) {
      if (err instanceof ApiError && err.envelope) {
        setError(translateApiMessage(err.envelope))
      } else {
        setError(t.formatMessage({ id: 'navigation.load_failed' }))
      }
    } finally {
      setIsSaving(false)
    }
  }

  const handleCreateCategory = async (name: string): Promise<string | null> => {
    try {
      const cat = await createCategory({ name })
      setExpenseCategoryId(cat.id)
      return cat.id
    } catch {
      return null
    }
  }

  const renderFormStep = () => (
    <>
      <IonHeader className="pm-header">
        <IonToolbar>
          <IonTitle>
            {t.formatMessage({ id: 'adjust_stock_modal.eyebrow' })}
          </IonTitle>
          <IonButtons slot="end">
            <IonButton
              fill="clear"
              onClick={onClose}
              aria-label={t.formatMessage({ id: 'common.close' })}
            >
              <IonIcon icon={close} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="pm-content">
        <div className="adjust-modal">
          {/* Hero — Fraunces italic product name + ON HAND mono+italic
              number. When delta is valid, the projected stock value
              appends inline (`ON HAND  1 → 11`) instead of living in a
              separate AFTER section below. */}
          <header className="adjust-modal__hero">
            <h1 className="adjust-modal__title">{product?.name ?? ''}</h1>
            <div className="adjust-modal__on-hand">
              <span className="adjust-modal__on-hand-label">
                {t.formatMessage({ id: 'inventory.row_on_hand' })}
              </span>
              <span className="adjust-modal__on-hand-value">{liveStock}</span>
              {isDeltaValid && (
                <>
                  <span className="adjust-modal__on-hand-arrow" aria-hidden="true">→</span>
                  <span
                    className={`adjust-modal__on-hand-value adjust-modal__on-hand-projected ${afterColorClass}`}
                    aria-live="polite"
                    aria-label={t.formatMessage(
                      { id: 'adjust_stock_modal.projected_aria' },
                      { value: projectedStock }
                    )}
                  >
                    {projectedStock}
                  </span>
                </>
              )}
            </div>
            {stockResyncFlash && (
              <div
                className="adjust-modal__resync-notice"
                role="status"
                aria-live="polite"
              >
                {t.formatMessage({ id: 'adjust_stock_modal.resync_notice' })}
              </div>
            )}
          </header>

          {error && (
            <div className="pm-error" role="alert">
              {error}
            </div>
          )}

          {/* Delta */}
          <section className="adjust-modal__section">
            <label className="adjust-modal__section-label" htmlFor="adjust-delta">
              {t.formatMessage({ id: 'adjust_stock_modal.label_delta' })}
              <span className="pv-field__label-required">*</span>
            </label>

            {/* Stepper-in-pill — Shopify-inspired (Mobbin reference).
                A pill carrying the delta value flanked by circular ± buttons. */}
            <div className="adjust-modal__stepper">
              <button
                type="button"
                className="adjust-modal__stepper-btn"
                onClick={() => applyStep(-1)}
                aria-label={t.formatMessage({ id: 'adjust_stock_modal.stepper_decrement_aria' })}
              >
                <Minus size={20} strokeWidth={2} aria-hidden="true" />
              </button>
              <div className="adjust-modal__delta-pill">
                <input
                  id="adjust-delta"
                  type="number"
                  inputMode="numeric"
                  step="1"
                  value={delta}
                  onChange={(e) => setDelta(e.target.value)}
                  className="adjust-modal__delta-input"
                  placeholder="0"
                  aria-label={t.formatMessage({ id: 'adjust_stock_modal.delta_input_aria' })}
                  autoFocus
                />
              </div>
              <button
                type="button"
                className="adjust-modal__stepper-btn"
                onClick={() => applyStep(1)}
                aria-label={t.formatMessage({ id: 'adjust_stock_modal.stepper_increment_aria' })}
              >
                <Plus size={20} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>

            {/* Quieter quick-pick row — mono text links, no chrome. */}
            <div className="adjust-modal__chips" role="group" aria-label={t.formatMessage({ id: 'adjust_stock_modal.quick_picks_aria' })}>
              <span className="adjust-modal__chips-label">
                {t.formatMessage({ id: 'adjust_stock_modal.quick_picks_label' })}
              </span>
              {QUICK_PICKS.map((value) => {
                const signed = value > 0 ? `+${value}` : `${value}`
                return (
                  <button
                    key={value}
                    type="button"
                    className={`adjust-modal__chip adjust-modal__chip--${value > 0 ? 'pos' : 'neg'}`}
                    onClick={() => applyQuickPick(value)}
                    aria-label={t.formatMessage(
                      { id: 'adjust_stock_modal.quick_pick_aria' },
                      { value: signed }
                    )}
                    aria-pressed={parsedDelta === value}
                  >
                    {signed}
                  </button>
                )
              })}
            </div>

            {/* AFTER block removed — projected value lives inline next
                to the ON HAND number in the hero so the modal stays
                compact and the user sees the result without scrolling. */}
          </section>

          {/* Reason */}
          <section className="adjust-modal__section">
            <label className="adjust-modal__section-label" htmlFor="adjust-reason">
              {t.formatMessage({ id: 'adjust_stock_modal.label_reason' })}
            </label>
            <div className="adjust-modal__textarea-wrap">
              <textarea
                id="adjust-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                rows={3}
                className="pv-field__input pv-field__input--prose"
                placeholder={t.formatMessage({ id: 'adjust_stock_modal.reason_placeholder' })}
              />
              <div
                className={`adjust-modal__textarea-counter${
                  reason.length > 450 ? ' adjust-modal__textarea-counter--warn' : ''
                }`}
              >
                {reason.length} / 500
              </div>
            </div>
          </section>

          {/* Stamp as expense */}
          <section className="adjust-modal__expense">
            <label className="adjust-modal__expense-toggle">
              <input
                type="checkbox"
                checked={logAsExpense}
                onChange={(e) => setLogAsExpense(e.target.checked)}
              />
              <span className="adjust-modal__expense-toggle-label">
                {t.formatMessage({ id: 'adjust_stock_modal.stamp_as_expense' })}
              </span>
            </label>

            {logAsExpense && (
              <div className="adjust-modal__expense-body">
                <div className="pm-field">
                  <label className="pm-field-label" htmlFor="adjust-expense-amount">
                    {t.formatMessage({ id: 'adjust_stock_modal.label_amount' })}
                    <span className="pv-field__label-required">*</span>
                  </label>
                  <div className="expense-modal__price-wrap">
                    <PriceInput
                      id="adjust-expense-amount"
                      value={expenseAmount}
                      onValueChange={setExpenseAmount}
                      ariaLabel={t.formatMessage({ id: 'adjust_stock_modal.label_amount' })}
                    />
                  </div>
                </div>

                <div className="pm-field">
                  <span className="pm-field-label">
                    {t.formatMessage({ id: 'adjust_stock_modal.label_category' })}
                  </span>
                  <ExpenseCategoryPicker
                    value={expenseCategoryId}
                    onChange={setExpenseCategoryId}
                    onRequestAdd={() => setShowAddCategory(true)}
                  />
                </div>
              </div>
            )}
          </section>
        </div>
      </IonContent>

      <IonFooter className="pm-footer">
        <IonToolbar>
          <div className="modal-footer">
            <IonButton
              fill="outline"
              className="pm-ghost-btn"
              onClick={onClose}
              disabled={isSaving}
            >
              {t.formatMessage({ id: 'adjust_stock_modal.cancel' })}
            </IonButton>
            <IonButton
              onClick={() => void handleSave()}
              disabled={!isValid || isSaving}
            >
              {isSaving ? (
                <IonSpinner name="crescent" />
              ) : (
                t.formatMessage({ id: 'adjust_stock_modal.save' })
              )}
            </IonButton>
          </div>
        </IonToolbar>
      </IonFooter>
    </>
  )

  // Terminal success step is chromeless — no header bar at all. The user
  // closes via the Done footer pill.
  const renderSuccessStep = () => (
    <>
      <IonContent className="pm-content">
        <div className="adjust-modal adjust-modal--success">
          <ConfirmationAnimation
            type="success"
            triggered={step === 'success'}
            title={t.formatMessage({ id: 'adjust_stock_modal.success_title' })}
          />
          {savedSummary && (
            <div className="adjust-modal__success-summary">
              <div className="adjust-modal__success-rule" aria-hidden="true" />
              <div className="adjust-modal__success-line">
                <span className="adjust-modal__success-name">{savedSummary.name}</span>
                <span className="adjust-modal__success-sep" aria-hidden="true">·</span>
                <span className="adjust-modal__success-nums">
                  <span className="adjust-modal__success-from">{savedSummary.oldStock}</span>
                  <span className="adjust-modal__success-arrow" aria-hidden="true">→</span>
                  <span className="adjust-modal__success-to">{savedSummary.newStock}</span>
                </span>
              </div>
              {savedSummary.expenseAmount != null && (
                <div className="adjust-modal__success-expense">
                  + {t.formatMessage({ id: 'adjust_stock_modal.success_expense_logged' })}
                  <span className="adjust-modal__success-sep" aria-hidden="true">·</span>
                  <span className="adjust-modal__success-expense-amount">
                    {formatCurrency(savedSummary.expenseAmount)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </IonContent>

      <IonFooter className="pm-footer">
        <IonToolbar>
          <div className="modal-footer">
            <IonButton onClick={onClose}>
              {t.formatMessage({ id: 'adjust_stock_modal.done' })}
            </IonButton>
          </div>
        </IonToolbar>
      </IonFooter>
    </>
  )

  return (
    <>
      <ModalShell rawContent isOpen={isOpen} onClose={onClose} noSwipeDismiss>
        {step === 'success' ? renderSuccessStep() : renderFormStep()}
      </ModalShell>

      <AddExpenseCategoryModal
        isOpen={showAddCategory}
        onClose={() => setShowAddCategory(false)}
        onExitComplete={() => setShowAddCategory(false)}
        onCreate={handleCreateCategory}
      />
    </>
  )
}
