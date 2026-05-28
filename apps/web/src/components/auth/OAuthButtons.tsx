import { useState } from 'react'
import { IonButton, IonIcon, IonSpinner } from '@ionic/react'
import { logoApple, logoGoogle } from 'ionicons/icons'
import { useIntl } from 'react-intl'
import { authClient } from '@/lib/auth-client'
import { PENDING_ENTRY_STORAGE_KEY } from '@/contexts/auth-gate-context'
import './OAuthButtons.css'

type Provider = 'google' | 'apple'

interface OAuthButtonsProps {
  /**
   * Path the OAuth provider redirects back to on success. Must be a
   * same-origin absolute path. Default = "/" (the hub).
   */
  callbackURL?: string
  /** Optional shared callback when an OAuth round-trip is initiated. */
  onInitiate?: () => void
  /** Disable while another part of the flow is mid-submit. */
  disabled?: boolean
}

export function OAuthButtons({ callbackURL = '/', onInitiate, disabled }: OAuthButtonsProps) {
  const intl = useIntl()
  const [pending, setPending] = useState<Provider | null>(null)

  async function startSocial(provider: Provider) {
    if (disabled || pending) return
    setPending(provider)
    onInitiate?.()
    // Tell AuthGateProvider that the upcoming cold-start (after the OAuth
    // round-trip lands back on callbackURL) should play the entry overlay.
    // sessionStorage survives cross-origin redirects within the same tab,
    // and the OAuth callback resolves back on this origin where the flag
    // is then consumed.
    try {
      sessionStorage.setItem(PENDING_ENTRY_STORAGE_KEY, '1')
    } catch {
      // Storage error, ignore — entry overlay just won't play.
    }
    try {
      // The call triggers a full-page redirect; the SPA won't get a chance
      // to resolve the promise. We don't await — we let the browser
      // navigate away. If the call rejects synchronously (e.g. provider
      // misconfigured), the button re-enables.
      await authClient.signIn.social({ provider, callbackURL })
    } catch {
      try {
        sessionStorage.removeItem(PENDING_ENTRY_STORAGE_KEY)
      } catch {
        // ignore
      }
      setPending(null)
    }
  }

  return (
    <div className="oauth-buttons">
      <IonButton
        expand="block"
        fill="outline"
        onClick={() => startSocial('google')}
        disabled={disabled || pending !== null}
        className="oauth-button"
      >
        {pending === 'google' ? (
          <IonSpinner name="crescent" />
        ) : (
          <>
            <IonIcon slot="start" icon={logoGoogle} aria-hidden="true" />
            {intl.formatMessage({ id: 'oauth_google_continue' })}
          </>
        )}
      </IonButton>

      <IonButton
        expand="block"
        fill="outline"
        onClick={() => startSocial('apple')}
        disabled={disabled || pending !== null}
        className="oauth-button"
      >
        {pending === 'apple' ? (
          <IonSpinner name="crescent" />
        ) : (
          <>
            <IonIcon slot="start" icon={logoApple} aria-hidden="true" />
            {intl.formatMessage({ id: 'oauth_apple_continue' })}
          </>
        )}
      </IonButton>
    </div>
  )
}
