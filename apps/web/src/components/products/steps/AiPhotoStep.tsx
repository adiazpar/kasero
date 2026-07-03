import { useIntl } from 'react-intl'
import { useRef, useEffect } from 'react'
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
import { Camera } from 'lucide-react'
import { useProductNav, useAddProductCallbacks } from './ProductNavContext'

export function AiPhotoStep() {
  const t = useIntl()
  const nav = useProductNav()
  const { onAiPhotoCapture, onClearPendingPhoto, onClose } = useAddProductCallbacks()
  const photoInputRef = useRef<HTMLInputElement>(null)

  // Clear any previously stashed photo when this step mounts so the user
  // starts fresh each time they land here.
  useEffect(() => {
    onClearPendingPhoto()
    if (photoInputRef.current) {
      photoInputRef.current.value = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handlePhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    onAiPhotoCapture(e).then(() => {
      if (photoInputRef.current) {
        photoInputRef.current.value = ''
      }
      nav.push('ai-barcode')
    })
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
            {t.formatMessage({ id: 'productForm.ai_step_photo_title' })}
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
              {t.formatMessage({ id: 'productAddEdit.ai_photo_eyebrow' })}
            </span>
            <h1 className="pm-hero__title">
              {t.formatMessage(
                { id: 'productAddEdit.ai_photo_title' },
                { em: (chunks) => <em key="em">{chunks}</em> },
              )}
            </h1>
            <p className="pm-hero__subtitle">
              {t.formatMessage({ id: 'productForm.ai_step_photo_instructions' })}
            </p>
          </header>

          <div className="pm-ai-photo">
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              className="pm-ai-dropzone"
            >
              <span className="pm-ai-dropzone__icon">
                <Camera size={28} strokeWidth={1.6} />
              </span>
              <span className="pm-ai-dropzone__title">
                {t.formatMessage({ id: 'productForm.choose_photo_button' })}
              </span>
              <span className="pm-ai-dropzone__desc">
                {t.formatMessage({ id: 'productForm.choose_photo_desc' })}
              </span>
              <span className="pm-ai-dropzone__stamp">
                {t.formatMessage({ id: 'productAddEdit.ai_photo_stamp' })}
              </span>
            </button>

            <span className="pm-ai-step-indicator">
              <span className="pm-ai-step-indicator__num">1</span>
              <span className="pm-ai-step-indicator__sep">/</span>
              <span>2</span>
            </span>
          </div>

          <input
            ref={photoInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            onChange={handlePhotoSelected}
            className="hidden"
          />
        </div>
      </IonContent>

      <IonFooter className="pm-footer">
        <IonToolbar className="ion-padding-horizontal" />
      </IonFooter>
    </>
  )
}
