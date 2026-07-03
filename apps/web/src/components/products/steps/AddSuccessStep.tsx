import { useIntl } from 'react-intl'
import {
  IonContent,
  IonFooter,
  IonToolbar,
  IonButton,
} from '@ionic/react'
import { LottiePlayerDynamic as LottiePlayer } from '@/components/animations'
import { useProductForm } from '@/contexts/product-form-context'
import { useAddProductCallbacks } from './ProductNavContext'

export function AddSuccessStep() {
  const t = useIntl()
  const { productSaved, lastSavedProductNumber } = useProductForm()
  const { onClose } = useAddProductCallbacks()
  const stampNumber = lastSavedProductNumber != null
    ? lastSavedProductNumber.toString().padStart(4, '0')
    : null

  function handleDone() {
    onClose()
  }

  return (
    <>
      <IonContent className="pm-content">
        <div className="pm-success">
          <div className="pm-success__lottie">
            {productSaved && (
              <LottiePlayer
                src="/animations/success.json"
                loop={false}
                autoplay={true}
                delay={300}
                style={{ width: 144, height: 144 }}
              />
            )}
          </div>

          <span
            className="pm-success__stamp"
            style={{ opacity: productSaved ? 1 : 0 }}
            aria-hidden={!productSaved}
          >
            <span className="pm-success__stamp-id">
              {t.formatMessage({ id: 'productAddEdit.success_stamp_id' })}
              {stampNumber && (
                <>
                  {' '}
                  <span className="pm-success__stamp-num">{stampNumber}</span>
                </>
              )}
            </span>
            <span className="pm-success__stamp-dot">·</span>
            <span className="pm-success__stamp-state pm-success__stamp-state--created">
              {t.formatMessage({ id: 'productAddEdit.success_stamp_created' })}
            </span>
          </span>

          <h2
            className="pm-success__heading"
            style={{ opacity: productSaved ? 1 : 0, transition: 'opacity 300ms' }}
          >
            {t.formatMessage(
              { id: 'productAddEdit.success_created_title' },
              { em: (chunks) => <em key="em">{chunks}</em> },
            )}
          </h2>

          <p
            className="pm-success__caption"
            style={{ opacity: productSaved ? 1 : 0, transition: 'opacity 300ms 100ms' }}
          >
            {t.formatMessage({ id: 'productForm.success_created_description' })}
          </p>
        </div>
      </IonContent>

      <IonFooter className="pm-footer">
        <IonToolbar>
          <div className="modal-footer">
            <IonButton onClick={handleDone}>
              {t.formatMessage({ id: 'common.done' })}
            </IonButton>
          </div>
        </IonToolbar>
      </IonFooter>
    </>
  )
}
