'use client'

import { useCallback, useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import { useDismissOnDelete } from '@/hooks/useDismissOnDelete'
import {
  IonHeader,
  IonToolbar,
  IonContent,
  IonFooter,
  IonButtons,
  IonButton,
  IonIcon,
} from '@ionic/react'
import { close, chevronBack } from 'ionicons/icons'
import { ModalShell } from '@/components/ui'
import type { InviteRole } from '@kasero/shared/types'
import type { InviteDuration } from '@kasero/shared/auth'
import { InviteRoleBody } from './invite-steps/InviteRoleStep'
import { InvitePartnerWarningBody } from './invite-steps/InvitePartnerWarningStep'
import { InviteCodeBody } from './invite-steps/InviteCodeStep'
import { InviteDeleteCodeBody } from './invite-steps/InviteDeleteCodeStep'
import { InviteDeletedSuccessBody } from './invite-steps/InviteDeletedSuccessStep'

type Step = 'role' | 'partner-warn' | 'code' | 'delete-confirm' | 'deleted-success'

export interface InviteModalProps {
  isOpen: boolean
  onClose: () => void
  onExitComplete: () => void

  /** ID of the currently displayed invite code; used to auto-dismiss when deleted remotely. */
  inviteId: string | null

  selectedRole: InviteRole
  setSelectedRole: (role: InviteRole) => void

  selectedDuration: InviteDuration
  setSelectedDuration: (d: InviteDuration) => void

  newCode: string | null
  newCodeExpiresAt: Date | null
  qrDataUrl: string | null
  isGenerating: boolean
  copyFeedback: string | null

  onGenerateCode: () => Promise<void>
  onRegenerateCode: () => Promise<void>
  onCopyCode: (code: string) => void
  onDeleteCode: () => Promise<boolean>
  isDeletingCode: boolean
  codeDeleted: boolean
}

/**
 * Invite-creation flow. Uses Pattern 1 (single `step` state, conditional
 * body rendering inside one ModalShell) instead of Pattern 2 (IonNav).
 *
 * Why no IonNav: each IonNav step file rendered an `<IonPage>` React
 * component, which calls `registerIonPage` against the surrounding
 * IonRouterOutlet's StackManager regardless of whether it lives inside
 * an IonModal portal. Those phantom registrations left the outlet's
 * view-stack tracking in a state that made the next iOS slide pop
 * (e.g. team -> manage) drag for ~1-2s. Pattern 1 has no IonPage in the
 * step bodies — only the wrapper `<div class="ion-page">` Ionic adds
 * automatically inside IonModal for layout, which doesn't register.
 *
 * The chrome is rendered with `rawContent` so we can keep the team
 * modal's `.pm-header / .pm-content / .pm-footer` styling that the
 * default ModalShell IonContent doesn't apply.
 */
export function InviteModal({
  isOpen,
  onClose,
  onExitComplete,
  inviteId,
  selectedRole,
  setSelectedRole,
  selectedDuration,
  setSelectedDuration,
  newCode,
  newCodeExpiresAt,
  qrDataUrl,
  isGenerating,
  copyFeedback,
  onGenerateCode,
  onRegenerateCode,
  onCopyCode,
  onDeleteCode,
  isDeletingCode,
  codeDeleted,
}: InviteModalProps) {
  const t = useIntl()
  const stableDismiss = useCallback(() => onClose(), [onClose])
  useDismissOnDelete('invite', inviteId, stableDismiss)

  const [step, setStep] = useState<Step>(newCode ? 'code' : 'role')

  // Sync step with parent state when the modal opens. If the parent
  // already has a code (opened from existing invite-code list item),
  // jump to the code surface; otherwise start on role selection.
  useEffect(() => {
    if (!isOpen) return
    setStep(newCode ? 'code' : 'role')
    // Only re-sync on transitions into open state. Step transitions
    // inside the open modal must not be reverted by this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // Delayed cleanup — runs ~250ms after the modal animates closed so
  // the parent's handleModalExitComplete state-clear doesn't fire mid
  // dismiss animation.
  useEffect(() => {
    if (isOpen) return
    const timer = window.setTimeout(onExitComplete, 250)
    return () => window.clearTimeout(timer)
  }, [isOpen, onExitComplete])

  // After a successful delete, the parent flips codeDeleted=true. Move
  // to the success step so the user lands on the seal.
  useEffect(() => {
    if (codeDeleted && step === 'delete-confirm') {
      setStep('deleted-success')
    }
  }, [codeDeleted, step])

  const handleGenerate = async () => {
    if (selectedRole === 'partner') {
      setStep('partner-warn')
    } else {
      await onGenerateCode()
      setStep('code')
    }
  }

  const handlePartnerConfirm = async () => {
    await onGenerateCode()
    setStep('code')
  }

  const handleRevoke = () => setStep('delete-confirm')
  const handleDelete = async () => {
    const ok = await onDeleteCode()
    if (ok) setStep('deleted-success')
  }

  // Toolbar back-button visibility per step. role/code/deleted-success
  // are entry surfaces; the rest can step back to their parent.
  const onBack: (() => void) | undefined =
    step === 'partner-warn'
      ? () => setStep('role')
      : step === 'delete-confirm'
        ? () => setStep('code')
        : undefined

  // Footer derived per step. Each footer is wrapped in `.modal-footer`
  // so the standard pill row layout applies.
  let footer: React.ReactNode = null
  if (step === 'role') {
    footer = (
      <button
        type="button"
        className="order-modal__primary-pill"
        onClick={handleGenerate}
        disabled={isGenerating}
        data-haptic
      >
        {isGenerating ? (
          <span
            className="order-modal__pill-spinner"
            aria-label={t.formatMessage({ id: 'common.loading' })}
          />
        ) : (
          t.formatMessage({ id: 'team.generate_code_button' })
        )}
      </button>
    )
  } else if (step === 'partner-warn') {
    footer = (
      <button
        type="button"
        className="order-modal__primary-pill"
        onClick={handlePartnerConfirm}
        disabled={isGenerating}
        data-haptic
      >
        {isGenerating ? (
          <span
            className="order-modal__pill-spinner"
            aria-label={t.formatMessage({ id: 'common.loading' })}
          />
        ) : (
          t.formatMessage({ id: 'team.invite_v2.partner_warning_confirm' })
        )}
      </button>
    )
  } else if (step === 'code') {
    footer = (
      <button
        type="button"
        className="order-modal__primary-pill"
        onClick={onClose}
      >
        {t.formatMessage({ id: 'team.invite_v2.code_done_button' })}
      </button>
    )
  } else if (step === 'delete-confirm') {
    footer = (
      <button
        type="button"
        className="tm-invite__danger-pill"
        onClick={handleDelete}
        disabled={isDeletingCode}
        data-haptic
      >
        {isDeletingCode ? (
          <span
            className="order-modal__pill-spinner"
            aria-label={t.formatMessage({ id: 'common.loading' })}
          />
        ) : (
          t.formatMessage({ id: 'team.invite_v2.delete_confirm' })
        )}
      </button>
    )
  } else {
    footer = (
      <button
        type="button"
        className="order-modal__primary-pill"
        onClick={onClose}
      >
        {t.formatMessage({ id: 'team.invite_v2.deleted_back' })}
      </button>
    )
  }

  return (
    <ModalShell rawContent isOpen={isOpen} onClose={onClose}>
      <IonHeader className="pm-header">
        <IonToolbar>
          {onBack && (
            <IonButtons slot="start">
              <IonButton
                fill="clear"
                onClick={onBack}
                aria-label={t.formatMessage({ id: 'common.back' })}
              >
                <IonIcon icon={chevronBack} />
              </IonButton>
            </IonButtons>
          )}
          {step !== 'deleted-success' && (
            <IonButtons slot="end">
              <IonButton
                fill="clear"
                onClick={onClose}
                aria-label={t.formatMessage({ id: 'common.close' })}
              >
                <IonIcon icon={close} />
              </IonButton>
            </IonButtons>
          )}
        </IonToolbar>
      </IonHeader>

      <IonContent className="pm-content">
        {step === 'role' && (
          <InviteRoleBody
            selectedRole={selectedRole}
            setSelectedRole={setSelectedRole}
            selectedDuration={selectedDuration}
            setSelectedDuration={setSelectedDuration}
          />
        )}
        {step === 'partner-warn' && <InvitePartnerWarningBody />}
        {step === 'code' && (
          <InviteCodeBody
            selectedRole={selectedRole}
            newCode={newCode}
            newCodeExpiresAt={newCodeExpiresAt}
            qrDataUrl={qrDataUrl}
            isGenerating={isGenerating}
            copyFeedback={copyFeedback}
            onCopyCode={onCopyCode}
            onRegenerateCode={onRegenerateCode}
            onRevoke={handleRevoke}
          />
        )}
        {step === 'delete-confirm' && (
          <InviteDeleteCodeBody newCode={newCode} />
        )}
        {step === 'deleted-success' && <InviteDeletedSuccessBody />}
      </IonContent>

      <IonFooter className="pm-footer">
        <IonToolbar>
          <div className="modal-footer">{footer}</div>
        </IonToolbar>
      </IonFooter>
    </ModalShell>
  )
}
