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
import { useExpenses } from '@/contexts/expenses-context'
import { useExpenseCategories } from '@/contexts/expense-categories-context'
import { ExpenseCategoryPicker } from './ExpenseCategoryPicker'
import { AddExpenseCategoryModal } from './AddExpenseCategoryModal'
import type { Expense } from '@kasero/shared/types'

// Formats a Date to "YYYY-MM-DD" in local time.
function toDateInputValue(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export interface EditExpenseModalProps {
  isOpen: boolean
  expense: Expense | null
  onClose: () => void
  onExitComplete: () => void
  /** Called after a successful save — parent can close the detail modal too. */
  onSaved?: () => void
}

/**
 * Edit modal for an existing expense. Separate from AddExpenseModal per
 * modal-system rule 2 (no combined add/edit with conditional rendering).
 *
 * Pre-fills from the `expense` prop on open. On successful save, calls
 * onClose() then onSaved() so the detail modal can dismiss too.
 *
 * Photo upload is deferred to v2.
 */
export function EditExpenseModal({
  isOpen,
  expense,
  onClose,
  onExitComplete,
  onSaved,
}: EditExpenseModalProps) {
  const t = useIntl()
  const translateApiMessage = useApiMessage()
  const { update } = useExpenses()
  const { create: createCategory } = useExpenseCategories()

  const [amount, setAmount] = useState('')
  const [date, setDate] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [showAddCategory, setShowAddCategory] = useState(false)

  // Pre-fill form from the expense prop whenever the modal opens.
  useEffect(() => {
    if (isOpen && expense) {
      setAmount(String(expense.amount))
      setDate(toDateInputValue(new Date(expense.date)))
      setCategoryId(expense.categoryId ?? null)
      setNote(expense.note ?? '')
      setError('')
      setIsSaving(false)
    }
  }, [isOpen, expense])

  // Delayed cleanup after close animation.
  useEffect(() => {
    if (isOpen) return
    const timer = window.setTimeout(onExitComplete, 250)
    return () => window.clearTimeout(timer)
  }, [isOpen, onExitComplete])

  if (!expense) return null

  const isValid = amount.trim() !== '' && parseFloat(amount) > 0

  const handleSave = async () => {
    if (!isValid || isSaving) return
    setError('')
    setIsSaving(true)
    try {
      await update(expense.id, {
        amount: parseFloat(amount),
        date: date || toDateInputValue(new Date(expense.date)),
        categoryId: categoryId ?? null,
        note: note.trim() || null,
      })
      onClose()
      onSaved?.()
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
      setCategoryId(cat.id)
      return cat.id
    } catch {
      return null
    }
  }

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
                {t.formatMessage({ id: 'expense_modal.title_edit' })}
              </h1>
            </header>

            {error && (
              <div className="pm-error" role="alert">
                {error}
              </div>
            )}

            {/* Amount */}
            <section className="pm-field">
              <label className="pm-field-label" htmlFor="edit-expense-amount">
                {t.formatMessage({ id: 'expense_modal.label_amount' })}
                <span className="pv-field__label-required">*</span>
              </label>
              <div className="expense-modal__price-wrap">
                <PriceInput
                  id="edit-expense-amount"
                  value={amount}
                  onValueChange={setAmount}
                  autoFocus
                  ariaLabel={t.formatMessage({ id: 'expense_modal.label_amount' })}
                />
              </div>
            </section>

            {/* Date */}
            <section className="pm-field">
              <label className="pm-field-label" htmlFor="edit-expense-date">
                {t.formatMessage({ id: 'expense_modal.label_date' })}
              </label>
              <input
                id="edit-expense-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="pv-field__input expense-modal__date-input"
              />
            </section>

            {/* Category */}
            <section className="pm-field">
              <span className="pm-field-label">
                {t.formatMessage({ id: 'expense_modal.label_category' })}
              </span>
              <ExpenseCategoryPicker
                value={categoryId}
                onChange={setCategoryId}
                onRequestAdd={() => setShowAddCategory(true)}
              />
            </section>

            {/* Note */}
            <section className="pm-field">
              <label className="pm-field-label" htmlFor="edit-expense-note">
                {t.formatMessage({ id: 'expense_modal.label_note' })}
              </label>
              <textarea
                id="edit-expense-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={2000}
                rows={3}
                className="pv-field__input pv-field__input--prose"
                placeholder={t.formatMessage({ id: 'expense_modal.note_placeholder' })}
              />
              <div
                className={`pv-note-counter${note.length > 1900 ? ' pv-note-counter--warn' : ''}`}
              >
                {note.length} / 2000
              </div>
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
                {t.formatMessage({ id: 'expense_modal.cancel' })}
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
                  t.formatMessage({ id: 'expense_modal.save' })
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
