import { useCallback, useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import { IonButton, IonSpinner } from '@ionic/react'
import { useRouter } from '@/lib/next-navigation-shim'
import { AuthLayout } from '../AuthLayout'
import { AuthField } from '../AuthField'
import { APP_VERSION } from '@/lib/version'
import { useAuth } from '@/contexts/auth-context'
import { useAuthGate } from '@/contexts/auth-gate-context'
import { useWizardNav } from './WizardNavContext'

/**
 * Final step of the 3-step passwordless auth wizard. Only mounts
 * when the OTP verify reported `isNewUser: true` — the brand-new user
 * has a session but no name yet. Submitting calls `setName`, which
 * PATCHes the name onto the user row via better-auth's updateUser, then
 * routes to the hub. Name is mandatory: a missing name leaves the UI
 * with awkward empty-string placeholders downstream, and the user can
 * still edit it later via EditProfileModal.
 *
 * Defensive: if someone deep-links straight to this step without first
 * completing verify, the isNewUser flag is null and we send them back
 * to the hub. The auth-context's auth gate handles the unauthenticated
 * case separately.
 */
export function NameStep() {
  const intl = useIntl()
  const router = useRouter()
  const { name, setName: setWizardName, isNewUser } = useWizardNav()
  const { setName: persistName } = useAuth()
  const { playEntry } = useAuthGate()

  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Anyone landing here without having just completed verify shouldn't
  // be on this screen. Punt to the hub and let the higher-level auth
  // gates decide what to render.
  useEffect(() => {
    if (isNewUser === false) {
      router.replace('/')
    }
  }, [isNewUser, router])

  const trimmed = name.trim()
  const canSubmit = trimmed.length >= 2 && !submitting

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!canSubmit) return
      setError(null)
      setSubmitting(true)
      const result = await persistName(trimmed)
      if (!result.success) {
        setError(
          result.error ?? intl.formatMessage({ id: 'auth.connection_error' }),
        )
        setSubmitting(false)
        return
      }
      setSubmitting(false)
      await playEntry('/')
    },
    [canSubmit, intl, persistName, playEntry, trimmed],
  )

  const footer = (
    <p className="auth-version">
      {intl.formatMessage({ id: 'auth.version_label' }, { version: APP_VERSION })}
    </p>
  )

  return (
    <AuthLayout footer={footer}>
      <form data-testid="register-name-form" onSubmit={handleSubmit} className="flex flex-col gap-2.5 w-full">
        <header className="auth-hero">
          <h1 className="auth-hero__title">
            {intl.formatMessage({ id: 'auth.register_wizard.step_name_title' })}
          </h1>
          <p className="auth-hero__subtitle">
            {intl.formatMessage({ id: 'auth.register_wizard.step_name_helper' })}
          </p>
        </header>

        <div>
          <AuthField
            label={intl.formatMessage({ id: 'auth.name_label' })}
            type="text"
            value={name}
            onChange={(e) => setWizardName(e.target.value)}
            autoComplete="name"
            autoFocus
            required
            minLength={2}
            data-testid="name-input"
            below={error ? <div className="auth-error" role="alert">{error}</div> : null}
          />
        </div>

        <div>
          <IonButton
            expand="block"
            type="submit"
            disabled={!canSubmit}
            className="mt-3"
            data-testid="name-submit"
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
