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
import { useProductForm } from '@/contexts/product-form-context'
import { SuggestedCategoryStep } from '../SuggestedCategoryStep'
import { useProductNav, useAddProductCallbacks } from './ProductNavContext'

export function SuggestedCategoryStepWrapper() {
  const t = useIntl()
  const nav = useProductNav()
  const { suggestedCategoryName, categories, onCreateCategory, onClose } =
    useAddProductCallbacks()
  const { setCategoryId } = useProductForm()

  function goToForm() {
    nav.push('review')
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
            {t.formatMessage({ id: 'productForm.ai_step_new_category_title' })}
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
            <span className="pm-hero__eyebrow">
              {t.formatMessage({ id: 'productAddEdit.suggested_eyebrow' })}
            </span>
            <h1 className="pm-hero__title">
              {t.formatMessage(
                { id: 'productAddEdit.suggested_title' },
                {
                  em: (chunks) => <em key="em">{chunks}</em>,
                  name: suggestedCategoryName ?? '',
                },
              )}
            </h1>
          </header>

          <SuggestedCategoryStep
            suggestedName={suggestedCategoryName ?? ''}
            categories={categories}
            onCreate={async (newName) => {
              const newId = await onCreateCategory(newName)
              if (newId) {
                setCategoryId(newId)
                goToForm()
              }
              return newId
            }}
            onPickExisting={(id) => {
              setCategoryId(id)
              goToForm()
            }}
          />
        </div>
      </IonContent>

      <IonFooter className="pm-footer">
        <IonToolbar>
          <div className="modal-footer">
            <IonButton
              fill="outline"
              className="pm-ghost-btn"
              onClick={goToForm}
            >
              {t.formatMessage({ id: 'productForm.skip_for_now' })}
            </IonButton>
          </div>
        </IonToolbar>
      </IonFooter>
    </>
  )
}
