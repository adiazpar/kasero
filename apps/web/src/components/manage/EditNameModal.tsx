'use client'

import { useIntl } from 'react-intl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { IonButton, IonSpinner } from '@ionic/react'
import { ModalShell } from '@/components/ui/modal-shell'
import { AuthField } from '@/components/auth'
import { LottiePlayerDynamic as LottiePlayer } from '@/components/animations'
import { useBusiness } from '@/contexts/business-context'
import { useUpdateBusiness } from '@/hooks/useUpdateBusiness'

interface Props { isOpen: boolean; onClose: () => void }

type Step = 'form' | 'save-success'

export function EditNameModal({ isOpen, onClose }: Props) {
  const intl = useIntl()
  const { business } = useBusiness()
  const { update, isSubmitting, error, reset } = useUpdateBusiness()
  const [step, setStep] = useState<Step>('form')
  const [saved, setSaved] = useState(false)
  const [name, setName] = useState(business?.name ?? '')

  // Reset state only when the modal transitions from closed to open. The
  // parent's refreshBusiness() inside useUpdateBusiness.update fires
  // `business.name` change BEFORE handleSave's step transition lands; a
  // reset on every business?.name change would clobber step='save-success'
  // back to 'form' (same class of bug that hid the Lottie on the per-field
  // provider modals).
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setStep('form')
      setSaved(false)
      setName(business?.name ?? '')
    }
    wasOpenRef.current = isOpen
  }, [isOpen, business?.name])

  // Delayed cleanup after the dismissal animation so the form doesn't
  // flash back to its initial state while the modal is still sliding away.
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        reset()
        setSaved(false)
        setStep('form')
      }, 250)
      return () => clearTimeout(timer)
    }
  }, [isOpen, reset])

  const trimmed = name.trim()
  const hasInput = trimmed.length > 0
  const hasChanges = hasInput && trimmed !== business?.name
  const canSave = hasChanges && !isSubmitting

  const handleSave = async () => {
    if (!hasChanges) { onClose(); return }
    const ok = await update({ name: trimmed })
    if (ok) {
      setSaved(true)
      setStep('save-success')
    }
  }

  // Title with italic emphasis on the accent word.
  const titleNode = useMemo(() => {
    const full = intl.formatMessage({ id: 'manage.edit_name_hero_title' })
    const emphasis = intl.formatMessage({ id: 'manage.edit_name_hero_title_emphasis' })
    const idx = full.indexOf(emphasis)
    if (!emphasis || idx === -1) return full
    return (
      <>
        {full.slice(0, idx)}
        <em>{emphasis}</em>
        {full.slice(idx + emphasis.length)}
      </>
    )
  }, [intl])

  const echoTagText = hasChanges
    ? intl.formatMessage({ id: 'manage.edit_name_echo_tag' })
    : intl.formatMessage({ id: 'manage.edit_name_echo_tag_unchanged' })

  const title = intl.formatMessage({ id: 'manage.edit_name_title' })

  const footer = step === 'form' ? (
    <IonButton
      expand="block"
      onClick={handleSave}
      disabled={!canSave}
      className="flex-1"
    >
      {isSubmitting ? <IonSpinner name="crescent" /> : intl.formatMessage({ id: 'manage.save' })}
    </IonButton>
  ) : (
    <IonButton
      expand="block"
      onClick={onClose}
      className="flex-1"
    >
      {intl.formatMessage({ id: 'common.done' })}
    </IonButton>
  )

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      chromeless={step === 'save-success'}
      footer={footer}
      noSwipeDismiss
    >
      {step === 'form' && (
        <>
          {error && <div className="modal-error">{error}</div>}

          <header className="modal-hero edit-name__hero">
            <div className="modal-hero__eyebrow">
              {intl.formatMessage({ id: 'manage.edit_name_eyebrow' })}
            </div>
            <h1 className="modal-hero__title">{titleNode}</h1>
            <p className="modal-hero__subtitle">
              {intl.formatMessage({ id: 'manage.edit_name_hero_subtitle' })}
            </p>
          </header>

          <div className="edit-name__form">
            <AuthField
              label={intl.formatMessage({ id: 'manage.edit_name_field_label' })}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              autoComplete="off"
              autoCapitalize="words"
              spellCheck={false}
              required
            />

            {/* Echo card — quiet Fraunces italic preview of the typed name. */}
            <div
              className="edit-name__echo"
              data-active={hasInput ? 'true' : 'false'}
              aria-hidden={!hasInput}
            >
              <div className="edit-name__echo-label">
                <span>{intl.formatMessage({ id: 'manage.edit_name_echo_label' })}</span>
                <span
                  className={
                    'edit-name__echo-tag' +
                    (hasChanges ? '' : ' edit-name__echo-tag--quiet')
                  }
                >
                  {echoTagText}
                </span>
              </div>
              <span className="edit-name__echo-value">{trimmed || ' '}</span>
            </div>
          </div>
        </>
      )}

      {step === 'save-success' && (
        <div className="manage-seal" aria-hidden={!saved}>
          <div className="manage-seal__lottie">
            {saved && (
              <LottiePlayer
                src="/animations/success.json"
                loop={false}
                autoplay={true}
                delay={300}
                style={{ width: 144, height: 144 }}
              />
            )}
          </div>

          <span className="manage-seal__stamp">
            {intl.formatMessage({ id: 'manage.edit_name_success_stamp' })}
          </span>

          <h2 className="manage-seal__title">
            {intl.formatMessage(
              { id: 'manage.edit_name_success_title' },
              { em: (chunks) => <em key="em">{chunks}</em> },
            )}
          </h2>

          <p className="manage-seal__subtitle">
            {intl.formatMessage({ id: 'manage.edit_name_success_subtitle' })}
          </p>
        </div>
      )}
    </ModalShell>
  )
}
