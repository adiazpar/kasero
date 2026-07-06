'use client'

import { useEffect, useRef, useState } from 'react'
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
import { ScanLine } from 'lucide-react'
import { ModalShell, PriceInput } from '@/components/ui'
import { ApiError, apiPost, type ApiResponse } from '@/lib/api-client'
import { useApiMessage } from '@/hooks/useApiMessage'
import { useBusiness } from '@/contexts/business-context'
import { useExpenses } from '@/contexts/expenses-context'
import { useExpenseCategories } from '@/contexts/expense-categories-context'
import { useImageCompression } from '@/hooks/useImageCompression'
import type { ExpenseCategory } from '@kasero/shared/types'
import { ExpenseCategoryPicker } from './ExpenseCategoryPicker'
import { AddExpenseCategoryModal } from './AddExpenseCategoryModal'

// Formats a Date to "YYYY-MM-DD" in local time (for the date input).
function toDateInputValue(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

interface ReceiptScanResult {
  amount: number
  date: string | null
  merchant: string | null
  note: string | null
  categoryName: string | null
}

// Case- and diacritics-insensitive normalization for the category fuzzy
// match ("Café" == "cafe").
function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Fuzzy-match the AI's suggested category name against the business's
 * existing expense categories: normalized equality first, then
 * startsWith, then includes (both directions). No match -> null; the
 * category field is simply left unset for the user to pick.
 */
function matchCategory(
  name: string | null,
  categories: ExpenseCategory[],
): ExpenseCategory | null {
  if (!name) return null
  const target = normalizeForMatch(name)
  if (!target) return null
  const normalized = categories.map((category) => ({
    category,
    n: normalizeForMatch(category.name),
  }))
  return (
    normalized.find((x) => x.n === target)?.category ??
    normalized.find((x) => x.n.startsWith(target) || target.startsWith(x.n))
      ?.category ??
    normalized.find((x) => x.n.includes(target) || target.includes(x.n))
      ?.category ??
    null
  )
}

export interface AddExpenseModalProps {
  isOpen: boolean
  onClose: () => void
  onExitComplete: () => void
}

/**
 * Single-step modal for adding a new expense.
 *
 * Fields: amount (PriceInput), date (date input, defaults to today),
 * categoryId (ExpenseCategoryPicker), note (textarea, max 2000 chars).
 *
 * Save calls useExpenses().create(...). Error path shows inline error
 * and keeps the modal open.
 *
 * Receipt snap: the scan affordance at the top of the form runs
 * useImageCompression -> POST /ai/parse-receipt and PREFILLS the fields
 * for review — it never auto-saves. Category comes from a fuzzy match
 * of the AI's categoryName against the existing expense categories.
 */
export function AddExpenseModal({
  isOpen,
  onClose,
  onExitComplete,
}: AddExpenseModalProps) {
  const t = useIntl()
  const translateApiMessage = useApiMessage()
  const { businessId } = useBusiness()
  const { create } = useExpenses()
  const { categories, create: createCategory } = useExpenseCategories()
  const { compressImage } = useImageCompression()

  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(() => toDateInputValue(new Date()))
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [showAddCategory, setShowAddCategory] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [scanError, setScanError] = useState('')
  const [scanApplied, setScanApplied] = useState(false)
  const receiptInputRef = useRef<HTMLInputElement>(null)

  // Reset form every time the modal opens.
  useEffect(() => {
    if (isOpen) {
      setAmount('')
      setDate(toDateInputValue(new Date()))
      setCategoryId(null)
      setNote('')
      setError('')
      setIsSaving(false)
      setIsScanning(false)
      setScanError('')
      setScanApplied(false)
    }
  }, [isOpen])

  // Delayed cleanup after close animation.
  useEffect(() => {
    if (isOpen) return
    const timer = window.setTimeout(onExitComplete, 250)
    return () => window.clearTimeout(timer)
  }, [isOpen, onExitComplete])

  const isValid = amount.trim() !== '' && parseFloat(amount) > 0

  const handleSave = async () => {
    if (!isValid || isSaving) return
    setError('')
    setIsSaving(true)
    try {
      await create({
        amount: parseFloat(amount),
        date: date || toDateInputValue(new Date()),
        categoryId: categoryId || null,
        note: note.trim() || null,
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
      setCategoryId(cat.id)
      return cat.id
    } catch {
      return null
    }
  }

  // Receipt snap pipeline: compress client-side (HEIC conversion + resize
  // + JPEG), send to the parse-receipt route, then PREFILL the form for
  // review. Never auto-saves — the user stays on the form.
  const handleReceiptFile = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0]
    // Allow re-picking the same file after an error.
    e.target.value = ''
    if (!file || !businessId || isScanning) return
    setScanError('')
    setScanApplied(false)
    setIsScanning(true)
    try {
      const image = await compressImage(file)
      if (!image) {
        setScanError(t.formatMessage({ id: 'expenses.receipt_error_fallback' }))
        return
      }
      const res = await apiPost<ApiResponse & { data: ReceiptScanResult }>(
        `/api/businesses/${businessId}/ai/parse-receipt`,
        { image },
      )
      const result = res.data
      setAmount(String(result.amount))
      if (result.date) setDate(result.date)
      // note is the AI's summary line; fall back to the merchant name so
      // the ledger row stays identifiable either way.
      const prefillNote = result.note ?? result.merchant
      if (prefillNote) setNote(prefillNote.slice(0, 2000))
      const matched = matchCategory(result.categoryName, categories)
      if (matched) setCategoryId(matched.id)
      setScanApplied(true)
    } catch (err) {
      console.error('Receipt scan failed:', err)
      setScanError(
        err instanceof ApiError && err.envelope
          ? translateApiMessage(err.envelope)
          : t.formatMessage({ id: 'expenses.receipt_error_fallback' }),
      )
    } finally {
      setIsScanning(false)
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
                {t.formatMessage(
                  { id: 'expense_modal.title_add' },
                  { em: (chunks) => <em key="em">{chunks}</em> },
                )}
              </h1>
            </header>

            {error && (
              <div className="pm-error" role="alert">
                {error}
              </div>
            )}

            {/* Receipt snap — prefills the form below; the user reviews
                and saves manually. */}
            <section className="expense-scan">
              <input
                ref={receiptInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                onChange={(e) => void handleReceiptFile(e)}
                className="expense-scan__input"
                aria-hidden="true"
                tabIndex={-1}
              />
              <button
                type="button"
                className="expense-scan__button"
                onClick={() => receiptInputRef.current?.click()}
                disabled={isScanning || isSaving}
              >
                {isScanning ? (
                  <>
                    <span
                      className="order-modal__pill-spinner expense-scan__spinner"
                      aria-hidden="true"
                    />
                    {t.formatMessage({ id: 'expenses.receipt_scanning' })}
                  </>
                ) : (
                  <>
                    <ScanLine size={16} aria-hidden="true" />
                    {t.formatMessage({ id: 'expenses.receipt_scan_button' })}
                  </>
                )}
              </button>
              {scanApplied && !scanError && (
                <p className="expense-scan__hint">
                  {t.formatMessage({ id: 'expenses.receipt_prefilled' })}
                </p>
              )}
              {scanError && (
                <p className="expense-scan__error" role="alert">
                  {scanError}
                </p>
              )}
            </section>

            {/* Amount */}
            <section className="pm-field">
              <label className="pm-field-label" htmlFor="expense-amount">
                {t.formatMessage({ id: 'expense_modal.label_amount' })}
                <span className="pv-field__label-required">*</span>
              </label>
              <div className="expense-modal__price-wrap">
                <PriceInput
                  id="expense-amount"
                  value={amount}
                  onValueChange={setAmount}
                  autoFocus
                  ariaLabel={t.formatMessage({ id: 'expense_modal.label_amount' })}
                />
              </div>
            </section>

            {/* Date */}
            <section className="pm-field">
              <label className="pm-field-label" htmlFor="expense-date">
                {t.formatMessage({ id: 'expense_modal.label_date' })}
              </label>
              <input
                id="expense-date"
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
              <label className="pm-field-label" htmlFor="expense-note">
                {t.formatMessage({ id: 'expense_modal.label_note' })}
              </label>
              <textarea
                id="expense-note"
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
