'use client'

import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import {
  IonHeader,
  IonToolbar,
  IonContent,
  IonFooter,
  IonButtons,
  IonButton,
  IonIcon,
} from '@ionic/react'
import { close } from 'ionicons/icons'
import { ModalShell, PriceInput } from '@/components/ui'
import { ApiError } from '@/lib/api-client'
import { useApiMessage } from '@/hooks/useApiMessage'
import { useInventoryAdjustments } from '@/contexts/inventory-adjustments-context'
import { useExpenseCategories } from '@/contexts/expense-categories-context'
import { ExpenseCategoryPicker } from '@/components/expenses/ExpenseCategoryPicker'
import { AddExpenseCategoryModal } from '@/components/expenses/AddExpenseCategoryModal'
import type { Product } from '@kasero/shared/types'

export interface AdjustStockModalProps {
  /** Non-null means the modal is open for this product. */
  product: Product | null
  onClose: () => void
}

/**
 * Single-step modal for manually adjusting a product's stock level.
 *
 * Fields:
 *   - delta (signed integer, required, non-zero)
 *   - reason (textarea, optional, max 500 chars)
 *   - "Log as expense" checkbox (default OFF) — when checked, reveals:
 *       - amount (PriceInput, required when checked)
 *       - category (ExpenseCategoryPicker, optional)
 *
 * On save, calls useInventoryAdjustments().create(...) and optimistically
 * closes. Error is displayed inline. State resets in onExitComplete, not
 * onClose, per the modal-system rules.
 */
export function AdjustStockModal({ product, onClose }: AdjustStockModalProps) {
  const t = useIntl()
  const translateApiMessage = useApiMessage()
  const { create } = useInventoryAdjustments()
  const { create: createCategory } = useExpenseCategories()

  const isOpen = product !== null

  // Form state
  const [delta, setDelta] = useState('')
  const [reason, setReason] = useState('')
  const [logAsExpense, setLogAsExpense] = useState(false)
  const [expenseAmount, setExpenseAmount] = useState('')
  const [expenseCategoryId, setExpenseCategoryId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [showAddCategory, setShowAddCategory] = useState(false)

  // Reset form every time the modal opens for a new product.
  useEffect(() => {
    if (isOpen) {
      setDelta('')
      setReason('')
      setLogAsExpense(false)
      setExpenseAmount('')
      setExpenseCategoryId(null)
      setError('')
      setIsSaving(false)
    }
  }, [isOpen])

  // Delayed state cleanup after close animation — per modal-system rules.
  // State is already reset on open, so this is just belt-and-suspenders.
  useEffect(() => {
    if (isOpen) return
    const timer = window.setTimeout(() => {
      setDelta('')
      setReason('')
      setLogAsExpense(false)
      setExpenseAmount('')
      setExpenseCategoryId(null)
      setError('')
      setIsSaving(false)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [isOpen])

  const parsedDelta = parseInt(delta, 10)
  const isDeltaValid = !isNaN(parsedDelta) && parsedDelta !== 0
  const isExpenseValid = !logAsExpense || (expenseAmount.trim() !== '' && parseFloat(expenseAmount) > 0)
  const isValid = isDeltaValid && isExpenseValid

  const handleSave = async () => {
    if (!isValid || isSaving || !product) return
    setError('')
    setIsSaving(true)
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
      onClose()
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

  const currentStock = product?.stock ?? 0

  return (
    <>
      <ModalShell rawContent isOpen={isOpen} onClose={onClose} noSwipeDismiss>
        <IonHeader className="pm-header">
          <IonToolbar>
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
          <div className="pm-shell">
            <header className="pm-hero">
              <h1 className="pm-hero__title">
                {t.formatMessage(
                  { id: 'adjust_stock_modal.title' },
                  { productName: product?.name ?? '' }
                )}
              </h1>
            </header>

            {error && (
              <div className="pm-error" role="alert">
                {error}
              </div>
            )}

            {/* Delta */}
            <section className="pm-field">
              <label className="pm-field-label" htmlFor="adjust-delta">
                {t.formatMessage({ id: 'adjust_stock_modal.label_delta' })}
                <span className="pv-field__label-required">*</span>
              </label>
              <div className="adjust-stock-modal__context">
                {t.formatMessage({ id: 'inventory.list_current_stock' })}: {currentStock}
              </div>
              <input
                id="adjust-delta"
                type="number"
                step="1"
                value={delta}
                onChange={(e) => setDelta(e.target.value)}
                className={`pv-field__input adjust-stock-modal__delta-input`}
                placeholder="+10 or -5"
                autoFocus
              />
            </section>

            {/* Reason */}
            <section className="pm-field">
              <label className="pm-field-label" htmlFor="adjust-reason">
                {t.formatMessage({ id: 'adjust_stock_modal.label_reason' })}
              </label>
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
                className={`pv-note-counter${reason.length > 450 ? ' pv-note-counter--warn' : ''}`}
              >
                {reason.length} / 500
              </div>
            </section>

            {/* Log as expense */}
            <section className="pm-field">
              <label className="adjust-stock-modal__checkbox-row">
                <input
                  type="checkbox"
                  checked={logAsExpense}
                  onChange={(e) => setLogAsExpense(e.target.checked)}
                />
                <span className="adjust-stock-modal__checkbox-label">
                  {t.formatMessage({ id: 'adjust_stock_modal.checkbox_log_as_expense' })}
                </span>
              </label>

              {logAsExpense && (
                <div className="adjust-stock-modal__expense-section">
                  {/* Expense amount */}
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

                  {/* Expense category */}
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
              <button
                type="button"
                className="provider-modal__delete-link expense-modal__cancel-link"
                onClick={onClose}
                disabled={isSaving}
              >
                {t.formatMessage({ id: 'adjust_stock_modal.cancel' })}
              </button>
              <button
                type="button"
                className="order-modal__primary-pill"
                onClick={() => void handleSave()}
                disabled={!isValid || isSaving}
              >
                {isSaving ? (
                  <span
                    className="order-modal__pill-spinner"
                    aria-label={t.formatMessage({ id: 'common.loading' })}
                  />
                ) : (
                  t.formatMessage({ id: 'adjust_stock_modal.save' })
                )}
              </button>
            </div>
          </IonToolbar>
        </IonFooter>
      </ModalShell>

      {/* Add-category sub-modal */}
      <AddExpenseCategoryModal
        isOpen={showAddCategory}
        onClose={() => setShowAddCategory(false)}
        onExitComplete={() => setShowAddCategory(false)}
        onCreate={handleCreateCategory}
      />
    </>
  )
}
