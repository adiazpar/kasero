'use client'

import { useEffect, useState } from 'react'
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
} from '@ionic/react'
import { close } from 'ionicons/icons'
import { ModalShell } from '@/components/ui'

export interface AddExpenseCategoryModalProps {
  isOpen: boolean
  onClose: () => void
  onExitComplete: () => void
  /** Create a category with the given name. Returns the new id or null. */
  onCreate: (name: string) => Promise<string | null>
}

/**
 * Tiny sub-modal for creating a new expense category.
 * Called from AddExpenseModal / EditExpenseModal when the user picks the
 * "Add new category" sentinel in ExpenseCategoryPicker.
 */
export function AddExpenseCategoryModal({
  isOpen,
  onClose,
  onExitComplete,
  onCreate,
}: AddExpenseCategoryModalProps) {
  const t = useIntl()
  const [name, setName] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isOpen) {
      setName('')
      setError('')
      setIsSaving(false)
    }
  }, [isOpen])

  useEffect(() => {
    if (isOpen) return
    const timer = window.setTimeout(onExitComplete, 250)
    return () => window.clearTimeout(timer)
  }, [isOpen, onExitComplete])

  const isValid = name.trim().length > 0

  const handleSave = async () => {
    if (!isValid || isSaving) return
    setError('')
    setIsSaving(true)
    const id = await onCreate(name.trim())
    setIsSaving(false)
    if (id) {
      onClose()
    } else {
      setError(t.formatMessage({ id: 'navigation.load_failed' }))
    }
  }

  return (
    <ModalShell rawContent isOpen={isOpen} onClose={onClose} noSwipeDismiss>
      <IonHeader className="pm-header">
        <IonToolbar>
          <IonTitle>{t.formatMessage({ id: 'expenses.add_category_modal_title' })}</IonTitle>
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
              {t.formatMessage({ id: 'expense_category.add_modal_title' })}
            </h1>
          </header>

          {error && (
            <div className="pm-error" role="alert">
              {error}
            </div>
          )}

          <section className="pm-field">
            <label className="pm-field-label" htmlFor="expense-cat-name">
              {t.formatMessage({ id: 'expense_category.name_label' })}
              <span className="pv-field__label-required">*</span>
            </label>
            <input
              id="expense-cat-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="pv-field__input pv-field__input--name"
              maxLength={80}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSave()
              }}
            />
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
                t.formatMessage({ id: 'common.save' })
              )}
            </button>
          </div>
        </IonToolbar>
      </IonFooter>
    </ModalShell>
  )
}
