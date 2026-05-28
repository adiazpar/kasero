'use client'

import { useIntl } from 'react-intl'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Crown, Building2 } from 'lucide-react'
import { IonButton, IonSpinner } from '@ionic/react'
import { ModalShell } from '@/components/ui'
import { LottiePlayerDynamic as LottiePlayer } from '@/components/animations'
import type { UseJoinBusinessReturn, CodeType } from '@/hooks'

type JoinStep = 'code' | 'preview' | 'success'

interface JoinBusinessModalProps {
  joinBusiness: UseJoinBusinessReturn
}

export function JoinBusinessModal({ joinBusiness }: JoinBusinessModalProps) {
  const t = useIntl()

  const {
    isOpen,
    handleClose,
    handleExitComplete,
    code,
    setCode,
    isValidating,
    codeType,
    business,
    role,
    fromUser,
    error,
    handleValidateCode,
    handleJoinOrAccept,
    handleTryAgain,
    handleSuccessDone,
    isJoining,
    joinSuccess,
  } = joinBusiness

  const [step, setStep] = useState<JoinStep>('code')

  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => setStep('code'), 250)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  const handleValidate = useCallback(async () => {
    const success = await handleValidateCode()
    if (success) {
      setStep('preview')
    }
  }, [handleValidateCode])

  const handleJoin = useCallback(async () => {
    const success = await handleJoinOrAccept()
    if (success) {
      setStep('success')
    }
  }, [handleJoinOrAccept])

  const onClose = useCallback(() => {
    handleClose()
    handleExitComplete()
  }, [handleClose, handleExitComplete])

  const onBack = step === 'preview' ? () => setStep('code') : undefined

  const title = t.formatMessage({ id: 'joinBusiness.modal_toolbar_title' })

  // Modal dismissal is the toolbar X across the app, so footer carries
  // only real actions. Transfers keep Decline (an actual API action,
  // distinct from dismiss); invites are just primary-only.
  const footer =
    step === 'code' ? (
      <IonButton
        onClick={handleValidate}
        disabled={code.length < 6 || isValidating}
      >
        {isValidating ? <IonSpinner name="crescent" /> : t.formatMessage({ id: 'common.continue' })}
      </IonButton>
    ) : step === 'preview' ? (
      codeType === 'transfer' ? (
        <>
          <IonButton fill="outline" onClick={onClose} disabled={isJoining}>
            {t.formatMessage({ id: 'joinBusiness.button_decline' })}
          </IonButton>
          <IonButton onClick={handleJoin} disabled={isJoining} data-haptic>
            {isJoining ? (
              <IonSpinner name="crescent" />
            ) : (
              t.formatMessage({ id: 'joinBusiness.button_accept_transfer' })
            )}
          </IonButton>
        </>
      ) : (
        <IonButton onClick={handleJoin} disabled={isJoining} data-haptic>
          {isJoining ? (
            <IonSpinner name="crescent" />
          ) : (
            t.formatMessage({ id: 'joinBusiness.button_join_business' })
          )}
        </IonButton>
      )
    ) : (
      <IonButton onClick={handleSuccessDone}>
        {t.formatMessage({ id: 'common.done' })}
      </IonButton>
    )

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      onBack={onBack}
      footer={footer}
      noSwipeDismiss
    >
      {step === 'code' && (
        <CodeInputContent
          code={code}
          setCode={setCode}
          isValidating={isValidating}
          error={error}
          onValidate={handleValidateCode}
          onTryAgain={handleTryAgain}
        />
      )}
      {step === 'preview' && (
        <PreviewContent
          codeType={codeType}
          business={business}
          role={role}
          fromUser={fromUser}
          isJoining={isJoining}
        />
      )}
      {step === 'success' && (
        <SuccessContent
          codeType={codeType}
          business={business}
          joinSuccess={joinSuccess}
        />
      )}
    </ModalShell>
  )
}

// ============================================
// CODE INPUT CONTENT
// ============================================

interface CodeInputContentProps {
  code: string
  setCode: (code: string) => void
  isValidating: boolean
  error: string | null
  onValidate: () => Promise<boolean>
  onTryAgain: () => void
}

