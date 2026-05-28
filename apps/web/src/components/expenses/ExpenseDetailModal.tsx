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
import { LottiePlayerDynamic as LottiePlayer } from '@/components/animations'
import { ModalShell } from '@/components/ui'
import { ApiError } from '@/lib/api-client'
import { useApiMessage } from '@/hooks/useApiMessage'
import { useExpenses } from '@/contexts/expenses-context'
import { useExpenseCategories } from '@/contexts/expense-categories-context'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'
import { EditExpenseModal } from './EditExpenseModal'
import type { Expense } from '@kasero/shared/types'

type Step = 'detail' | 'delete-confirm' | 'delete-success'

export interface ExpenseDetailModalProps {
  isOpen: boolean
  expense: Expense | null
  onClose: () => void
  onExitComplete: () => void
}

/**
 * Read-only detail view for an expense.
 *
 * Steps:
 *   detail        — shows amount, date, category, note, photo. Footer: Edit + Delete.
 *   delete-confirm — inline confirmation with expense summary. Footer: Danger "Delete" pill.
 *   delete-success — Lottie trash animation + done.
 *
 * "Edit" opens EditExpenseModal as a sibling modal.
 */
export function ExpenseDetailModal({
  isOpen,
  expense,
  onClose,
  onExitComplete,
}: ExpenseDetailModalProps) {
  const t = useIntl()
  const translateApiMessage = useApiMessage()
  const { remove } = useExpenses()
  const { categories } = useExpenseCategories()
  const { formatCurrency, formatDate } = useBusinessFormat()

  const [step, setStep] = useState<Step>('detail')
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [deleteDone, setDeleteDone] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  // Reset to detail step every time the modal opens.
  useEffect(() => {
    if (isOpen) {
      setStep('detail')
      setDeleteError('')
      setDeleteDone(false)
      setIsDeleting(false)
    }
  }, [isOpen])

  // Delayed cleanup after close animation.
  useEffect(() => {
    if (isOpen) return
    const timer = window.setTimeout(onExitComplete, 250)
    return () => window.clearTimeout(timer)
  }, [isOpen, onExitComplete])

  if (!expense) return null

  const category = expense.categoryId
    ? categories.find((c) => c.id === expense.categoryId)
    : null

  const displayAmount = `-${formatCurrency(expense.amount)}`
  const displayDate = formatDate(new Date(expense.date))
  const expenseLabel = expense.expenseNumber != null
    ? `#${expense.expenseNumber}`
    : displayDate

  const handleDelete = async () => {
    setIsDeleting(true)
    setDeleteError('')
    try {
      await remove(expense.id)
      setDeleteDone(true)
      setStep('delete-success')
    } catch (err) {
      if (err instanceof ApiError && err.envelope) {
        setDeleteError(translateApiMessage(err.envelope))
      } else {
        setDeleteError(t.formatMessage({ id: 'navigation.load_failed' }))
      }
    } finally {
      setIsDeleting(false)
    }
  }

  // Footer per step.
  let footer: React.ReactNode = null
  if (step === 'detail') {
    footer = (
      <>
        <button
          type="button"
          className="provider-modal__delete-link"
          onClick={() => setStep('delete-confirm')}
        >
          {t.formatMessage({ id: 'expense_modal.delete' })}
        </button>
        <button
          type="button"
          className="order-modal__primary-pill"
          onClick={() => setEditOpen(true)}
        >
          {t.formatMessage({ id: 'common.edit' })}
        </button>
      </>
    )
  } else if (step === 'delete-confirm') {
    footer = (
      <button
        type="button"
        className="tm-invite__danger-pill"
        onClick={() => void handleDelete()}
        disabled={isDeleting}
      >
        {isDeleting ? (
          <span
            className="order-modal__pill-spinner"
            aria-label={t.formatMessage({ id: 'common.loading' })}
          />
        ) : (
          t.formatMessage({ id: 'expense_modal.delete' })
        )}
      </button>
    )
  } else {
    // delete-success
    footer = (
      <button
        type="button"
        className="order-modal__primary-pill"
        onClick={onClose}
      >
        {t.formatMessage({ id: 'common.done' })}
      </button>
    )
  }

  return (
    <>
      <ModalShell rawContent isOpen={isOpen} onClose={onClose}>
        {step !== 'delete-success' && (
        <IonHeader className="pm-header">
          <IonToolbar>
            {step === 'delete-confirm' && (
              <IonButtons slot="start">
                <IonButton
                  fill="clear"
                  onClick={() => setStep('detail')}
                  aria-label={t.formatMessage({ id: 'common.back' })}
                >
                  <IonIcon icon={close} />
                </IonButton>
              </IonButtons>
            )}
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
        )}

        <IonContent className="pm-content">
          {step === 'detail' && (
            <div className="pm-shell">
              {/* Header — expense number as title */}
              <header className="pm-hero">
                <span className="pm-hero__eyebrow">
                  {expenseLabel}
                </span>
                <h1 className="expense-detail__amount">
                  {displayAmount}
                </h1>
                {category && (
                  <span className="expense-row__category-chip">
                    {category.name}
                  </span>
                )}
              </header>

              <div className="expense-detail__meta">
                <div className="expense-detail__row">
                  <span className="expense-detail__label">
                    {t.formatMessage({ id: 'expense_modal.label_date' })}
                  </span>
                  <span className="expense-detail__value">{displayDate}</span>
                </div>

                {expense.note && (
                  <div className="expense-detail__row expense-detail__row--block">
                    <span className="expense-detail__label">
                      {t.formatMessage({ id: 'expense_modal.label_note' })}
                    </span>
                    <p className="expense-detail__note">{expense.note}</p>
                  </div>
                )}

                {expense.photoUrl && (
                  <div className="expense-detail__row expense-detail__row--block">
                    <span className="expense-detail__label">
                      {t.formatMessage({ id: 'expense_modal.label_photo' })}
                    </span>
                    <img
                      src={expense.photoUrl}
                      alt=""
                      className="expense-detail__photo"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 'delete-confirm' && (
            <div className="pm-shell">
              <header className="pm-hero">
                <h1 className="pm-hero__title pm-hero__title--danger">
                  {t.formatMessage({ id: 'expense_modal.delete_confirm_title' })}
                </h1>
                <p className="pm-hero__subtitle">
                  {t.formatMessage({ id: 'expense_modal.delete_confirm_body' })}
                </p>
              </header>

              {/* Expense specimen for context */}
              <div className="pv-specimen">
                <div className="pv-specimen__body">
                  <span className="pv-specimen__name">{displayAmount}</span>
                  <span className="pv-specimen__meta">
                    <span>{displayDate}</span>
                    {category && (
                      <>
                        <span className="pv-specimen__meta-sep">·</span>
                        <span>{category.name}</span>
                      </>
                    )}
                  </span>
                </div>
              </div>

              {deleteError && (
                <div className="pm-error" role="alert">{deleteError}</div>
              )}
            </div>
          )}

          {step === 'delete-success' && (
            <div className="pv-seal">
              <div style={{ width: 144, height: 144 }}>
                {deleteDone && (
                  <LottiePlayer
                    src="/animations/error.json"
                    loop={false}
                    autoplay={true}
                    delay={300}
                    style={{ width: 144, height: 144 }}
                  />
                )}
              </div>
              <h2 className="pm-hero__title pm-hero__title--danger" style={{ textAlign: 'center' }}>
                {t.formatMessage({ id: 'expense_modal.delete_confirm_title' })}
              </h2>
            </div>
          )}
        </IonContent>

        <IonFooter className="pm-footer">
          <IonToolbar>
            <div className="modal-footer">{footer}</div>
          </IonToolbar>
        </IonFooter>
      </ModalShell>

      {/* Edit flow — opens as a sibling modal so both can animate independently */}
      <EditExpenseModal
        isOpen={editOpen}
        expense={expense}
        onClose={() => setEditOpen(false)}
        onExitComplete={() => setEditOpen(false)}
        onSaved={onClose}
      />
    </>
  )
}
