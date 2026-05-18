import { useIntl } from 'react-intl'
import {
  IonPage,
  IonHeader,
  IonToolbar,
  IonButtons,
  IonButton,
  IonIcon,
  IonContent,
} from '@ionic/react'
import { chevronBack } from 'ionicons/icons'
import {
  WizardNavProvider,
  useWizardNav,
} from '@/components/auth/wizard-steps/WizardNavContext'
import { EmailStep } from '@/components/auth/wizard-steps/EmailStep'
import { VerifyStep } from '@/components/auth/wizard-steps/VerifyStep'
import { NameStep } from '@/components/auth/wizard-steps/NameStep'

/**
 * 3-step passwordless auth wizard: email -> verify -> name.
 *
 * - email: collects the address and sends an OTP (sign-in mode, so
 *   first-time verify creates the user record server-side).
 * - verify: enters the 6-digit code, creates the session, and branches:
 *     - returning user => navigate to the hub.
 *     - new user => continue to the name step.
 * - name: captures the new user's display name and PATCHes it onto the
 *   user row, then routes to the hub.
 *
 * The wizard also accepts ?email=...&step=verify on mount — EntryPage
 * uses that contract to hand off after its own OTP send.
 */
export function AuthWizardPage() {
  return (
    <IonPage>
      <WizardNavProvider>
        <WizardHeader />
        <IonContent>
          <CurrentStep />
        </IonContent>
      </WizardNavProvider>
    </IonPage>
  )
}

// Back-chevron-only toolbar that mounts only on the verify step (and
// walks back to email). The email step is the wizard entry and the
// name step is terminal (the new user has a verified session), so
// neither needs a header bar. Branding intentionally absent from the
// auth surface.
function WizardHeader() {
  const intl = useIntl()
  const { current, goTo } = useWizardNav()
  if (current !== 'verify') return null
  return (
    <IonHeader>
      <IonToolbar>
        <IonButtons slot="start">
          <IonButton
            fill="clear"
            onClick={() => goTo('email')}
            aria-label={intl.formatMessage({ id: 'auth.register_wizard.back_aria' })}
          >
            <IonIcon icon={chevronBack} />
          </IonButton>
        </IonButtons>
      </IonToolbar>
    </IonHeader>
  )
}

// Rendering a fragment (not a wrapping div) keeps .auth-container as the
// direct child of IonContent, preserving the min-height:100% chain that
// pins the footer to the bottom.
function CurrentStep() {
  const { current } = useWizardNav()
  switch (current) {
    case 'email':
      return <EmailStep />
    case 'verify':
      return <VerifyStep />
    case 'name':
      return <NameStep />
  }
}
