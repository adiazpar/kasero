'use client'

import { useIntl } from 'react-intl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Clock } from 'lucide-react'
import { IonButton, IonSpinner } from '@ionic/react'
import { ModalShell } from '@/components/ui'
import { LottiePlayerDynamic as LottiePlayer } from '@/components/animations'
import { usePendingTransferContext } from '@/contexts/pending-transfer-context'

interface Props {
  isOpen: boolean
  onClose: () => void
}

/**
 * Recalculates the remaining time to expiry on a 60s tick so the modal's
 * countdown stays live while the user is looking at it.
 */
type ExpiryLabel = {
  id:
    | 'manage.transfer_pending_expires_soon'
    | 'manage.transfer_pending_expires_hours'
    | 'manage.transfer_pending_expires_minutes'
  values: Record<string, number>
  isSoon: boolean
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
    return { id: 'manage.transfer_pending_expires_soon', values: {}, isSoon: true }
  }
  const hoursRemaining = Math.floor(msRemaining / 3_600_000)
  if (hoursRemaining >= 1) {
    return {
      id: 'manage.transfer_pending_expires_hours',
      values: { hours: hoursRemaining },
      isSoon: false,
    }
  }
  const minutesRemaining = Math.floor(msRemaining / 60_000)
  return {
    id: 'manage.transfer_pending_expires_minutes',
    values: { minutes: minutesRemaining },
    isSoon: minutesRemaining < 15,
  }
}

type Step = 'form' | 'withdraw-success'

export function CancelTransferModal({ isOpen, onClose }: Props) {
  const intl = useIntl()
  const { transfer, cancel, isCancelling, error } = usePendingTransferContext()
  const expiry = useExpiryLabel(transfer?.expiresAt)

  const [step, setStep] = useState<Step>('form')
  // Snapshot the recipient so the success copy keeps reading the right
  // email after `setTransfer(null)` empties the context.
  const [withdrawnEmail, setWithdrawnEmail] = useState<string | null>(null)

  // Open-time reset gated on close→open transition. Without this,
  // setTransfer(null) firing inside `cancel()` would re-run this effect
  // and reset 'withdraw-success' back to 'form'.
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setStep('form')
      setWithdrawnEmail(null)
    }
    wasOpenRef.current = isOpen
  }, [isOpen])

  // Auto-close when the transfer disappears (sender cancels elsewhere,
  // recipient accepts/declines) — but only on the form step. The success
  // step is reached *after* setTransfer(null) and intentionally outlives
  // the now-null transfer.
  useEffect(() => {
    if (step !== 'form') return
    if (isOpen && !transfer && !isCancelling) onClose()
  }, [isOpen, transfer, isCancelling, onClose, step])

  const handleCancelTransfer = async () => {
    if (!transfer) return
    const email = transfer.toEmail
    const ok = await cancel()
    if (ok) {
      setWithdrawnEmail(email)
      setStep('withdraw-success')
    }
  }

  const titleNode = useMemo(() => {
    const full = intl.formatMessage({ id: 'manage.cancel_transfer_hero_title' })
    const emphasis = intl.formatMessage({ id: 'manage.cancel_transfer_hero_title_emphasis' })
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

  const title = intl.formatMessage({ id: 'manage.transfer_pending_heading' })

  const footer = step === 'form' ? (
    <IonButton
      color="danger"
      expand="block"
      onClick={handleCancelTransfer}
      disabled={isCancelling || !transfer}
    >
      {isCancelling
        ? <IonSpinner name="crescent" />
        : intl.formatMessage({ id: 'manage.transfer_withdraw' })}
    </IonButton>
  ) : (
    <IonButton expand="block" onClick={onClose}>
      {intl.formatMessage({ id: 'common.done' })}
    </IonButton>
  )

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      chromeless={step === 'withdraw-success'}
      footer={footer}
      noSwipeDismiss
    >
      {step === 'form' && (
        <>
          {error && <div className="modal-error">{error}</div>}

          <header className="modal-hero cancel-transfer__hero">
            <div className="modal-hero__eyebrow">
              {intl.formatMessage({ id: 'manage.cancel_transfer_eyebrow' })}
            </div>
            <h1 className="modal-hero__title">{titleNode}</h1>
            <p className="modal-hero__subtitle">
              {intl.formatMessage({ id: 'manage.cancel_transfer_hero_subtitle' })}
            </p>
          </header>

          <div className="cancel-transfer__plate">
            <div className="cancel-transfer__plate-eyebrow">
              <Clock />
              {intl.formatMessage({ id: 'manage.cancel_transfer_plate_eyebrow' })}
            </div>

            <div className="cancel-transfer__plate-recipient">
              <span className="cancel-transfer__plate-recipient-label">
                {intl.formatMessage({ id: 'manage.cancel_transfer_recipient_label' })}
              </span>
              <span className="cancel-transfer__plate-recipient-value">
                {transfer?.toEmail ?? ''}
              </span>
            </div>

            {expiry && (
              <div
                className={
                  'cancel-transfer__plate-expiry' +
                  (expiry.isSoon ? ' cancel-transfer__plate-expiry--soon' : '')
                }
              >
                {intl.formatMessage({ id: expiry.id }, expiry.values)}
              </div>
            )}
          </div>

          <p className="cancel-transfer__note">
            {intl.formatMessage({ id: 'manage.cancel_transfer_note' })}
          </p>
        </>
      )}

      {step === 'withdraw-success' && (
        <div className="manage-seal" aria-hidden={step !== 'withdraw-success'}>
          <div className="manage-seal__lottie">
            <LottiePlayer
              src="/animations/trash.json"
              loop={false}
              autoplay={true}
              delay={300}
              style={{ width: 144, height: 144 }}
            />
          </div>

          <span className="manage-seal__stamp">
            {intl.formatMessage({ id: 'manage.cancel_transfer_success_stamp' })}
          </span>

          <h2 className="manage-seal__title">
            {intl.formatMessage(
              { id: 'manage.cancel_transfer_success_title' },
              { em: (chunks) => <em>{chunks}</em> },
            )}
          </h2>

          <p className="manage-seal__subtitle">
            {intl.formatMessage(
              { id: 'manage.cancel_transfer_success_subtitle' },
              { email: withdrawnEmail ?? '' },
            )}
          </p>
        </div>
      )}
    </ModalShell>
  )
}
