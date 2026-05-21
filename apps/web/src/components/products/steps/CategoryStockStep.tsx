'use client'

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
import { close, chevronBack } from 'ionicons/icons'
import { Check } from 'lucide-react'
import { useProductForm } from '@/contexts/product-form-context'
import { useContext } from 'react'
import {
  useProductNav,
  useProductOnClose,
  AddProductCallbacksContext,
  EditProductCallbacksContext,
} from './ProductNavContext'
import { WizardProgress } from './WizardProgress'
import { StockStepper } from '@/components/ui/stock-stepper'

interface CategoryStockStepProps {
  mode: 'forward' | 'edit'
}

/**
 * Wizard step 3 of 4: category + initial stock. The category picker
 * uses the same .sort-sheet-row vocabulary as the Products tab sort
 * sheet so users see one consistent list-row pattern across the
 * surface. Stock is a simple number input with +/- steppers — only
 * surfaced on Add (edit path uses AdjustInventoryStep instead).
 */
export function CategoryStockStep({ mode }: CategoryStockStepProps) {
  const t = useIntl()
  const nav = useProductNav()
  const onClose = useProductOnClose()
  // The wizard runs under either AddProductCallbacks or
  // EditProductCallbacks. Both expose `categories`. Read from whichever
  // is mounted — this component is shared across both modal flows.
  const addCtx = useContext(AddProductCallbacksContext)
  const editCtx = useContext(EditProductCallbacksContext)
  const categories = addCtx?.categories ?? editCtx?.categories ?? []
  const isEditFlow = editCtx != null

  const { categoryId, setCategoryId, editingProduct } = useProductForm()

  const hasFieldChange =
    mode !== 'edit' ||
    !editingProduct ||
    (categoryId || null) !== (editingProduct.categoryId || null)

  const handleContinue = () => {
    if (!hasFieldChange) return
    if (mode === 'edit') {
      nav.pop()
    } else {
      nav.push('barcode-forward')
    }
  }

  return (
    <>
      <IonHeader className="pm-header">
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton
              fill="clear"
              onClick={() => nav.pop()}
              aria-label={t.formatMessage({ id: 'common.back' })}
            >
              <IonIcon icon={chevronBack} />
            </IonButton>
          </IonButtons>
          <IonTitle>
            {t.formatMessage({ id: 'productAddEdit.step_category_title_short' })}
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
        <div className="pm-shell">
          <WizardProgress current={3} total={4} />
          <header className="pm-hero">
            <h1 className="pm-hero__title">
              {t.formatMessage(
                { id: 'productAddEdit.step_category_title' },
                { em: (chunks) => <em>{chunks}</em> },
              )}
            </h1>
          </header>

          {/* Category picker — radio rows */}
          <section className="pm-field">
            <span className="pm-field-label">
              {t.formatMessage({ id: 'productForm.category_label' })}
            </span>
            <div className="pm-category-list">
              <button
                type="button"
                className={`sort-sheet-row${categoryId === '' ? ' sort-sheet-row--selected' : ''}`}
                onClick={() => setCategoryId('')}
              >
                <span className="sort-sheet-row__label">
                  {t.formatMessage({ id: 'productForm.category_none' })}
                </span>
                {categoryId === '' && (
                  <span className="sort-sheet-row__check" aria-hidden="true">
                    <Check size={18} strokeWidth={2.4} />
                  </span>
                )}
              </button>
              {[...categories]
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((cat) => {
                  const selected = cat.id === categoryId
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      className={`sort-sheet-row${selected ? ' sort-sheet-row--selected' : ''}`}
                      onClick={() => setCategoryId(cat.id)}
                    >
                      <span className="sort-sheet-row__label">{cat.name}</span>
                      {selected && (
                        <span className="sort-sheet-row__check" aria-hidden="true">
                          <Check size={18} strokeWidth={2.4} />
                        </span>
                      )}
                    </button>
                  )
                })}
            </div>
          </section>

          {/* Initial stock — only shown on Add (edit uses AdjustInventoryStep).
              When editing an existing product, the stock value is fixed in
              context but we don't expose it here; the user has a separate
              "Adjust inventory" affordance from the row swipe. */}
          {!isEditFlow && (
            <section className="pm-field">
              <label htmlFor="wizard-initial-stock" className="pm-field-label">
                {t.formatMessage({ id: 'productAddEdit.step_initial_stock_label' })}
              </label>
              <InitialStockInput />
              <p className="pm-field-helper">
                {t.formatMessage({ id: 'productAddEdit.step_initial_stock_helper' })}
              </p>
            </section>
          )}

          {isEditFlow && editingProduct && (
            <p className="pm-field-helper">
              {t.formatMessage(
                { id: 'productAddEdit.step_stock_edit_hint' },
                { count: editingProduct.stock ?? 0 },
              )}
            </p>
          )}
        </div>
      </IonContent>

      <IonFooter className="pm-footer">
        <IonToolbar>
          <div className="modal-footer">
            <IonButton onClick={handleContinue} disabled={!hasFieldChange}>
              {t.formatMessage({
                id: mode === 'edit'
                  ? 'productAddEdit.step_done_cta'
                  : 'productAddEdit.step_continue_cta',
              })}
            </IonButton>
          </div>
        </IonToolbar>
      </IonFooter>
    </>
  )
}

/**
 * Initial-stock control for the new-product wizard. Reuses the shared
 * centered `<StockStepper>` so the visual language matches the
 * AdjustInventoryStep (same `[ − {n} + ]` cluster with a "units"
 * caption below). Single source of truth via `useProductForm`.
 */
function InitialStockInput() {
  const { newStockValue, setNewStockValue } = useProductForm()
  return (
    <StockStepper
      value={newStockValue || 0}
      onChange={setNewStockValue}
    />
  )
}
