'use client'

import { useIntl } from 'react-intl'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { IonButton, IonSpinner } from '@ionic/react'
import { ModalShell } from '@/components/ui'
import { AuthField } from '@/components/auth'
import { OTPInput } from '@/components/OTPInput'
import { LottiePlayerDynamic as LottiePlayer } from '@/components/animations'
import { useAuth } from '@/contexts/auth-context'
import { useApiMessage } from '@/hooks/useApiMessage'
import { ApiError, apiPost, type ApiResponse } from '@/lib/api-client'

export interface ChangeEmailModalProps {
  isOpen: boolean
  onClose: () => void
  onExitComplete?: () => void
}

/**
 * Stage flow for the dual-OTP email change:
 *
 *   enter-new-email   -- user types the destination address
 *         |
 *         v
 *   verify-both-otps  -- two 6-digit codes (current + new mailbox)
 *         |
 *         v
 *   success           -- Lottie beat, current session keeps working,
 *                        other sessions revoked server-side
 *
 * Phase 1 (initiate): POST /api/account/change-email with
 * { phase: 'initiate', newEmail }. Server mints two OTPs and emails BOTH
 * the old and the new address.
 *
 * Phase 2 (confirm): POST /api/account/change-email with
 * { phase: 'confirm', newEmail, oldOtp, newOtp }. Server verifies both,
 * rewrites users.email, revokes every OTHER session, and returns the new
 * email in the success payload. We call refreshUser() so the UI rebinds
 * to the new address without a hard reload.
 */
type Stage = 'enter-new-email' | 'verify-both-otps' | 'success'

const RESEND_COOLDOWN_SECONDS = 30
// Same shape better-auth uses for its email validator. Permissive enough
// to accept the long-tail of valid mailboxes (plus addressing, IDN-mapped
// hosts, etc.) without trying to be RFC-perfect — server-side Zod is
// authoritative.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface ChangeEmailInitiateResponse extends ApiResponse {
  success: true
}

interface ChangeEmailConfirmResponse extends ApiResponse {
  success: true
  newEmail: string
}

