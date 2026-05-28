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
import { close, chevronBack } from 'ionicons/icons'
import { LocalePicker } from '@/components/businesses/shared'
import { useCreateBusinessCtx, useCreateBusinessNav } from '../CreateBusinessModal'

export function LocaleStep() {
  const t = useIntl()
  const nav = useCreateBusinessNav()
  const { formData, setLocale, handleClose, handleExitComplete } = useCreateBusinessCtx()

  function handleCancel() {
    handleClose()
    handleExitComplete()
  }

  function handleNext() {
    nav.push('logo')
  }

  const titleNode = useMemo(() => {
    const full = t.formatMessage({ id: 'createBusiness.locale_title' })
    const emphasis = t.formatMessage({ id: 'createBusiness.locale_title_emphasis' })
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

  return (
    <>
      <IonHeader>
        <IonToolbar className="wizard-toolbar">
          <IonButtons slot="start">
            <IonButton
              fill="clear"
              onClick={() => nav.pop()}
              aria-label={t.formatMessage({ id: 'common.back' })}
            >
              <IonIcon icon={chevronBack} />
            </IonButton>
          </IonButtons>
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
                { current: 2, total: 3 },
              )}
            </div>
            <h1 className="wizard-hero__title">{titleNode}</h1>
            <p className="wizard-hero__subtitle">
              {t.formatMessage({ id: 'createBusiness.locale_subtitle' })}
            </p>
          </header>

          <div className="create-business__locale-shelf">
            <LocalePicker value={formData.locale} onChange={setLocale} />
          </div>
        </div>
      </IonContent>

      <IonFooter>
        <IonToolbar>
          <div className="modal-footer">
            <IonButton expand="block" onClick={handleNext}>
              {t.formatMessage({ id: 'common.continue' })}
            </IonButton>
          </div>
        </IonToolbar>
      </IonFooter>
    </>
  )
}
