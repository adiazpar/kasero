import { useIntl } from 'react-intl'
import { useCallback, useMemo, useState } from 'react'
import {
  IonPage,
  IonContent,
  IonButton,
  IonSpinner,
} from '@ionic/react'
import { OAuthButtons } from '@/components/auth/OAuthButtons'
import { AuthLayout, AuthField } from '@/components/auth'
import { useRouter } from '@/lib/next-navigation-shim'
import { useAuth } from '@/contexts/auth-context'
import { APP_VERSION } from '@/lib/version'

// Match the validator used by the auth-wizard EmailStep so the pre-flight
// check on this screen and the wizard share the exact same acceptance
// semantics. Intentionally permissive — better-auth's server re-validates
// on the OTP send.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Unified passwordless entry. Single screen, two methods:
 *  - Continue with Google (handled by OAuthButtons; redirects away)
 *  - Continue with email — sends an OTP and forwards into the auth
 *    wizard's verify step. The wizard handles new vs returning users
 *    based on whether the verified account has a name set.
 *
 * Replaces the old /login + /register split (now `/` + `/auth`).
 * Mounted at `/` by HubPage's unauthenticated branch.
 */
export function EntryPage() {
  const intl = useIntl()
  const router = useRouter()
  const { sendOtp } = useAuth()

  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const trimmed = email.trim()
  const valid = EMAIL_RE.test(trimmed)
  const canSubmit = valid && !isLoading

  // Italic accent on the brand word, mirroring Hub's HubGreeting pattern
  // (apps/web/src/components/hub/HubHome.tsx). "Kasero" is a proper noun
  // rendered verbatim across locales, so the emphasis term is a fixed
  // string rather than a separate i18n key. Falls through to plain text
  // if the localized title happens not to contain the brand.
  const titleNode = useMemo(() => {
    const full = intl.formatMessage({ id: 'auth.heading_login' })
    const emphasis = 'Kasero'
    const idx = full.indexOf(emphasis)
    if (idx === -1) return full
    return (
      <>
        {full.slice(0, idx)}
        <em>{emphasis}</em>
        {full.slice(idx + emphasis.length)}
      </>
    )
  }, [intl])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!canSubmit) return
      setError(null)
      setIsLoading(true)
      const result = await sendOtp(trimmed)
      if (!result.success) {
        setError(
          result.error ??
            intl.formatMessage({ id: 'auth.connection_error' }),
        )
        setIsLoading(false)
        return
      }
      // Hand off to the auth wizard at the verify step with the email
      // pre-set on the query string. WizardNavContext reads these
      // params to resume at the verify step.
      router.push(
        `/auth?email=${encodeURIComponent(trimmed)}&step=verify`,
      )
    },
    [canSubmit, intl, router, sendOtp, trimmed],
  )

  // Clear inline error when the user resumes editing.
  const handleEmailChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (error) setError(null)
      setEmail(e.target.value)
    },
    [error],
  )

  const footer = (
    <p className="auth-version">
      {intl.formatMessage(
        { id: 'auth.version_label' },
        { version: APP_VERSION },
      )}
    </p>
  )

  return (
    <IonPage>
      <IonContent>
        <AuthLayout footer={footer} center>
          <header className="auth-hero">
            <h1 className="auth-hero__title">{titleNode}</h1>
            <p className="auth-hero__subtitle">
              {intl.formatMessage({ id: 'auth.welcome_back_subtitle' })}
            </p>
          </header>

          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-2.5 w-full"
            data-testid="entry-form"
          >
            <div>
              <AuthField
                label={intl.formatMessage({ id: 'auth.email_label' })}
                type="email"
                value={email}
                onChange={handleEmailChange}
                autoComplete="email"
                inputMode="email"
                autoFocus
                required
                data-testid="entry-email-input"
                below={
                  error ? (
                    <div className="auth-error" role="alert">
                      {error}
                    </div>
                  ) : null
                }
              />

              <IonButton
                expand="block"
                type="submit"
                disabled={!canSubmit}
                className="mt-3"
                data-testid="entry-email-submit"
              >
                {isLoading ? (
                  <IonSpinner name="crescent" />
                ) : (
                  intl.formatMessage({ id: 'auth.register_wizard.continue' })
                )}
              </IonButton>

              <div className="oauth-divider">
                {intl.formatMessage({ id: 'oauth_or_divider' })}
              </div>

              <OAuthButtons callbackURL="/" disabled={isLoading} />
            </div>
          </form>
        </AuthLayout>
      </IonContent>
    </IonPage>
  )
}
