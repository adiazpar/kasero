import { useEffect, useState } from 'react'
import { IonButton, IonIcon, IonSpinner } from '@ionic/react'
import { logoApple, logoGoogle } from 'ionicons/icons'
import { useIntl } from 'react-intl'
import { Capacitor } from '@capacitor/core'
import { authClient } from '@/lib/auth-client'
import { apiUrl } from '@/lib/api-origin'
import { NATIVE_AUTH_EVENT } from '@/lib/native/events'
import {
  generateCodeVerifier,
  deriveCodeChallenge,
  storeCodeVerifier,
} from '@/lib/native/pkce'
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

  // Native only: the OAuth round-trip happens in the system browser, so
  // the SPA never navigates away. Clear the pending spinner when the
  // deep-link callback resolves (success or failure). Inert on web —
  // NATIVE_AUTH_EVENT is only ever dispatched by the native bootstrap.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    const onNativeAuth = () => setPending(null)
    window.addEventListener(NATIVE_AUTH_EVENT, onNativeAuth)
    return () => window.removeEventListener(NATIVE_AUTH_EVENT, onNativeAuth)
  }, [])

  // Native OAuth: better-auth cannot full-page-redirect the WebView (the
  // provider's cookies/session live in the system browser, and Apple/Google
  // both reject WebView logins). Instead:
  //   1. Generate a PKCE code_verifier (kept secret in Preferences) and
  //      derive its code_challenge.
  //   2. Ask better-auth for the provider auth URL (disableRedirect), with
  //      callbackURL -> /api/native/auth-callback?challenge=<challenge> so
  //      the challenge round-trips to the mint endpoint.
  //   3. Open the auth URL in the system browser (@capacitor/browser).
  //   4. The mint deep-links kasero://auth-callback?ott=... back into the
  //      app; lib/native/bootstrap redeems the ott WITH the verifier. An
  //      app that intercepts the deep link has the ott but not the verifier
  //      and cannot redeem.
  async function startSocialNative(provider: Provider) {
    const verifier = generateCodeVerifier()
    await storeCodeVerifier(verifier)
    const challenge = await deriveCodeChallenge(verifier)
    const res = await authClient.signIn.social({
      provider,
      callbackURL: apiUrl(
        `/api/native/auth-callback?challenge=${encodeURIComponent(challenge)}`,
      ),
      disableRedirect: true,
    })
    const err = (res as { error?: { message?: string } | null } | null)?.error
    const url = (res as { data?: { url?: string } | null } | null)?.data?.url
    if (err || !url) {
      setPending(null)
      return
    }
    const { Browser } = await import('@capacitor/browser')
    await Browser.open({ url })
    // pending stays set until the NATIVE_AUTH_EVENT listener clears it.
  }

  async function startSocial(provider: Provider) {
    if (disabled || pending) return
    setPending(provider)
    onInitiate?.()

    if (Capacitor.isNativePlatform()) {
      try {
        await startSocialNative(provider)
      } catch {
        setPending(null)
      }
      return
    }

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