function CodeInputContent({
  code,
  setCode,
  isValidating,
  error,
  onTryAgain,
}: CodeInputContentProps) {
  const t = useIntl()

  // Title with one italic-terracotta accent word.
  const titleNode = useMemo(() => {
    const full = t.formatMessage({ id: 'joinBusiness.code_title' })
    const emphasis = t.formatMessage({ id: 'joinBusiness.code_title_emphasis' })
    const idx = emphasis ? full.indexOf(emphasis) : -1
    if (!emphasis || idx === -1) return full
    return (
      <>
        {full.slice(0, idx)}
        <em>{emphasis}</em>
        {full.slice(idx + emphasis.length)}
      </>
    )
  }, [t])

  return (
    <div className="wizard-step join-business__code-stage">
      <header className="wizard-hero">
        <div className="wizard-hero__eyebrow">
          {t.formatMessage({ id: 'joinBusiness.code_eyebrow' })}
        </div>
        <h1 className="wizard-hero__title">{titleNode}</h1>
        <p className="wizard-hero__subtitle">
          {t.formatMessage({ id: 'joinBusiness.code_subtitle' })}
        </p>
      </header>

      <div className="join-business__code-frame">
        <div className="join-business__code-label">
          <span>{t.formatMessage({ id: 'joinBusiness.code_field_label' })}</span>
          <span className="join-business__code-counter">
            <strong>{code.length}</strong>{' / 6'}
          </span>
        </div>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder={t.formatMessage({ id: 'joinBusiness.code_placeholder' })}
          maxLength={6}
          className="join-business__code-input"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          disabled={isValidating}
          aria-label={t.formatMessage({ id: 'joinBusiness.code_field_label' })}
        />
        {/* Six dots that fill in as the user types — quick visual ledger. */}
        <div className="join-business__code-ledger" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className={i < code.length ? 'is-on' : undefined} />
          ))}
        </div>
      </div>

      {isValidating && (
        <div className="join-business__code-status">
          <IonSpinner name="crescent" />
          <span>{t.formatMessage({ id: 'joinBusiness.validating_code' })}</span>
        </div>
      )}

      {error && !isValidating && (
        <div className="join-business__code-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            onClick={onTryAgain}
            className="join-business__code-error-action"
          >
            {t.formatMessage({ id: 'joinBusiness.try_again' })}
          </button>
        </div>
      )}
    </div>
  )
}

// ============================================
// PREVIEW CONTENT
// ============================================

interface PreviewContentProps {
  codeType: CodeType | null
  business: { id: string; name: string } | null
  role: string | null
  fromUser: { name: string } | null
  isJoining: boolean
}

