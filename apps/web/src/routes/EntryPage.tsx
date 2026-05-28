import { useIntl } from 'react-intl'
import { useMemo, useState } from 'react'
import { IonPage, IonContent, IonButton, IonIcon } from '@ionic/react'
import { mailOutline } from 'ionicons/icons'
import { OAuthButtons } from '@/components/auth/OAuthButtons'
import { AuthLayout } from '@/components/auth'
import { EmailLoginModal } from '@/components/auth/EmailLoginModal'
import { APP_VERSION } from '@/lib/version'

/**
 * Unified passwordless entry. A centered header floats above a
 * bottom-anchored stack of three identical sign-in options:
 *  - Continue with Google / Apple (OAuthButtons; full-page redirect)
 *  - Continue with email — opens EmailLoginModal, which sends an OTP and
 *    forwards into the /auth wizard's verify step.
 *
 * Mounted at `/` by HubPage's unauthenticated branch.
 */
export function EntryPage() {
  const intl = useIntl()
  const [emailOpen, setEmailOpen] = useState(false)

  // Italic accent on the brand word, mirroring Hub's HubGreeting pattern.
  // "Kasero" is a proper noun rendered verbatim across locales, so the
  // emphasis term is a fixed string. Falls through to plain text if the
  // localized title happens not to contain the brand.
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

  const footer = (
    <p className="auth-version">
      {intl.formatMessage({ id: 'auth.version_label' }, { version: APP_VERSION })}
    </p>
  )

  return (
    <IonPage>
      <IonContent>
        <AuthLayout footer={footer} center>
          <header className="auth-hero auth-hero--entry">
            <h1 className="auth-hero__title">{titleNode}</h1>
            <p className="auth-hero__subtitle">
              {intl.formatMessage({ id: 'auth.welcome_back_subtitle' })}
            </p>
          </header>

          <div className="entry-actions">
            <OAuthButtons callbackURL="/" />
            <IonButton
              expand="block"
              fill="outline"
              className="oauth-button"
              onClick={() => setEmailOpen(true)}
              data-testid="entry-email-open"
            >
              <IonIcon slot="start" icon={mailOutline} aria-hidden="true" />
              {intl.formatMessage({ id: 'oauth_email_continue' })}
            </IonButton>
          </div>
        </AuthLayout>
      </IonContent>

      <EmailLoginModal isOpen={emailOpen} onClose={() => setEmailOpen(false)} />
    </IonPage>
  )
}