export function ChangeEmailModal({
  isOpen,
  onClose,
  onExitComplete,
}: ChangeEmailModalProps) {
  const intl = useIntl()
  const { user, refreshUser } = useAuth()
  const translateApiMessage = useApiMessage()

  const [stage, setStage] = useState<Stage>('enter-new-email')
  const [newEmail, setNewEmail] = useState('')
  const [oldOtp, setOldOtp] = useState('')
  const [newOtp, setNewOtp] = useState('')
  const [otpError, setOtpError] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [error, setError] = useState('')

  // Reset all state after the dismissal animation plays so the form
  // doesn't flash back into view while the modal slides away.
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setStage('enter-new-email')
        setNewEmail('')
        setOldOtp('')
        setNewOtp('')
        setOtpError(false)
        setIsSending(false)
        setIsConfirming(false)
        setResendCooldown(0)
        setError('')
        onExitComplete?.()
      }, 250)
      return () => clearTimeout(timer)
    }
  }, [isOpen, onExitComplete])

  // Resend cooldown tick — same shape as VerifyStep / DeleteAccountModal.
  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = window.setTimeout(() => setResendCooldown((c) => c - 1), 1000)
    return () => window.clearTimeout(t)
  }, [resendCooldown])

  // ------------------------------------------------------------------ derived
  const trimmedNew = newEmail.trim().toLowerCase()
  const currentEmail = user?.email.toLowerCase() ?? ''
  const isFormatValid = EMAIL_RE.test(trimmedNew)
  const isSameAsCurrent = trimmedNew.length > 0 && trimmedNew === currentEmail
  const canInitiate = isFormatValid && !isSameAsCurrent && !isSending

  const otpsComplete = oldOtp.trim().length === 6 && newOtp.trim().length === 6
  const canConfirm = otpsComplete && !isConfirming

  // ----------------------------------------------------------------- senders
  const sendInitiate = useCallback(async (): Promise<boolean> => {
    try {
      await apiPost<ChangeEmailInitiateResponse>('/api/account/change-email', {
        phase: 'initiate',
        newEmail: trimmedNew,
      })
      return true
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.envelope
            ? translateApiMessage(err.envelope)
            : intl.formatMessage({ id: 'common.error' }),
        )
        return false
      }
      console.error('Change-email initiate error:', err)
      setError(intl.formatMessage({ id: 'common.error' }))
      return false
    }
  }, [intl, translateApiMessage, trimmedNew])

  const handleInitiate = useCallback(async () => {
    if (!canInitiate) return
    setIsSending(true)
    setError('')
    const ok = await sendInitiate()
    setIsSending(false)
    if (!ok) return
    setOldOtp('')
    setNewOtp('')
    setResendCooldown(RESEND_COOLDOWN_SECONDS)
    setStage('verify-both-otps')
  }, [canInitiate, sendInitiate])

  const handleResend = useCallback(async () => {
    if (resendCooldown > 0 || isConfirming) return
    setError('')
    setOtpError(false)
    // Optimistically start the cooldown — re-asking immediately would just
    // trip the server-side rate limiter again, so we want the same UX
    // whether or not the resend ultimately succeeds.
    setResendCooldown(RESEND_COOLDOWN_SECONDS)
    const ok = await sendInitiate()
    if (!ok) return
    // Clearing both inputs feels right when the server has minted fresh
    // codes — the old codes wouldn't work anymore even if the user has
    // them in their fingertips.
    setOldOtp('')
    setNewOtp('')
  }, [isConfirming, resendCooldown, sendInitiate])

  const handleBackToEnter = useCallback(() => {
    if (isConfirming) return
    setOldOtp('')
    setNewOtp('')
    setOtpError(false)
    setError('')
    setStage('enter-new-email')
  }, [isConfirming])

  const handleConfirm = useCallback(async () => {
    if (!canConfirm) return
    setIsConfirming(true)
    setError('')
    setOtpError(false)
    try {
      await apiPost<ChangeEmailConfirmResponse>('/api/account/change-email', {
        phase: 'confirm',
        newEmail: trimmedNew,
        oldOtp: oldOtp.trim(),
        newOtp: newOtp.trim(),
      })
      // Other sessions are revoked server-side; our cookie keeps working
      // because the server identifies the live session and excludes it
      // from the wipe. refreshUser rebinds the in-memory user.email to
      // the new address before we render the success view.
      await refreshUser()
      setStage('success')
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.envelope
            ? translateApiMessage(err.envelope)
            : intl.formatMessage({ id: 'common.error' }),
        )
      } else {
        console.error('Change-email confirm error:', err)
        setError(intl.formatMessage({ id: 'common.error' }))
      }
      setOtpError(true)
    } finally {
      setIsConfirming(false)
    }
  }, [
    canConfirm,
    intl,
    newOtp,
    oldOtp,
    refreshUser,
    translateApiMessage,
    trimmedNew,
  ])

  // ---------------------------------------------------------------- titles fx
  const enterTitleNode = useMemo(() => {
    const full = intl.formatMessage({ id: 'account.email_change_hero_title' })
    const emphasis = intl.formatMessage({ id: 'account.email_change_hero_title_emphasis' })
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

  const successHeading = useMemo(
    () =>
      intl.formatMessage(
        { id: 'account.email_change_success_title' },
        {
          em: (chunks) => (
            <em className="change-email__success-heading-em">{chunks}</em>
          ),
        },
      ),
    [intl],
  )

  // ----------------------------------------------------------------- footers
  let footer: React.ReactNode = undefined
  if (stage === 'enter-new-email') {
    footer = (
      <IonButton
        expand="block"
        onClick={handleInitiate}
        disabled={!canInitiate}
        className="flex-1"
        data-haptic
      >
        {isSending ? (
          <IonSpinner name="crescent" />
        ) : (
          intl.formatMessage({ id: 'account.email_change_send_button' })
        )}
      </IonButton>
    )
  } else if (stage === 'verify-both-otps') {
    footer = (
      <div className="change-email__verify-footer">
        <IonButton
          fill="outline"
          onClick={handleBackToEnter}
          disabled={isConfirming}
          className="change-email__verify-back"
          aria-label={intl.formatMessage({ id: 'account.email_change_back_button' })}
        >
          <ChevronLeft />
          {intl.formatMessage({ id: 'account.email_change_back_button' })}
        </IonButton>
        <IonButton
          onClick={handleConfirm}
          disabled={!canConfirm}
          className="change-email__verify-submit"
          data-haptic
        >
          {isConfirming ? (
            <IonSpinner name="crescent" />
          ) : (
            intl.formatMessage({ id: 'account.email_change_submit_button' })
          )}
        </IonButton>
      </div>
    )
  } else if (stage === 'success') {
    footer = (
      <IonButton expand="block" onClick={onClose} className="flex-1">
        {intl.formatMessage({ id: 'account.email_change_close_button' })}
      </IonButton>
    )
  }

  // --------------------------------------------------------------------- render
  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={
        stage === 'success'
          ? ''
          : intl.formatMessage({ id: 'account.email_change_modal_title' })
      }
      footer={footer}
      noSwipeDismiss
    >
      {error && stage !== 'success' && <div className="modal-error">{error}</div>}

      {stage === 'enter-new-email' && (
        <EnterEmailView
          currentEmail={user?.email ?? ''}
          newEmail={newEmail}
          onNewEmailChange={setNewEmail}
          isSameAsCurrent={isSameAsCurrent}
          title={enterTitleNode}
        />
      )}

      {stage === 'verify-both-otps' && (
        <VerifyBothView
          oldEmail={user?.email ?? ''}
          newEmail={trimmedNew}
          oldOtp={oldOtp}
          newOtp={newOtp}
          onOldOtpChange={(v) => {
            setOtpError(false)
            setOldOtp(v)
          }}
          onNewOtpChange={(v) => {
            setOtpError(false)
            setNewOtp(v)
          }}
          otpError={otpError}
          onResend={handleResend}
          resendCooldown={resendCooldown}
          isResending={isSending}
          isConfirming={isConfirming}
        />
      )}

      {stage === 'success' && (
        <SuccessView heading={successHeading} newEmail={trimmedNew} />
      )}
    </ModalShell>
  )
}

