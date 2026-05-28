import { useCallback, useEffect, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import { IonButton, IonSpinner } from '@ionic/react'
import { ModalShell } from '@/components/ui/modal-shell'
import { AuthField } from '@/components/auth'
import { useRouter } from '@/lib/next-navigation-shim'
import { useAuth } from '@/contexts/auth-context'

// Shared with EntryPage / the auth-wizard EmailStep — keep acceptance
// semantics identical. better-auth re-validates on the server.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface Props {
  isOpen: boolean
  onClose: () => void
}

/**
 * Single-step email entry modal launched from EntryPage's "Continue with
 * email" option. Sends a 6-digit OTP via better-auth's email-otp plugin in
 * sign-in mode (idempotent; creates the user on first verify) and forwards
 * into the /auth wizard's verify step. New-vs-returning branching is the
 * wizard's job; this modal only owns the email send.
 */
export function EmailLoginModal({ isOpen, onClose }: Props) {
  const intl = useIntl()
  const router = useRouter()
  const { sendOtp } = useAuth()

  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Reset to a clean form on each closed->open transition (the same modal
  // instance is reused across opens).
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setEmail('')
      setError(null)
      setIsLoading(false)
    }
    wasOpenRef.current = isOpen
  }, [isOpen])

  const trimmed = email.trim()
  const valid = EMAIL_RE.test(trimmed)
  const canSubmit = valid && !isLoading

  const handleEmailChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (error) setError(null)
      setEmail(e.target.value)
    },
    [error],
  )

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return
    setError(null)
    setIsLoading(true)
    const result = await sendOtp(trimmed)
    if (!result.success) {
      setError(result.error ?? intl.formatMessage({ id: 'auth.connection_error' }))
      setIsLoading(false)
      return
    }
    // Hand off to the auth wizard at the verify step. WizardNavContext
    // reads ?email=&step=verify to resume there.
    router.push(`/auth?email=${encodeURIComponent(trimmed)}&step=verify`)
    onClose()
  }, [canSubmit, intl, onClose, router, sendOtp, trimmed])

  const footer = (
    <IonButton
      expand="block"
      onClick={handleSubmit}
      disabled={!canSubmit}
      className="flex-1"
      data-testid="email-modal-submit"
    >
      {isLoading ? (
        <IonSpinner name="crescent" />
      ) : (
        intl.formatMessage({ id: 'auth.register_wizard.continue' })
      )}
    </IonButton>
  )

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={intl.formatMessage({ id: 'auth.email_modal_title' })}
      noSwipeDismiss
      footer={footer}
    >
      <header className="modal-hero">
        <p className="modal-hero__subtitle">
          {intl.formatMessage({ id: 'auth.email_modal_subtitle' })}
        </p>
      </header>

      <form onSubmit={(e) => { e.preventDefault(); handleSubmit() }} data-testid="email-modal-form">
        <AuthField
          label={intl.formatMessage({ id: 'auth.email_label' })}
          type="email"
          value={email}
          onChange={handleEmailChange}
          autoComplete="email"
          inputMode="email"
          autoFocus
          required
          data-testid="email-modal-input"
          below={
            error ? (
              <div className="auth-error" role="alert">
                {error}
              </div>
            ) : null
          }
        />
      </form>
    </ModalShell>
  )
}
