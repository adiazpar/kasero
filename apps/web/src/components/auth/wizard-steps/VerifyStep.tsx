import { useState, useEffect, useCallback } from 'react'
import { useIntl } from 'react-intl'
import { IonButton } from '@ionic/react'
import { useAuth } from '@/contexts/auth-context'
import { useAuthGate } from '@/contexts/auth-gate-context'
import { OTPInput } from '@/components/OTPInput'
import { useWizardNav } from './WizardNavContext'
import './VerifyStep.css'

const RESEND_COOLDOWN_SECONDS = 30

/**
 * Middle step of the 3-step passwordless auth wizard. The user has
 * just received a 6-digit OTP (sent either by EntryPage or the
 * preceding EmailStep). Submitting calls `verifyOtp`, which creates
 * the session and reports whether the resolved user is brand-new
 * (empty name). New users continue to the NameStep so we can capture
 * their display name; returning users land on the hub.
 */
export function VerifyStep() {
  const intl = useIntl()
  const { email, goTo, setIsNewUser } = useWizardNav()
  const { sendOtp, verifyOtp } = useAuth()
  const { playEntry } = useAuthGate()

  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => window.clearTimeout(t)
  }, [cooldown])

  const handleComplete = useCallback(
    async (value: string) => {
      if (!email) return
      setSubmitting(true)
      setErrorMessage(null)
      const result = await verifyOtp(email, value)
      if (!result.success) {
        setErrorMessage(
          result.error ??
            intl.formatMessage({ id: 'verify_error_generic' }),
        )
        setCode('')
        setSubmitting(false)
        return
      }
      setIsNewUser(result.isNewUser)
      setSubmitting(false)
      if (result.isNewUser) {
        goTo('name')
      } else {
        await playEntry('/')
      }
    },
    [email, goTo, intl, playEntry, setIsNewUser, verifyOtp],
  )

  const handleResend = useCallback(async () => {
    if (!email || cooldown > 0) return
    setCooldown(RESEND_COOLDOWN_SECONDS)
    setErrorMessage(null)
    const result = await sendOtp(email)
    if (!result.success) {
      setErrorMessage(
        result.error ?? intl.formatMessage({ id: 'verify_error_resend' }),
      )
    }
  }, [cooldown, email, intl, sendOtp])

  // Manual submit handler for the explicit "verify-submit" button. Mirrors
  // the auto-submit branch in handleComplete, but lets E2E tests drive the
  // verify step with a deterministic click (the auto-submit-on-complete
  // fires asynchronously, which makes the timing tricky for Playwright).
  // Declared BEFORE the email-guard early-return so React's hook order is
  // stable across renders (rules-of-hooks).
  const handleManualSubmit = useCallback(() => {
    if (submitting) return
    if (code.length !== 6) return
    void handleComplete(code)
  }, [code, handleComplete, submitting])

  if (!email) {
    // Defensive — shouldn't reach this step without a wizard email.
    return null
  }

  return (
    <div className="register-verify" data-testid="verify-step">
      <h2 className="register-verify__title">
        {intl.formatMessage({ id: 'verify_email_title' })}
      </h2>
      <p className="register-verify__instruction">
        {intl.formatMessage({ id: 'verify_email_instruction' }, { email })}
      </p>
      <OTPInput
        value={code}
        onChange={setCode}
        onComplete={handleComplete}
        disabled={submitting}
        error={!!errorMessage}
      />
      {errorMessage && (
        <p role="alert" className="register-verify__error">
          {errorMessage}
        </p>
      )}
      {/* Explicit submit hook for E2E + accessibility (some assistive
          tech can't trigger the auto-submit). Hidden visually because
          the auto-submit covers the keyboard path; rendered as a real
          button so getByTestId('verify-submit').click() works. */}
      <button
        type="button"
        data-testid="verify-submit"
        className="register-verify__submit-hidden"
        onClick={handleManualSubmit}
        disabled={code.length !== 6 || submitting}
        aria-hidden="true"
        tabIndex={-1}
      />
      <IonButton
        fill="clear"
        disabled={cooldown > 0 || submitting}
        onClick={handleResend}
        className="register-verify__resend"
      >
        {cooldown > 0
          ? intl.formatMessage({ id: 'verify_email_resend_cooldown' }, { seconds: cooldown })
          : intl.formatMessage({ id: 'verify_email_resend' })}
      </IonButton>
    </div>
  )
}

export default VerifyStep
