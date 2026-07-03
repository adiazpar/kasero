import { useIntl } from 'react-intl'
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonFooter,
  IonButtons,
  IonIcon,
  IonSpinner,
  IonButton,
} from '@ionic/react'
import { close, chevronBack } from 'ionicons/icons'
import { useProductForm } from '@/contexts/product-form-context'
import { useProductNav, useEditProductCallbacks } from './ProductNavContext'

export function DeleteConfirmStep() {
  const t = useIntl()
  const nav = useProductNav()
  const { onDelete, onClose } = useEditProductCallbacks()
  // depth === 1 → entry root (e.g. opened from swipe action), no back chevron.
  const isEntryRoot = nav.depth === 1
  const {
    editingProduct,
    isDeleting,
    setProductDeleted,
    setError,
    error,
  } = useProductForm()

  const handleDelete = async () => {
    if (!editingProduct) return
    setError('')
    try {
      const ok = await onDelete(editingProduct.id)
      if (ok) {
        setProductDeleted(true)
        nav.push('delete-success')
      } else {
        setError(t.formatMessage({ id: 'productForm.failed_to_delete' }))
        nav.pop()
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t.formatMessage({ id: 'productForm.failed_to_delete' }),
      )
      nav.pop()
    }
  }

  return (
    <>
      <IonHeader className="pm-header">
        <IonToolbar>
          {!isEntryRoot && (
            <IonButtons slot="start">
              <IonButton
                fill="clear"
                onClick={() => nav.pop()}
                aria-label={t.formatMessage({ id: 'common.back' })}
              >
                <IonIcon icon={chevronBack} />
              </IonButton>
            </IonButtons>
          )}
          <IonTitle>
            {t.formatMessage({ id: 'productForm.title_delete_product' })}
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
          <header className="pm-hero">
            <span className="pm-hero__eyebrow pm-hero__eyebrow--danger">
              {t.formatMessage({ id: 'productAddEdit.delete_eyebrow' })}
            </span>
            <h1 className="pm-hero__title pm-hero__title--danger">
              {t.formatMessage(
                { id: 'productAddEdit.delete_title' },
                { em: (chunks) => <em key="em">{chunks}</em> },
              )}
            </h1>
          </header>

          {error && <div className="pm-error">{error}</div>}

          <div className="pm-delete">
            {editingProduct && (
              <span className="pm-delete__name-stamp">
                <span className="pm-delete__name-stamp-mark">
                  {t.formatMessage({ id: 'productAddEdit.delete_stamp_mark' })}
                </span>
                <span className="pm-delete__name-stamp-name">
                  {editingProduct.name}
                </span>
              </span>
            )}

            <div className="pm-delete__panel">
              <ul className="pm-delete__bullet-list">
                <li className="pm-delete__bullet">
                  {t.formatMessage({ id: 'productAddEdit.delete_bullet_records' })}
                </li>
                <li className="pm-delete__bullet">
                  {t.formatMessage({ id: 'productAddEdit.delete_bullet_pos' })}
                </li>
                <li className="pm-delete__bullet">
                  {t.formatMessage({ id: 'productAddEdit.delete_bullet_undo' })}
                </li>
              </ul>
            </div>
          </div>
        </div>
      </IonContent>

      <IonFooter className="pm-footer">
        <IonToolbar>
          <div className="modal-footer">
            <IonButton
              color="danger"
              onClick={handleDelete}
              disabled={isDeleting}
              data-haptic
            >
              {isDeleting ? (
                <IonSpinner name="crescent" />
              ) : (
                t.formatMessage({ id: 'productAddEdit.delete_cta' })
              )}
            </IonButton>
          </div>
        </IonToolbar>
      </IonFooter>
    </>
  )
}
