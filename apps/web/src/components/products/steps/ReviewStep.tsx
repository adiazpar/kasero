'use client'

import { useContext, useState } from 'react'
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
  IonList,
  IonItem,
  IonLabel,
  IonToggle,
} from '@ionic/react'
import { close } from 'ionicons/icons'
import { ChevronRight, ImagePlus, Power, Trash2 } from 'lucide-react'
import Image from '@/lib/Image'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'
import { isPresetIcon, getPresetIcon } from '@/lib/preset-icons'
import { useProductForm, useProductFormValidation } from '@/contexts/product-form-context'
import {
  useProductNav,
  AddProductCallbacksContext,
  EditProductCallbacksContext,
} from './ProductNavContext'

/**
 * Final wizard step + summary surface. Shown:
 *   - At the end of the manual wizard chain (Name → Price → Cat/Stock
 *     → Barcode → Review). The user reviews everything and taps Save.
 *   - At the end of the AI snap-to-add path (Photo → Analyzing →
 *     SuggestedCategory → Review), with all fields pre-filled by the
 *     AI pipeline. Same review-then-save pattern as manual.
 *   - As the root step of EditProductModal, with the existing product
 *     loaded into context. Tap any field row to revise just that
 *     piece.
 *
 * Each row in the field ledger is tappable — pushes the corresponding
 * step in `mode="edit"`, which configures that step's CTA to pop back
 * here instead of pushing forward in the chain.
 */