// ============================================================================
// ENTER-NEW-EMAIL VIEW
// ============================================================================

interface EnterEmailViewProps {
  currentEmail: string
  newEmail: string
  onNewEmailChange: (value: string) => void
  isSameAsCurrent: boolean
  title: React.ReactNode
}

function EnterEmailView({
  currentEmail,
  newEmail,
  onNewEmailChange,
  isSameAsCurrent,
  title,
}: EnterEmailViewProps) {
  const intl = useIntl()
  return (
    <>
      <header className="modal-hero change-email__hero">
        <div className="modal-hero__eyebrow">
          {intl.formatMessage({ id: 'account.email_change_hero_eyebrow' })}
        </div>
        <h1 className="modal-hero__title">{title}</h1>
        <p className="modal-hero__subtitle">
          {intl.formatMessage({ id: 'account.email_change_hero_subtitle' })}
        </p>
      </header>

      <div className="change-email__target">
        <span className="change-email__target-eyebrow">
          {intl.formatMessage({ id: 'account.email_change_current_eyebrow' })}
        </span>
        <span className="change-email__target-value">{currentEmail}</span>
      </div>

      <div className="change-email__form">
        <AuthField
          label={intl.formatMessage({ id: 'account.email_change_new_label' })}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="off"
          spellCheck={false}
          value={newEmail}
          onChange={(e) => onNewEmailChange(e.target.value)}
          placeholder={intl.formatMessage({
            id: 'account.email_change_new_placeholder',
          })}
          below={
            isSameAsCurrent ? (
              <span className="change-email__inline-warning">
                {intl.formatMessage({
                  id: 'account.email_change_same_warning',
                })}
              </span>
            ) : undefined
          }
          required
        />
      </div>
    </>
  )
}

// ============================================================================
// VERIFY-BOTH-OTPS VIEW
// ============================================================================

