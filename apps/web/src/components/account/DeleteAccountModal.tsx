'use client'

import { useIntl } from 'react-intl'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Check, AlertOctagon, ChevronLeft } from 'lucide-react'
import { IonButton, IonSpinner } from '@ionic/react'
import { ModalShell } from '@/components/ui'
import { AuthField } from '@/components/auth'
import { OTPInput } from '@/components/OTPInput'
import { LottiePlayerDynamic as LottiePlayer } from '@/components/animations'
import { useAuth } from '@/contexts/auth-context'
import { useApiMessage } from '@/hooks/useApiMessage'
import { useGoBackTo } from '@/hooks'
import { ApiError, apiRequest } from '@/lib/api-client'
import { authClient } from '@/lib/auth-client'
import { fetchDeduped } from '@/lib/fetch'

export interface DeleteAccountModalProps {
  isOpen: boolean
  onClose: () => void
  onExitComplete?: () => void
}

interface OwnedBusiness {
  id: string
  name: string
}

/**
 * Stage flow for the destructive friction:
 *
 *   loading  -- pre-flight business-ownership check
 *      |
 *      +--> blocked     (user still owns >=1 active business — terminal)
 *      |
 *      +--> warning     (consequences + type-email-to-confirm gate)
 *              |
 *              v
 *           verify-otp  (mailbox-control step-up replaces the legacy
 *                        current-password re-auth — see /api/account/delete
 *                        which calls auth.api.verifyEmailOTP)
 *              |
 *              v
 *           success     (Lottie beat, then logout + redirect)
 */
type Stage = 'loading' | 'blocked' | 'warning' | 'verify-otp' | 'success'

const RESEND_COOLDOWN_SECONDS = 30

