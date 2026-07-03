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
import {
  Sparkles,
  PencilLine,
  ChevronRight,
  Settings2,
} from 'lucide-react'
import { useProductNav, useAddProductCallbacks } from './ProductNavContext'

export function AddEntryStep() {
  const t = useIntl()
  const nav = useProductNav()
  const { onClose, onOpenSettings } = useAddProductCallbacks()

  function handleCancel() {
    onClose()
  }

  function goToAiPhoto() {
    nav.push('ai-photo')
  }

  function goToManual() {
    // Manual entry kicks off the 4-step wizard chain
    // (Name → Price → Category/Stock → Barcode → Review). Each step
    // is mode='forward' so its CTA pushes the next one.
    nav.push('name-forward')
  }

  return (
    <>
      <IonHeader className="pm-header">
        <IonToolbar>
          <IonTitle>{t.formatMessage({ id: 'productForm.title_add' })}</IonTitle>
          <IonButtons slot="end">
            <IonButton
              fill="clear"
              onClick={handleCancel}
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
              {t.formatMessage({ id: 'productAddEdit.entry_eyebrow' })}
            </span>
            <h1 className="pm-hero__title">
              {t.formatMessage(
                { id: 'productAddEdit.entry_title' },
                { em: (chunks) => <em key="em">{chunks}</em> },
              )}
            </h1>
            <p className="pm-hero__subtitle">
              {t.formatMessage({ id: 'productAddEdit.entry_subtitle' })}
            </p>
          </header>

          <div className="pm-entry">
            <div className="pm-entry__choices">
              {/* AI photo path */}
              <button
                type="button"
                onClick={goToAiPhoto}
                className="pm-choice"
              >
                <span className="pm-choice__icon">
                  <Sparkles size={26} strokeWidth={1.6} />
                </span>
                <span className="pm-choice__body">
                  <span className="pm-choice__title">
                    {t.formatMessage({ id: 'productAddEdit.choice_snap_title' })}
                  </span>
                  <span className="pm-choice__desc">
                    {t.formatMessage({ id: 'productAddEdit.choice_snap_desc' })}
                  </span>
                  <span className="pm-choice__meta">
                    <span>{t.formatMessage({ id: 'productAddEdit.choice_snap_meta' })}</span>
                  </span>
                </span>
                <span className="pm-choice__chev">
                  <ChevronRight size={18} />
                </span>
              </button>

            </div>

            <div className="pm-entry__or" aria-hidden="true">
              <span className="pm-entry__or-line" />
              <span className="pm-entry__or-text">
                {t.formatMessage({ id: 'common.or' })}
              </span>
              <span className="pm-entry__or-line" />
            </div>

            <div className="pm-entry__choices">
              {/* Manual form path */}
              <button
                type="button"
                onClick={goToManual}
                className="pm-choice"
              >
                <span className="pm-choice__icon">
                  <PencilLine size={24} strokeWidth={1.6} />
                </span>
                <span className="pm-choice__body">
                  <span className="pm-choice__title">
                    {t.formatMessage({ id: 'productAddEdit.choice_manual_title' })}
                  </span>
                  <span className="pm-choice__desc">
                    {t.formatMessage({ id: 'productAddEdit.choice_manual_desc' })}
                  </span>
                  <span className="pm-choice__meta">
                    <span>{t.formatMessage({ id: 'productAddEdit.choice_manual_meta' })}</span>
                  </span>
                </span>
                <span className="pm-choice__chev">
                  <ChevronRight size={18} />
                </span>
              </button>
            </div>
          </div>
        </div>
      </IonContent>

      <IonFooter className="pm-footer">
        <IonToolbar>
          <div className="modal-footer">
            <IonButton
              fill="outline"
              className="pm-ghost-btn"
              onClick={onOpenSettings}
            >
              <Settings2 size={16} style={{ marginRight: 8 }} />
              {t.formatMessage({ id: 'productForm.settings_button' })}
            </IonButton>
          </div>
        </IonToolbar>
      </IonFooter>
    </>
  )
}