export function ReviewStep() {
  const t = useIntl()
  const nav = useProductNav()
  const { formatCurrency } = useBusinessFormat()

  // Pull from whichever callbacks context is mounted (Add or Edit).
  // Both surfaces share this component.
  const addCtx = useContext(AddProductCallbacksContext)
  const editCtx = useContext(EditProductCallbacksContext)
  const isEdit = editCtx != null
  const onSubmit = (addCtx?.onSubmit ?? editCtx?.onSubmit) as
    | NonNullable<typeof addCtx>['onSubmit']
    | undefined
  const categories = addCtx?.categories ?? editCtx?.categories ?? []

  const {
    name,
    price,
    categoryId,
    active,
    setActive,
    iconPreview,
    presetEmoji,
    iconType,
    generatedIconBlob,
    barcode,
    barcodeFormat,
    barcodeSource,
    editingProduct,
    newStockValue,
    isSaving,
    setIsSaving,
    setError,
    setProductSaved,
    setLastSavedProductNumber,
    error,
    pipelineStep,
  } = useProductForm()

  const [savingLocal, setSavingLocal] = useState(false)

  const handleToggleActive = () => {
    if (!isEdit || !editingProduct) return
    setActive(!active)
  }

  const openDeleteConfirm = () => {
    setError('')
    nav.push('delete-confirm')
  }

  const { hasChanges } = useProductFormValidation()

  const isFormValid =
    name.trim().length > 0 && parseFloat(price) > 0 && !isNaN(parseFloat(price))

  const categoryName =
    categories.find((c) => c.id === categoryId)?.name ??
    t.formatMessage({ id: 'productForm.category_none' })

  // `newStockValue` is the source of truth on both paths:
  //   - Add path: the value the user entered in CategoryStockStep.
  //   - Edit path: initialized to editingProduct.stock by
  //     populateFromProduct and not mutated from inside this modal —
  //     stock adjustment lives entirely in AdjustStockModal (reached
  //     via the Review stock row's onRequestAdjustStock callback). The
  //     conditional save-stock branch below is therefore inert on edit
  //     but kept defensively for the unlikely case where a future
  //     refactor reintroduces in-form stock mutation.
  const stockValue = newStockValue

  const handleSave = async () => {
    if (!isFormValid || !onSubmit || savingLocal) return
    setError('')
    setIsSaving(true)
    setSavingLocal(true)
    setProductSaved(false)
    try {
      // Edit path: if stock changed, persist it first via the dedicated
      // optimistic-locked endpoint. Doing this BEFORE the regular product
      // save means a 409 conflict aborts the whole flow before any other
      // field is touched — the user sees the conflict on Review and can
      // retry, instead of half-saving the product with a stale stock.
      if (
        isEdit &&
        editingProduct &&
        editCtx?.onSaveAdjustment &&
        newStockValue !== (editingProduct.stock ?? 0)
      ) {
        await editCtx.onSaveAdjustment({
          productId: editingProduct.id,
          newStockValue,
          expectedStockValue: editingProduct.stock ?? 0,
        })
      }
      const saved = await onSubmit(
        {
          name,
          price,
          categoryId,
          active,
          generatedIconBlob,
          iconType,
          presetEmoji,
          barcode,
          barcodeFormat,
          barcodeSource,
          // Stock is owned by the dedicated adjust endpoint on the edit
          // path (called above); initialStock only matters on Add.
          initialStock: isEdit ? undefined : newStockValue,
        },
        editingProduct?.id ?? null,
      )
      if (!saved) {
        setError(t.formatMessage({ id: 'productForm.failed_to_save' }))
        return
      }
      setProductSaved(true)
      setLastSavedProductNumber(
        saved.productNumber ?? editingProduct?.productNumber ?? null,
      )
      nav.push(isEdit ? 'edit-success' : 'add-success')
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t.formatMessage({ id: 'productForm.failed_to_save' }),
      )
    } finally {
      setIsSaving(false)
      setSavingLocal(false)
    }
  }

  const handleClose = () => {
    const cb = addCtx ?? editCtx
    cb?.onClose()
  }

  // Push a step in edit mode — that step's "Done" CTA will pop back to
  // this Review surface, preserving the user's place.
  const editName = () => nav.push('name-edit')
  const editPrice = () => nav.push('price-edit')
  const editCategory = () => nav.push('category-stock-edit')
  const editBarcode = () => nav.push('barcode-edit')
  // Edit-only: stock on hand is owned by AdjustStockModal — the single
  // canonical surface for stock adjustment across the app. Tapping the
  // row asks the host to close this edit modal and open AdjustStockModal
  // for the same product. On Add the stock value is just an initial
  // value collected by CategoryStockStep, so the row routes there
  // instead. This unifies the three former adjustment paths
  // (Inventory-tab tap, Products-tab swipe, Review-stock-row) into one.
  const editStock = () => {
    if (isEdit && editCtx?.onRequestAdjustStock) {
      editCtx.onRequestAdjustStock()
    } else {
      nav.push('category-stock-edit')
    }
  }

  return (
    <>
      <IonHeader className="pm-header">
        <IonToolbar>
          <IonTitle>
            {t.formatMessage({
              id: isEdit
                ? 'productAddEdit.review_title_edit'
                : 'productAddEdit.review_title_add',
            })}
          </IonTitle>
          <IonButtons slot="end">
            <IonButton
              fill="clear"
              onClick={handleClose}
              aria-label={t.formatMessage({ id: 'common.close' })}
            >
              <IonIcon icon={close} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="pm-content">
        <div className="pm-shell pm-review">
          <header className="pm-hero">
            <span className="pm-hero__eyebrow">
              {t.formatMessage({ id: 'productAddEdit.review_eyebrow' })}
            </span>
            <h1 className="pm-hero__title">
              {t.formatMessage(
                { id: 'productAddEdit.review_title' },
                { em: (chunks) => <em>{chunks}</em> },
              )}
            </h1>
          </header>

          {error && <div className="pm-error">{error}</div>}

          {/* Visual identity preview — large icon tile + Fraunces italic
              name. Tapping it jumps to NameStep in edit mode. */}
          <button
            type="button"
            className="pm-review__hero-card"
            onClick={editName}
            aria-label={t.formatMessage({ id: 'productAddEdit.review_edit_name_aria' })}
          >
            <div className="pm-review__icon">
              {iconPreview && isPresetIcon(iconPreview) ? (
                (() => {
                  const p = getPresetIcon(iconPreview)
                  return p ? (
                    <p.icon size={36} className="text-text-primary" />
                  ) : null
                })()
              ) : iconPreview ? (
                <Image
                  src={iconPreview}
                  alt=""
                  width={72}
                  height={72}
                  className="object-cover w-full h-full"
                  unoptimized
                />
              ) : (
                <ImagePlus size={28} className="text-text-tertiary" />
              )}
            </div>
            <div className="pm-review__hero-text">
              <span className="pm-review__name">
                {name.trim() ||
                  t.formatMessage({ id: 'productAddEdit.review_name_placeholder' })}
              </span>
              <span className="pm-review__category">{categoryName}</span>
            </div>
            <span className="pm-review__chev" aria-hidden="true">
              <ChevronRight size={18} />
            </span>
          </button>

          {/* Field ledger — each row is a tappable button with a
              dotted-leader rhythm. Tap pushes the matching step in
              edit mode. */}
          <div className="pm-review__ledger">
            <ReviewRow
              label={t.formatMessage({ id: 'productForm.price_label' })}
              value={
                parseFloat(price) > 0
                  ? formatCurrency(parseFloat(price))
                  : t.formatMessage({ id: 'productAddEdit.review_value_unset' })
              }
              valueIsSet={parseFloat(price) > 0}
              onClick={editPrice}
            />
            <ReviewRow
              label={t.formatMessage({ id: 'productForm.category_label' })}
              value={categoryName}
              valueIsSet={!!categoryId}
              onClick={editCategory}
            />
            <ReviewRow
              label={t.formatMessage({
                id: 'productAddEdit.step_initial_stock_label',
              })}
              value={t.formatMessage(
                { id: 'products.units_count' },
                { count: stockValue },
              )}
              valueIsSet={true}
              onClick={editStock}
            />
            <ReviewRow
              label={t.formatMessage({ id: 'productForm.tab_barcode' })}
              value={
                barcode
                  ? barcode
                  : t.formatMessage({ id: 'productAddEdit.review_value_unset' })
              }
              valueIsSet={!!barcode}
              onClick={editBarcode}
              valueIsMono
            />
          </div>

          {/* Manager-only inline status toggle + footer trash affordance.
              The toggle row uses .pd-toggle-value (defined in
              products-modal-add-edit.css). */}
          {!isEdit && pipelineStep === 'complete' && (
            <p className="pm-review__ai-disclaimer">
              {t.formatMessage({ id: 'productAddEdit.review_ai_disclaimer' })}
            </p>
          )}

          {isEdit && editCtx?.canDelete && editingProduct && (
            <>
              <p className="pm-review__status-hint">
                {t.formatMessage({ id: 'productAddEdit.active_hint' })}
              </p>
              <IonList
                inset
                lines="full"
                className="account-list pm-review__status"
              >
                <IonItem lines="none">
                  <Power
                    slot="start"
                    className="text-text-secondary w-5 h-5"
                  />
                  <IonLabel>
                    <h3>
                      {t.formatMessage({ id: 'productAddEdit.active_label' })}
                    </h3>
                  </IonLabel>
                  <span
                    slot="end"
                    className="pd-toggle-value"
                    data-active={active}
                  >
                    <span>
                      {t.formatMessage({
                        id: active
                          ? 'productAddEdit.active_status_active'
                          : 'productAddEdit.active_status_inactive',
                      })}
                    </span>
                    <IonToggle
                      checked={active}
                      disabled={savingLocal || isSaving}
                      onIonChange={handleToggleActive}
                      aria-label={t.formatMessage({
                        id: 'productAddEdit.active_label',
                      })}
                    />
                  </span>
                </IonItem>
              </IonList>
            </>
          )}
        </div>
      </IonContent>

      <IonFooter className="pm-footer">
        <IonToolbar>
          <div className="modal-footer">
            <div className="pm-review__actions">
              {isEdit && editCtx?.canDelete && (
                <button
                  type="button"
                  className="pm-review__icon-action pm-review__icon-action--delete"
                  onClick={openDeleteConfirm}
                  disabled={savingLocal || isSaving}
                  aria-label={t.formatMessage({
                    id: 'productAddEdit.delete_button_aria',
                  })}
                >
                  <Trash2 size={18} strokeWidth={1.8} />
                </button>
              )}
              <IonButton
                onClick={handleSave}
                disabled={!isFormValid || !hasChanges || savingLocal || isSaving}
                data-haptic
              >
                {savingLocal || isSaving ? (
                  <IonSpinner name="crescent" />
                ) : (
                  t.formatMessage({
                    id: isEdit
                      ? 'productAddEdit.review_save_edit'
                      : 'productAddEdit.review_save_add',
                  })
                )}
              </IonButton>
            </div>
          </div>
        </IonToolbar>
      </IonFooter>
    </>
  )
}

interface ReviewRowProps {
  label: string
  value: string
  valueIsSet: boolean
  onClick: () => void
  valueIsMono?: boolean
}

function ReviewRow({ label, value, valueIsSet, onClick, valueIsMono }: ReviewRowProps) {
  const valueClass = [
    'pm-review-row__value',
    valueIsMono ? 'pm-review-row__value--mono' : '',
    !valueIsSet ? 'pm-review-row__value--unset' : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button type="button" className="pm-review-row" onClick={onClick}>
      <span className="pm-review-row__label">{label}</span>
      <span className="pm-review-row__leader" aria-hidden="true" />
      <span className={valueClass}>{value}</span>
      <ChevronRight className="pm-review-row__chev" size={14} />
    </button>
  )
}