function PreviewContent({ codeType, business, role, fromUser, isJoining }: PreviewContentProps) {
  const t = useIntl()

  const formatRole = (r: string) => {
    if (r === 'partner') return t.formatMessage({ id: 'joinBusiness.role_partner' })
    if (r === 'employee') return t.formatMessage({ id: 'joinBusiness.role_employee' })
    return r
  }

  const titleNode = useMemo(() => {
    const fullId =
      codeType === 'transfer'
        ? 'joinBusiness.preview_transfer_title'
        : 'joinBusiness.preview_invite_title'
    const emphasisId =
      codeType === 'transfer'
        ? 'joinBusiness.preview_transfer_title_emphasis'
        : 'joinBusiness.preview_invite_title_emphasis'
    const full = t.formatMessage({ id: fullId })
    const emphasis = t.formatMessage({ id: emphasisId })
    const idx = emphasis ? full.indexOf(emphasis) : -1
    if (!emphasis || idx === -1) return full
    return (
      <>
        {full.slice(0, idx)}
        <em>{emphasis}</em>
        {full.slice(idx + emphasis.length)}
      </>
    )
  }, [t, codeType])

  if (isJoining) {
    return (
      <div className="wizard-step join-business__preview">
        <div className="join-business__preview-loading">
          <IonSpinner name="crescent" />
          <span>
            {codeType === 'transfer'
              ? t.formatMessage({ id: 'joinBusiness.accepting_transfer' })
              : t.formatMessage({ id: 'joinBusiness.joining_business' })}
          </span>
        </div>
      </div>
    )
  }

  if (codeType === 'transfer' && business) {
    return (
      <div className="wizard-step join-business__preview">
        <header className="wizard-hero">
          <div className="wizard-hero__eyebrow">
            {t.formatMessage({ id: 'joinBusiness.preview_transfer_eyebrow' })}
          </div>
          <h1 className="wizard-hero__title">{titleNode}</h1>
        </header>

        <article className="join-business__preview-card">
          <div className="join-business__preview-medallion join-business__preview-medallion--transfer">
            <Crown />
          </div>
          <span className="join-business__preview-eyebrow">
            {t.formatMessage({ id: 'joinBusiness.preview_business_label' })}
          </span>
          {/* User content — rendered verbatim. */}
          <h2 className="join-business__preview-name">{business.name}</h2>
          <p className="join-business__preview-body">
            <strong>{fromUser?.name || t.formatMessage({ id: 'joinBusiness.transfer_owner_fallback' })}</strong>{' '}
            {t.formatMessage({ id: 'joinBusiness.transfer_wants_to_transfer' })}
          </p>
          <p className="join-business__preview-footnote">
            {t.formatMessage({ id: 'joinBusiness.transfer_you_will_become_owner' })}
          </p>
        </article>
      </div>
    )
  }

  if (codeType === 'invite' && business) {
    return (
      <div className="wizard-step join-business__preview">
        <header className="wizard-hero">
          <div className="wizard-hero__eyebrow">
            {t.formatMessage({ id: 'joinBusiness.preview_invite_eyebrow' })}
          </div>
          <h1 className="wizard-hero__title">{titleNode}</h1>
        </header>

        <article className="join-business__preview-card">
          <div className="join-business__preview-medallion join-business__preview-medallion--invite">
            <Building2 />
          </div>
          <span className="join-business__preview-eyebrow">
            {t.formatMessage({ id: 'joinBusiness.preview_business_label' })}
          </span>
          {/* User content — rendered verbatim. */}
          <h2 className="join-business__preview-name">{business.name}</h2>
          <p className="join-business__preview-body">
            {t.formatMessage({ id: 'joinBusiness.invite_you_will_join_as' })}
          </p>
          <span className="join-business__preview-role">
            {formatRole(role || '')}
          </span>
        </article>
      </div>
    )
  }

  return null
}

// ============================================
// SUCCESS CONTENT
// ============================================

interface SuccessContentProps {
  codeType: CodeType | null
  business: { id: string; name: string } | null
  joinSuccess: boolean
}

function SuccessContent({ codeType, business, joinSuccess }: SuccessContentProps) {
  const t = useIntl()
  // Fallback string is only used as a render guard; if business is null the
  // upstream hook hasn't put the success step in front yet. Never translated
  // when business is real (user content rule).
  const businessName = business?.name || ''

  // Pull the right emphasis pair based on flow type.
  const titleNode = useMemo(() => {
    const fullId =
      codeType === 'transfer'
        ? 'joinBusiness.success_transfer_title_v2'
        : 'joinBusiness.success_join_title_v2'
    const emphasisId =
      codeType === 'transfer'
        ? 'joinBusiness.success_transfer_title_v2_emphasis'
        : 'joinBusiness.success_join_title_v2_emphasis'
    const full = t.formatMessage({ id: fullId })
    const emphasis = t.formatMessage({ id: emphasisId })
    const idx = emphasis ? full.indexOf(emphasis) : -1
    if (!emphasis || idx === -1) return full
    return (
      <>
        {full.slice(0, idx)}
        <em>{emphasis}</em>
        {full.slice(idx + emphasis.length)}
      </>
    )
  }, [t, codeType])

  return (
    <div className="wizard-step wizard-step--centered join-business__success">
      <div className="join-business__success-lottie">
        {joinSuccess && (
          <LottiePlayer
            src="/animations/success.json"
            loop={false}
            autoplay={true}
            delay={500}
            style={{ width: '100%', height: '100%' }}
          />
        )}
      </div>

      <span
        className="join-business__success-eyebrow"
        data-ready={joinSuccess}
      >
        {t.formatMessage({ id: 'joinBusiness.success_eyebrow' })}
      </span>

      <h1
        className="join-business__success-title"
        data-ready={joinSuccess}
      >
        {titleNode}
      </h1>

      <p
        className="join-business__success-body"
        data-ready={joinSuccess}
      >
        {codeType === 'transfer'
          ? t.formatMessage(
              { id: 'joinBusiness.success_transfer_description' },
              { name: businessName },
            )
          : t.formatMessage(
              { id: 'joinBusiness.success_join_description' },
              { name: businessName },
            )}
      </p>
    </div>
  )
}
