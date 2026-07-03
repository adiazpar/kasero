'use client'

import { useIntl } from 'react-intl';
import { useEffect, useRef, useState } from 'react'
import { ArrowRightLeft } from 'lucide-react'
import { IonButton, IonSpinner } from '@ionic/react'
import { ModalShell } from '@/components/ui'
import { LottiePlayerDynamic as LottiePlayer } from '@/components/animations'
import { useIncomingTransferContext } from '@/contexts/incoming-transfer-context'

interface Props {
  isOpen: boolean
  onClose: () => void
}

type ExpiryLabel = {
  id:
    | 'manage.transfer_pending_expires_soon'
    | 'manage.transfer_pending_expires_hours'
    | 'manage.transfer_pending_expires_minutes'
  values: Record<string, number>
}

function useExpiryLabel(expiresAt: string | undefined): ExpiryLabel | null {
  const [, bump] = useState(0)
  useEffect(() => {
    if (!expiresAt) return
    const interval = setInterval(() => bump((n) => n + 1), 60_000)
    return () => clearInterval(interval)
  }, [expiresAt])

  if (!expiresAt) return null
  const msRemaining = new Date(expiresAt).getTime() - Date.now()
  if (msRemaining <= 60_000) {
    return { id: 'manage.transfer_pending_expires_soon', values: {} }
  }
  const hoursRemaining = Math.floor(msRemaining / 3_600_000)
  if (hoursRemaining >= 1) {
    return {
      id: 'manage.transfer_pending_expires_hours',
      values: { hours: hoursRemaining },
    }
  }
  const minutesRemaining = Math.floor(msRemaining / 60_000)
  return {
    id: 'manage.transfer_pending_expires_minutes',
    values: { minutes: minutesRemaining },
  }
}

type Step = 'review' | 'accept-success'

export function IncomingTransferModal({ isOpen, onClose }: Props) {
  const intl = useIntl()
  const {
    transfer,
    error,
    isAccepting,
    isDeclining,
    handleAccept,
    handleDecline,
  } = useIncomingTransferContext()
  const expiry = useExpiryLabel(transfer?.expiresAt)

  const [step, setStep] = useState<Step>('review')
  // Snapshot the accepted business name so the celebration still has it
  // after `setTransfer(null)` clears the source-of-truth in context.
  const [acceptedBusinessName, setAcceptedBusinessName] = useState<string | null>(null)

  // Open-time reset, gated on close→open transition. Without this, the
  // transfer disappearing from context after accept would re-fire the
  // effect and reset 'accept-success' back to 'review'.
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setStep('review')
      setAcceptedBusinessName(null)
    }
    wasOpenRef.current = isOpen
  }, [isOpen])

  // Auto-close on review step if the transfer disappears (e.g. successful
  // decline, sender cancels in another tab). Suppressed on the success
  // step — that step intentionally outlives the transfer state.
  useEffect(() => {
    if (step !== 'review') return
    if (isOpen && !transfer && !isAccepting && !isDeclining) onClose()
  }, [isOpen, transfer, isAccepting, isDeclining, onClose, step])

  const busy = isAccepting || isDeclining

  const onAccept = async () => {
    if (!transfer) return
    const name = transfer.business.name
    const ok = await handleAccept()
    if (ok) {
      setAcceptedBusinessName(name)
      setStep('accept-success')
    }
  }

  // Any dismiss from the success step triggers a reload so every context
  // picks up the new ownership + membership state. The reload unmounts
  // the modal automatically, so onClose() is redundant.
  const finishAndReload = () => {
    window.location.reload()
  }

  const description = transfer
    ? transfer.fromUser
      ? intl.formatMessage({
    id: 'account.incoming_transfer_description'
  }, {
          name: transfer.fromUser.name,
          business: transfer.business.name,
        })
      : intl.formatMessage({
    id: 'account.incoming_transfer_description_anonymous'
  }, {
          business: transfer.business.name,
        })
    : ''

  // Review step keeps its headered title. The terminal accept-success step
  // is chromeless — no header bar, closed via the footer CTA.
  const isSuccessStep = step === 'accept-success'
  const title = isSuccessStep
    ? undefined
    : intl.formatMessage({ id: 'account.incoming_transfer_heading' })

  const footer = step === 'review' ? (
    <>
      <IonButton
        fill="outline"
        onClick={handleDecline}
        disabled={busy || !transfer}
        className="flex-1"
        data-haptic
      >
        {isDeclining ? <IonSpinner name="crescent" /> : intl.formatMessage({
          id: 'account.incoming_transfer_decline'
        })}
      </IonButton>
      <IonButton
        onClick={onAccept}
        disabled={busy || !transfer}
        className="flex-1"
        data-haptic
      >
        {isAccepting ? <IonSpinner name="crescent" /> : intl.formatMessage({
          id: 'account.incoming_transfer_accept'
        })}
      </IonButton>
    </>
  ) : (
    <IonButton
      onClick={finishAndReload}
      className="flex-1"
      expand="block"
      data-haptic
    >
      {intl.formatMessage({ id: 'account.incoming_transfer_success_cta' })}
    </IonButton>
  )

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={step === 'accept-success' ? finishAndReload : onClose}
      title={title}
      chromeless={isSuccessStep}
      footer={footer}
      noSwipeDismiss={isSuccessStep}
    >
      {step === 'review' && (
        <>
          <div
            className="p-3 rounded-lg flex items-start gap-3"
            style={{
              backgroundColor:
                'color-mix(in oklab, var(--color-warning) 10%, transparent)',
            }}
          >
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{
                backgroundColor:
                  'color-mix(in oklab, var(--color-warning) 22%, transparent)',
              }}
            >
              <ArrowRightLeft className="w-5 h-5 text-warning" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-warning">
                {intl.formatMessage({
                  id: 'account.incoming_transfer_heading'
                })}
              </p>
              <p className="text-xs text-text-secondary mt-1">{description}</p>
              {expiry && (
                <p className="text-xs text-text-secondary mt-1">
                  {intl.formatMessage({ id: expiry.id }, expiry.values)}
                </p>
              )}
            </div>
          </div>
          {error && (
            <div className="mt-3 p-3 bg-error-subtle text-error text-sm rounded-lg">
              {error}
            </div>
          )}
        </>
      )}

      {step === 'accept-success' && (
        <div className="manage-seal" aria-hidden={step !== 'accept-success'}>
          <div className="manage-seal__lottie">
            <LottiePlayer
              src="/animations/success.json"
              loop={false}
              autoplay={true}
              delay={300}
              style={{ width: 144, height: 144 }}
            />
          </div>

          <span className="manage-seal__stamp">
            {intl.formatMessage({ id: 'account.incoming_transfer_success_stamp' })}
          </span>

          <h2 className="manage-seal__title">
            {intl.formatMessage(
              { id: 'account.incoming_transfer_success_hero_title' },
              { em: (chunks) => <em key="em">{chunks}</em> },
            )}
          </h2>

          <p className="manage-seal__subtitle">
            {intl.formatMessage(
              { id: 'account.incoming_transfer_success_subtitle' },
              { business: acceptedBusinessName ?? '' },
            )}
          </p>
        </div>
      )}
    </ModalShell>
  )
}
