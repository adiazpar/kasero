import { useMemo } from 'react'
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
import { AuthField } from '@/components/auth'
import { useCreateBusinessCtx, useCreateBusinessNav } from '../CreateBusinessModal'

export function NameStep() {
  const t = useIntl()
  const nav = useCreateBusinessNav()
  const { formData, setName, isNameValid, handleClose, handleExitComplete } = useCreateBusinessCtx()

  function handleCancel() {
    handleClose()
    handleExitComplete()
  }

  function handleNext() {
    nav.push('locale')
  }

  // Title with one italic-terracotta accent word. The emphasis term is
  // sourced from i18n so locales pick a word that lands the same accent
  // (English: "called"; Spanish: e.g. "llama"). When the term isn't
  // present in the resolved title, we render plain text — graceful
  // fallback rather than a broken match.
  const titleNode = useMemo(() => {
    const full = t.formatMessage({ id: 'createBusiness.name_title' })
    const emphasis = t.formatMessage({ id: 'createBusiness.name_title_emphasis' })
    const idx = emphasis ? full.indexOf(emphasis) : -1
    if (!emphasis || idx === -1) return full
    return (
      <>
        {full.slice(0, idx)}
        <em>{emphasis}</em>
        {full.slice(idx + emphasis.length)}
      </>
    )
  }, [t])

  const trimmed = formData.name.trim()

  return (
    <>
      <IonHeader>
        <IonToolbar className="wizard-toolbar">
          <IonTitle>{t.formatMessage({ id: 'createBusiness.toolbar_title' })}</IonTitle>
          <IonButtons slot="end">
            <IonButton fill="clear" onClick={handleCancel} aria-label={t.formatMessage({ id: 'common.close' })}>
              <IonIcon icon={close} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>

      <IonContent className="wizard-content">
        <div className="wizard-step">
          <header className="wizard-hero">
            <div className="wizard-hero__eyebrow">
              {t.formatMessage(
                { id: 'createBusiness.step_indicator' },
                { current: 1, total: 3 },
              )}
            </div>
            <h1 className="wizard-hero__title">{titleNode}</h1>
            <p className="wizard-hero__subtitle">
              {t.formatMessage({ id: 'createBusiness.name_subtitle' })}
            </p>
          </header>

          <div className="create-business__name-form">
            <AuthField
              label={t.formatMessage({ id: 'createBusiness.name_label' })}
              type="text"
              value={formData.name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.formatMessage({ id: 'createBusiness.name_placeholder' })}
              maxLength={100}
              autoComplete="off"
              autoFocus
            />

            {/* Live echo — quietly mirrors the typed name in Fraunces italic.
                Skipped for empty inputs to avoid an empty stage. User content
                is rendered verbatim (i18n rule). */}
            <div
              className="create-business__name-echo"
              data-active={trimmed.length > 0}
              aria-hidden="true"
            >
              <span className="create-business__name-echo-label">
                {t.formatMessage({ id: 'createBusiness.name_echo_label' })}
              </span>
              <span className="create-business__name-echo-value">
                {trimmed || ' '}
              </span>
            </div>
          </div>
        </div>
      </IonContent>

      <IonFooter>
        <IonToolbar>
          <div className="modal-footer">
            <IonButton
              expand="block"
              disabled={!isNameValid}
              onClick={handleNext}
            >
              {t.formatMessage({ id: 'common.continue' })}
            </IonButton>
          </div>
        </IonToolbar>
      </IonFooter>
    </>
  )
}