interface VerifyBothViewProps {
  oldEmail: string
  newEmail: string
  oldOtp: string
  newOtp: string
  onOldOtpChange: (v: string) => void
  onNewOtpChange: (v: string) => void
  otpError: boolean
  onResend: () => void
  resendCooldown: number
  isResending: boolean
  isConfirming: boolean
}

function VerifyBothView({
  oldEmail,
  newEmail,
  oldOtp,
  newOtp,
  onOldOtpChange,
  onNewOtpChange,
  otpError,
  onResend,
  resendCooldown,
  isResending,
  isConfirming,
}: VerifyBothViewProps) {
  const intl = useIntl()

  return (
    <>
      <header className="modal-hero change-email__hero">
        <div className="modal-hero__eyebrow">
          {intl.formatMessage({ id: 'account.email_change_step2_eyebrow' })}
        </div>
        <h1 className="modal-hero__title">
          {intl.formatMessage({ id: 'account.email_change_step2_title' })}
        </h1>
        <p className="modal-hero__subtitle">
          {intl.formatMessage(
            { id: 'account.email_change_step2_subtitle' },
            { oldEmail, newEmail },
          )}
        </p>
      </header>

      {/* Pair of envelopes — left = current mailbox, right = new mailbox.
          The mono eyebrow + serif italic glyph + truncated address mirror
          the .delete-account__target pattern but render as two stamped
          envelopes side-by-side. On narrow viewports the grid collapses
          to a single column so each stays readable. */}
      <div className="change-email__pair">
        <div className="change-email__pair-card">
          <span className="change-email__pair-eyebrow">
            {intl.formatMessage({ id: 'account.email_change_old_pair_eyebrow' })}
          </span>
          <span className="change-email__pair-address" title={oldEmail}>
            {oldEmail}
          </span>
        </div>
        <div className="change-email__pair-card change-email__pair-card--new">
          <span className="change-email__pair-eyebrow">
            {intl.formatMessage({ id: 'account.email_change_new_pair_eyebrow' })}
          </span>
          <span className="change-email__pair-address" title={newEmail}>
            {newEmail}
          </span>
        </div>
      </div>

      <div className="modal-otp modal-otp--stack">
        <div className="modal-otp__field">
          <span className="modal-otp__label">
            {intl.formatMessage(
              { id: 'account.email_change_old_otp_label' },
              { email: oldEmail },
            )}
          </span>
          <OTPInput
            value={oldOtp}
            onChange={onOldOtpChange}
            disabled={isConfirming}
            error={otpError}
          />
        </div>
        <div className="modal-otp__field">
          <span className="modal-otp__label">
            {intl.formatMessage(
              { id: 'account.email_change_new_otp_label' },
              { email: newEmail },
            )}
          </span>
          <OTPInput
            value={newOtp}
            onChange={onNewOtpChange}
            autoFocus={false}
            disabled={isConfirming}
            error={otpError}
          />
        </div>
        <IonButton
          fill="clear"
          disabled={resendCooldown > 0 || isResending || isConfirming}
          onClick={onResend}
          className="modal-otp__resend"
        >
          {resendCooldown > 0
            ? intl.formatMessage(
                { id: 'account.email_change_resend_cooldown' },
                { seconds: resendCooldown },
              )
            : intl.formatMessage({ id: 'account.email_change_resend' })}
        </IonButton>
      </div>
    </>
  )
}

// ============================================================================
// SUCCESS VIEW
// ============================================================================

function SuccessView({
  heading,
  newEmail,
}: {
  heading: React.ReactNode
  newEmail: string
}) {
  const intl = useIntl()
  return (
    <div className="change-email__success">
      <div style={{ width: 160, height: 160 }}>
        <LottiePlayer
          src="/animations/success.json"
          loop={false}
          autoplay={true}
          delay={120}
          style={{ width: 160, height: 160 }}
        />
      </div>
      <p className="change-email__success-heading">{heading}</p>
      <p className="change-email__success-desc">
        {intl.formatMessage(
          { id: 'account.email_change_success_subtitle' },
          { newEmail },
        )}
      </p>
    </div>
  )
}
