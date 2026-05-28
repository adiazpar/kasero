'use client'

import { useIntl } from 'react-intl';
import { useEffect, useState } from 'react'
import { IonButton, IonSpinner } from '@ionic/react'
import { ModalShell, PriceKeypadStep } from '@/components/ui'
import { LottiePlayerDynamic as LottiePlayer } from '@/components/animations'
import { useSalesSessions } from '@/contexts/sales-sessions-context'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'
import { useApiMessage } from '@/hooks/useApiMessage'
import { ApiError } from '@/lib/api-client'
import { ApiMessageCode } from '@kasero/shared/api-messages'

interface OpenSessionModalProps {
  isOpen: boolean
  onClose: () => void
  previousCountedCash: number | null
}

type Step = 0 | 1

export function OpenSessionModal({
  isOpen,
  onClose,
  previousCountedCash,
}: OpenSessionModalProps) {
  const intl = useIntl()
  const { openSession, currentSession } = useSalesSessions()
  const { formatCurrency, formatTime } = useBusinessFormat()
  const translateApiMessage = useApiMessage()

  const [step, setStep] = useState<Step>(0)
  const [startingCashStr, setStartingCashStr] = useState<string>(
    previousCountedCash != null ? previousCountedCash.toString() : '0',
  )
  const [submitting, setSubmitting] = useState(false)
  const [opened, setOpened] = useState(false)
  const [error, setError] = useState('')
  // Snapshot of the value used for the just-confirmed open. Captured before
  // the API call so the success step renders the exact amount the user
  // committed to, even if they later edit the field on retry.
  const [committedAmount, setCommittedAmount] = useState<number>(0)

  // Reset state after the modal closes.
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setStep(0)
        setStartingCashStr(
          previousCountedCash != null ? previousCountedCash.toString() : '0',
        )
        setSubmitting(false)
        setOpened(false)
        setError('')
        setCommittedAmount(0)
      }, 250)
      return () => clearTimeout(timer)
    }
  }, [isOpen, previousCountedCash])

  const handleConfirm = async () => {
    setError('')
    setSubmitting(true)
    const value = parseFloat(startingCashStr) || 0
    setCommittedAmount(value)
    setStep(1)
    try {
      await openSession(value)
      setOpened(true)
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.messageCode === ApiMessageCode.SESSION_ALREADY_OPEN
      ) {
        setError(intl.formatMessage({
          id: 'sales.session.open_modal.error_already_open'
        }))
      } else if (err instanceof ApiError && err.envelope) {
        setError(translateApiMessage(err.envelope))
      } else {
        setError(intl.formatMessage({
          id: 'common.error'
        }))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const isSuccess = step === 1 && opened
  const title = isSuccess
    ? undefined
    : intl.formatMessage({ id: 'sales.session.open_modal.title' })

  // Step 0 footer — primary action
  const step0Footer = (
    <IonButton expand="block" onClick={handleConfirm} disabled={submitting} className="flex-1" data-haptic>
      {intl.formatMessage({ id: 'sales.session.open_modal.confirm' })}
    </IonButton>
  )

  // Step 1 footer — success → Done; error → Back; loading → none
  const step1Footer = opened ? (
    <IonButton expand="block" onClick={onClose} className="flex-1">
      {intl.formatMessage({ id: 'common.done' })}
    </IonButton>
  ) : error ? (
    <IonButton expand="block" fill="outline" onClick={() => setStep(0)} className="flex-1">
      {intl.formatMessage({ id: 'sales.session.open_modal.error_back' })}
    </IonButton>
  ) : null

  const footer = step === 0 ? step0Footer : step1Footer

  // Stamp for the success state. Uses the freshly-opened session's
  // openedAt time when available — the session id is a UUID, not a
  // human-readable counter, so we lean on time-of-open as the
  // identifying mark on the printed-receipt stamp.
  const openedAtTime = currentSession?.openedAt
    ? formatTime(currentSession.openedAt)
    : null

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      chromeless={isSuccess}
      onBack={step === 1 && error ? () => setStep(0) : undefined}
      footer={footer}
      noSwipeDismiss
      noScroll
    >
      {/* Step 0 — enter starting cash via the inline keypad */}
      {step === 0 && (
        <PriceKeypadStep
          value={startingCashStr}
          onValueChange={setStartingCashStr}
          eyebrow={intl.formatMessage({ id: 'sales.session.open_modal.eyebrow' })}
          title={intl.formatMessage(
            { id: 'sales.session.open_modal.hero_title' },
            { em: (chunks) => <em>{chunks}</em> },
          )}
          subtitle={intl.formatMessage({ id: 'sales.session.open_modal.description' })}
          amountLabel={intl.formatMessage({ id: 'sales.session.open_modal.starting_cash' })}
          helper={intl.formatMessage({ id: 'sales.session.open_modal.starting_cash_helper' })}
          ariaLabel={intl.formatMessage({ id: 'sales.session.open_modal.starting_cash' })}
        />
      )}

      {/* Step 1 — loading / success / error */}
      {step === 1 && (
        <div className="open-session__step1">
          {/* Loading */}
          {submitting && !opened && !error && (
            <div className="open-session__loading">
              <IonSpinner name="crescent" />
              <p className="open-session__loading-caption">
                {intl.formatMessage({ id: 'sales.session.open_modal.loading_caption' })}
              </p>
            </div>
          )}

          {/* Success */}
          {opened && (
            <div className="open-session__success">
              <div
                className="open-session__lottie-frame"
                style={{ width: 160, height: 160 }}
              >
                <LottiePlayer
                  src="/animations/success.json"
                  loop={false}
                  autoplay={true}
                  delay={300}
                  style={{ width: 160, height: 160 }}
                />
              </div>

              <div
                className="open-session__stamp"
                aria-hidden={!openedAtTime}
              >
                <span className="open-session__stamp-mark">
                  {intl.formatMessage({ id: 'sales.session.open_modal.stamp_label' })}
                </span>
                <span className="open-session__stamp-dot" aria-hidden="true">·</span>
                <span className="open-session__stamp-state">
                  {intl.formatMessage({ id: 'sales.session.open_modal.stamp_state_open' })}
                </span>
                {openedAtTime && (
                  <>
                    <span className="open-session__stamp-dot" aria-hidden="true">·</span>
                    <span className="open-session__stamp-time">{openedAtTime}</span>
                  </>
                )}
              </div>

              <h2 className="open-session__success-heading">
                {intl.formatMessage(
                  { id: 'sales.session.open_modal.success_title' },
                  { em: (chunks) => <em>{chunks}</em> },
                )}
              </h2>
              <p className="open-session__success-desc">
                {intl.formatMessage({ id: 'sales.session.open_modal.success_subtitle' })}
              </p>

              <dl className="open-session__ledger">
                <div className="open-session__ledger-row">
                  <dt className="open-session__ledger-label">
                    {intl.formatMessage({ id: 'sales.session.open_modal.ledger_starting_cash' })}
                  </dt>
                  <dd className="open-session__ledger-value">
                    {formatCurrency(committedAmount)}
                  </dd>
                </div>
              </dl>
            </div>
          )}

          {/* Error */}
          {error && !opened && (
            <div className="open-session__error">
              <div className="modal-hero__eyebrow modal-hero__eyebrow--danger open-session__error-eyebrow">
                {intl.formatMessage({ id: 'sales.session.open_modal.error_eyebrow' })}
              </div>
              <h2 className="open-session__error-heading">
                {intl.formatMessage(
                  { id: 'sales.session.open_modal.error_title' },
                  { em: (chunks) => <em>{chunks}</em> },
                )}
              </h2>
              <p className="open-session__error-body">{error}</p>
            </div>
          )}
        </div>
      )}
    </ModalShell>
  )
}
