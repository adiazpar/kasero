import { useCallback, useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import { IonButton, IonSpinner } from '@ionic/react'
import { useRouter } from '@/lib/next-navigation-shim'
import { AuthLayout } from '../AuthLayout'
import { AuthField } from '../AuthField'
import { APP_VERSION } from '@/lib/version'
import { useAuth } from '@/contexts/auth-context'
import { useWizardNav } from './WizardNavContext'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * First step of the 3-step passwordless auth wizard. Sends a 6-digit
 * OTP via better-auth's email-otp plugin in `sign-in` mode — that mode
 * is idempotent and creates the user on first verify, so this single
 * call handles both new and returning users. On success we advance to
 * the verify step; the orchestrator also accepts ?email=...&step=verify
 * from EntryPage which bypasses this step entirely.
 */
export function EmailStep() {
  const intl = useIntl()
  const router = useRouter()
  const { sendOtp } = useAuth()
  const { email, setEmail, goTo } = useWizardNav()

  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const trimmed = email.trim()
  const valid = EMAIL_RE.test(trimmed)

  // Clear inline error when the user edits the email.
  useEffect(() => {
    if (error) setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (submitting) return
      if (!valid) {
        // Continue is always active (style guide § 1) — surface invalid
        // email as an inline error under the field instead of disabling.
        setError(intl.formatMessage({ id: 'auth.email_invalid' }))
        return
      }
      setError(null)
      setSubmitting(true)
      const result = await sendOtp(trimmed)
      if (!result.success) {
        setError(
          result.error ?? intl.formatMessage({ id: 'auth.connection_error' }),
        )
        setSubmitting(false)
        return
      }
      setSubmitting(false)
      goTo('verify')
    },
    [goTo, intl, sendOtp, submitting, trimmed, valid],
  )

  // EntryPage at `/` owns the sign-in entry point; the back-link
  // routes there.
  const handleGoToEntry = useCallback(() => router.push('/'), [router])

  const footer = (
    <>
      <div className="auth-divider">
        {intl.formatMessage({ id: 'common.or' })}
      </div>
      <p className="auth-link-row">
        {intl.formatMessage({ id: 'auth.have_account_prefix' })}
        <button type="button" onClick={handleGoToEntry}>
          {intl.formatMessage({ id: 'auth.have_account_link' })}
        </button>
      </p>
      <p className="auth-version">
        {intl.formatMessage({ id: 'auth.version_label' }, { version: APP_VERSION })}
      </p>
    </>
  )

  return (
    <AuthLayout footer={footer}>
      <form data-testid="register-email-form" onSubmit={handleSubmit} className="flex flex-col gap-2.5 w-full">
        <header className="auth-hero">
          <h1 className="auth-hero__title">
            {intl.formatMessage({ id: 'auth.register_wizard.step_email_title_fallback' })}
          </h1>
          <p className="auth-hero__subtitle">
            {intl.formatMessage({ id: 'auth.register_wizard.step_email_helper' })}
          </p>
        </header>

        <div>
          <AuthField
            label={intl.formatMessage({ id: 'auth.email_label' })}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
            autoFocus
            required
            below={error ? <div className="auth-error" role="alert">{error}</div> : null}
          />
        </div>

        <div>
          <IonButton
            expand="block"
            type="submit"
            disabled={submitting}
            className="mt-3"
          >
            {submitting ? (
              <IonSpinner name="crescent" />
            ) : (
              intl.formatMessage({ id: 'auth.register_wizard.continue' })
            )}
          </IonButton>
        </div>
      </form>
    </AuthLayout>
  )
}