export function DeleteAccountModal({
  isOpen,
  onClose,
  onExitComplete,
}: DeleteAccountModalProps) {
  const intl = useIntl()
  const goBackTo = useGoBackTo()
  const { user, logout } = useAuth()
  const translateApiMessage = useApiMessage()

  const [stage, setStage] = useState<Stage>('loading')
  const [ownedBusinesses, setOwnedBusinesses] = useState<OwnedBusiness[]>([])
  const [confirmEmail, setConfirmEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [otpError, setOtpError] = useState(false)
  const [isSendingOtp, setIsSendingOtp] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [error, setError] = useState('')

  // ---------------------------------------------------------------- pre-flight
  // Fetch the user's business memberships when the modal opens so we can
  // route to the `blocked` stage instantly. The server-side route runs
  // the same check, so this is purely UX — a race between two transfers
  // and our delete is still caught by the 409 path below.
  useEffect(() => {
    if (!isOpen) return

    let cancelled = false

    async function checkOwnedBusinesses() {
      setStage('loading')
      setError('')
      try {
        const response = await fetchDeduped('/api/businesses/list')
        const data = await response.json()
        if (cancelled) return
        if (response.ok && Array.isArray(data.businesses)) {
          const owned = data.businesses
            .filter((b: { isOwner?: boolean }) => b.isOwner)
            .map((b: { id: string; name: string }) => ({ id: b.id, name: b.name }))
          setOwnedBusinesses(owned)
          setStage(owned.length > 0 ? 'blocked' : 'warning')
        } else {
          setOwnedBusinesses([])
          setStage('warning')
        }
      } catch (err) {
        if (cancelled) return
        console.error('Pre-flight check error:', err)
        setOwnedBusinesses([])
        setStage('warning')
      }
    }

    checkOwnedBusinesses()

    return () => {
      cancelled = true
    }
  }, [isOpen])

  // Reset all state after the dismissal animation plays so the contents
  // don't flash back into view while the modal slides away.
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setStage('loading')
        setOwnedBusinesses([])
        setConfirmEmail('')
        setOtp('')
        setOtpError(false)
        setIsSendingOtp(false)
        setIsDeleting(false)
        setResendCooldown(0)
        setError('')
        onExitComplete?.()
      }, 250)
      return () => clearTimeout(timer)
    }
  }, [isOpen, onExitComplete])

  // Resend cooldown tick — same shape as VerifyStep.
  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = window.setTimeout(() => setResendCooldown((c) => c - 1), 1000)
    return () => window.clearTimeout(t)
  }, [resendCooldown])

  // ------------------------------------------------------------------ derived
  const emailMatches =
    !!user && confirmEmail.trim().toLowerCase() === user.email.toLowerCase()
  const otpComplete = otp.trim().length === 6
  const canContinueFromWarning = emailMatches && !isSendingOtp
  const canDelete = otpComplete && !isDeleting

  // ------------------------------------------------------------------- senders
  const sendOtp = useCallback(async (): Promise<boolean> => {
    if (!user) return false
    const res = await authClient.emailOtp.sendVerificationOtp({
      email: user.email,
      type: 'email-verification',
    })
    const apiErr = (res as { error?: { message?: string } | null } | null)?.error
    if (apiErr) {
      setError(apiErr.message ?? intl.formatMessage({ id: 'common.error' }))
      return false
    }
    return true
  }, [intl, user])

  const handleContinueToVerify = useCallback(async () => {
    if (!canContinueFromWarning) return
    setIsSendingOtp(true)
    setError('')
    try {
      const ok = await sendOtp()
      if (!ok) return
      setOtp('')
      setResendCooldown(RESEND_COOLDOWN_SECONDS)
      setStage('verify-otp')
    } catch (err) {
      console.error('Send delete-OTP error:', err)
      setError(intl.formatMessage({ id: 'common.error' }))
    } finally {
      setIsSendingOtp(false)
    }
  }, [canContinueFromWarning, intl, sendOtp])

  const handleResend = useCallback(async () => {
    if (resendCooldown > 0 || isDeleting) return
    setError('')
    setOtpError(false)
    setResendCooldown(RESEND_COOLDOWN_SECONDS)
    const ok = await sendOtp()
    if (!ok) {
      // Keep the cooldown — re-asking immediately would just trip the
      // server-side rate limiter again.
      return
    }
    setOtp('')
  }, [isDeleting, resendCooldown, sendOtp])

  const handleBackToWarning = useCallback(() => {
    if (isDeleting) return
    setOtp('')
    setOtpError(false)
    setError('')
    setStage('warning')
  }, [isDeleting])

  // -------------------------------------------------------------- delete call
  const handleDelete = useCallback(async () => {
    if (!canDelete || !user) return
    setIsDeleting(true)
    setError('')
    setOtpError(false)
    try {
      // The server consumes the OTP via auth.api.verifyEmailOTP, so a
      // captured code can't be replayed. confirmEmail mirrors the legacy
      // type-to-confirm gate for the "wrong inbox open" foot-gun.
      await apiRequest('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmEmail: user.email,
          otp: otp.trim().toUpperCase(),
        }),
      })
      setStage('success')
      // Give the Lottie a beat to play, then clear local auth and route
      // to the unified entry page. The success animation reads as a
      // confirmation receipt; jumping immediately feels like a crash.
      window.setTimeout(async () => {
        await logout()
        goBackTo('/')
      }, 1400)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.envelope
            ? translateApiMessage(err.envelope)
            : intl.formatMessage({ id: 'common.error' }),
        )
        // 409 means the server caught a business-ownership state we
        // missed at pre-flight (e.g. a transfer landed mid-flow). Route
        // back to the blocked stage so the user sees what changed.
        const data = err.data as { ownedBusinesses?: OwnedBusiness[] }
        if (err.statusCode === 409 && Array.isArray(data.ownedBusinesses)) {
          setOwnedBusinesses(data.ownedBusinesses)
          setStage('blocked')
        } else {
          setOtpError(true)
        }
        return
      }
      console.error('Delete account error:', err)
      setError(intl.formatMessage({ id: 'common.error' }))
      setOtpError(true)
    } finally {
      setIsDeleting(false)
    }
  }, [canDelete, goBackTo, intl, logout, otp, translateApiMessage, user])

  // ---------------------------------------------------------------- titles fx
  const warningTitle = useMemo(() => {
    const full = intl.formatMessage({ id: 'account.delete_confirm_hero_title' })
    const emphasis = intl.formatMessage({ id: 'account.delete_confirm_hero_title_emphasis' })
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

  const blockedTitle = useMemo(() => {
    const full = intl.formatMessage({ id: 'account.delete_blocked_hero_title' })
    const emphasis = intl.formatMessage({ id: 'account.delete_blocked_hero_title_emphasis' })
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

  // ------------------------------------------------------------------ footers
  let footer: React.ReactNode = undefined
  if (stage === 'blocked') {
    footer = (
      <IonButton fill="outline" expand="block" onClick={onClose} className="flex-1">
        {intl.formatMessage({ id: 'common.close' })}
      </IonButton>
    )
  } else if (stage === 'warning') {
    footer = (
      <IonButton
        color="danger"
        expand="block"
        onClick={handleContinueToVerify}
        disabled={!canContinueFromWarning}
        className="flex-1"
        data-haptic
      >
        {isSendingOtp ? (
          <IonSpinner name="crescent" />
        ) : (
          intl.formatMessage({ id: 'account.delete_continue_to_verify' })
        )}
      </IonButton>
    )
  } else if (stage === 'verify-otp') {
    footer = (
      <div className="delete-account__verify-footer">
        <IonButton
          fill="outline"
          onClick={handleBackToWarning}
          disabled={isDeleting}
          className="delete-account__verify-back"
          aria-label={intl.formatMessage({ id: 'common.back' })}
        >
          <ChevronLeft />
          {intl.formatMessage({ id: 'common.back' })}
        </IonButton>
        <IonButton
          color="danger"
          onClick={handleDelete}
          disabled={!canDelete}
          className="delete-account__verify-submit"
          data-haptic
        >
          {isDeleting ? (
            <IonSpinner name="crescent" />
          ) : (
            intl.formatMessage({ id: 'account.delete_button' })
          )}
        </IonButton>
      </div>
    )
  }

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={
        stage === 'success'
          ? ''
          : intl.formatMessage({ id: 'account.delete_modal_title' })
      }
      footer={footer}
      noSwipeDismiss
    >
      {error && stage !== 'success' && <div className="modal-error">{error}</div>}

      {stage === 'loading' && (
        <div className="delete-account__loading">
          <IonSpinner name="crescent" />
          <p className="delete-account__loading-label">
            {intl.formatMessage({ id: 'account.delete_loading_check' })}
          </p>
        </div>
      )}

      {stage === 'blocked' && (
        <BlockedView ownedBusinesses={ownedBusinesses} title={blockedTitle} />
      )}

      {stage === 'warning' && (
        <WarningView
          email={user?.email ?? ''}
          confirmEmail={confirmEmail}
          onConfirmEmailChange={setConfirmEmail}
          emailMatches={emailMatches}
          title={warningTitle}
        />
      )}

      {stage === 'verify-otp' && (
        <VerifyOtpView
          email={user?.email ?? ''}
          otp={otp}
          onOtpChange={(v) => {
            setOtpError(false)
            setOtp(v)
          }}
          otpError={otpError}
          onResend={handleResend}
          resendCooldown={resendCooldown}
          isResending={isSendingOtp}
          isDeleting={isDeleting}
        />
      )}

      {stage === 'success' && <SuccessView />}
    </ModalShell>
  )
}

// ============================================================================
// WARNING VIEW
// ============================================================================

interface WarningViewProps {
  email: string
  confirmEmail: string
  onConfirmEmailChange: (value: string) => void
  emailMatches: boolean
  title: React.ReactNode
}

function WarningView({
  email,
  confirmEmail,
  onConfirmEmailChange,
  emailMatches,
  title,
}: WarningViewProps) {
  const intl = useIntl()

  const checks = [
    {
      key: 'email',
      label: intl.formatMessage({ id: 'account.delete_check_email' }),
      met: emailMatches,
    },
  ]

  return (
    <>
      <header className="modal-hero delete-account__hero">
        <div className="modal-hero__eyebrow modal-hero__eyebrow--danger">
          <AlertOctagon size={12} />
          {intl.formatMessage({ id: 'account.delete_hero_eyebrow' })}
        </div>
        <h1 className="modal-hero__title modal-hero__title--danger">{title}</h1>
        <p className="modal-hero__subtitle">
          {intl.formatMessage({ id: 'account.delete_hero_subtitle' })}
        </p>
      </header>

      <div className="delete-account__warning">
        <div className="delete-account__warning-eyebrow">
          {intl.formatMessage({ id: 'account.delete_warning_eyebrow' })}
        </div>
        <ul className="delete-account__warning-list">
          <li className="delete-account__warning-item">
            {intl.formatMessage({ id: 'account.delete_warning_item_profile' })}
          </li>
          <li className="delete-account__warning-item">
            {intl.formatMessage({ id: 'account.delete_warning_item_memberships' })}
          </li>
          <li className="delete-account__warning-item">
            {intl.formatMessage({ id: 'account.delete_warning_item_invites' })}
          </li>
          <li className="delete-account__warning-item">
            {intl.formatMessage({ id: 'account.delete_warning_item_irreversible' })}
          </li>
        </ul>
      </div>

      <div className="delete-account__target">
        <span className="delete-account__target-eyebrow">
          {intl.formatMessage({ id: 'account.delete_target_eyebrow' })}
        </span>
        <span className="delete-account__target-value">{email}</span>
      </div>

      <div className="delete-account__form">
        <AuthField
          label={intl.formatMessage({ id: 'account.delete_confirm_label' })}
          type="email"
          value={confirmEmail}
          onChange={(e) => onConfirmEmailChange(e.target.value)}
          placeholder={email}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          required
        />
      </div>

      <div className="delete-account__checks">
        <div className="delete-account__checks-eyebrow">
          {intl.formatMessage({ id: 'account.delete_checks_eyebrow' })}
        </div>
        <ul className="delete-account__check-list">
          {checks.map((check) => (
            <li
              key={check.key}
              className={`delete-account__check${check.met ? ' is-met' : ''}`}
            >
              <span className="delete-account__check-marker" aria-hidden="true">
                <Check />
              </span>
              {check.label}
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}

// ============================================================================
// VERIFY-OTP VIEW
// ============================================================================

interface VerifyOtpViewProps {
  email: string
  otp: string
  onOtpChange: (v: string) => void
  otpError: boolean
  onResend: () => void
  resendCooldown: number
  isResending: boolean
  isDeleting: boolean
}

function VerifyOtpView({
  email,
  otp,
  onOtpChange,
  otpError,
  onResend,
  resendCooldown,
  isResending,
  isDeleting,
}: VerifyOtpViewProps) {
  const intl = useIntl()

  return (
    <>
      <header className="modal-hero delete-account__hero">
        <div className="modal-hero__eyebrow modal-hero__eyebrow--danger">
          <AlertOctagon size={12} />
          {intl.formatMessage({ id: 'account.delete_otp_hero_eyebrow' })}
        </div>
        <h1 className="modal-hero__title modal-hero__title--danger">
          {intl.formatMessage({ id: 'account.delete_otp_hero_title' })}
        </h1>
        <p className="modal-hero__subtitle">
          {intl.formatMessage(
            { id: 'account.delete_otp_hero_subtitle' },
            { email },
          )}
        </p>
      </header>

      <div className="delete-account__target">
        <span className="delete-account__target-eyebrow">
          {intl.formatMessage({ id: 'account.delete_otp_target_eyebrow' })}
        </span>
        <span className="delete-account__target-value">{email}</span>
      </div>

      <div className="modal-otp">
        <OTPInput
          value={otp}
          onChange={onOtpChange}
          disabled={isDeleting}
          error={otpError}
        />
        <IonButton
          fill="clear"
          disabled={resendCooldown > 0 || isResending || isDeleting}
          onClick={onResend}
          className="modal-otp__resend"
        >
          {resendCooldown > 0
            ? intl.formatMessage(
                { id: 'account.delete_otp_resend_cooldown' },
                { seconds: resendCooldown },
              )
            : intl.formatMessage({ id: 'account.delete_otp_resend' })}
        </IonButton>
      </div>
    </>
  )
}

// ============================================================================
// BLOCKED VIEW
// ============================================================================

function BlockedView({
  ownedBusinesses,
  title,
}: {
  ownedBusinesses: OwnedBusiness[]
  title: React.ReactNode
}) {
  const intl = useIntl()

  return (
    <>
      <header className="modal-hero delete-account__hero">
        <div className="modal-hero__eyebrow modal-hero__eyebrow--danger">
          <AlertOctagon size={12} />
          {intl.formatMessage({ id: 'account.delete_blocked_eyebrow' })}
        </div>
        <h1 className="modal-hero__title modal-hero__title--danger">{title}</h1>
        <p className="modal-hero__subtitle">
          {intl.formatMessage({ id: 'account.delete_blocked_description' })}
        </p>
      </header>

      <div className="delete-account__blocked-card">
        <div className="delete-account__blocked-eyebrow">
          <span>{intl.formatMessage({ id: 'account.delete_blocked_owned_eyebrow' })}</span>
          <span className="delete-account__blocked-eyebrow-count">
            {ownedBusinesses.length.toString().padStart(2, '0')}
          </span>
        </div>
        <ul className="delete-account__owned-list">
          {ownedBusinesses.map((b) => (
            <li key={b.id} className="delete-account__owned-item">
              <span className="delete-account__owned-name">{b.name}</span>
              <span className="delete-account__owned-tag">
                {intl.formatMessage({ id: 'account.delete_blocked_owner_tag' })}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}

// ============================================================================
// SUCCESS VIEW
// ============================================================================

function SuccessView() {
  const intl = useIntl()

  return (
    <div className="delete-account__success">
      <div style={{ width: 160, height: 160 }}>
        <LottiePlayer
          src="/animations/trash.json"
          loop={false}
          autoplay={true}
          delay={120}
          style={{ width: 160, height: 160 }}
        />
      </div>
      <p className="delete-account__success-heading">
        {intl.formatMessage(
          { id: 'account.delete_success_heading' },
          {
            em: (chunks) => (
              <em className="delete-account__success-heading-em">{chunks}</em>
            ),
          },
        )}
      </p>
      <p className="delete-account__success-desc">
        {intl.formatMessage({ id: 'account.delete_success_desc' })}
      </p>
    </div>
  )
}
