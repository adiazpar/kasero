'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import { useDismissOnDelete } from '@/hooks/useDismissOnDelete'
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonFooter,
  IonButtons,
  IonButton,
  IonIcon,
  IonSpinner,
} from '@ionic/react'
import { close, chevronBack } from 'ionicons/icons'
import { ModalShell } from '@/components/ui'
import { LottiePlayerDynamic as LottiePlayer } from '@/components/animations'
import type { User, UserRole } from '@kasero/shared/types'
import type { TeamMember } from '@/hooks/useTeamManagement'
import { MemberDetailsBody } from './member-steps/MemberDetailsStep'
import { MemberRoleChangeBody } from './member-steps/MemberRoleChangeStep'
import { MemberPartnerWarningBody } from './member-steps/MemberPartnerWarningStep'
import { MemberRemoveBody } from './member-steps/MemberRemoveStep'

type Step =
  | 'details'
  | 'role-change'
  | 'partner-warn'
  | 'remove'
  | 'role-success'
  | 'remove-success'

export interface MemberModalProps {
  isOpen: boolean
  onClose: () => void
  onExitComplete: () => void

  member: TeamMember | null
  currentUser: User | null
  canManageTeam: boolean
  callerRole: UserRole | null

  newRole: 'partner' | 'employee'
  setNewRole: (role: 'partner' | 'employee') => void

  roleChangeLoading: boolean
  removeLoading: boolean

  onToggleStatus: () => void
  onSubmitRoleChange: () => Promise<boolean>
  onRemoveMember: () => Promise<boolean>
}

/**
 * Member detail + management flow. Pattern 1 (single `step` state,
 * conditional body rendering inside one ModalShell). The previous
 * IonNav-based version registered each step's `<IonPage>` against the
 * surrounding IonRouterOutlet's StackManager, which left the outlet's
 * view-stack tracking in a state that made the next iOS slide pop
 * (e.g. team -> manage) drag for ~1-2s. See InviteModal for the full
 * note.
 *
 * `rawContent` so we keep the team modal's `.pm-header / .pm-content /
 * .pm-footer` styling that the default ModalShell IonContent doesn't
 * apply.
 *
 * Role change + remove confirm flows each push to their own
 * `*-success` step on resolution — Lottie tick (or trash for the
 * destructive remove) + mono stamp + Fraunces italic title — so the
 * caller closes the loop the same way every other major action in the
 * app does.
 */
export function MemberModal({
  isOpen,
  onClose,
  onExitComplete,
  member,
  currentUser,
  canManageTeam,
  callerRole,
  setNewRole,
  roleChangeLoading,
  removeLoading,
  onToggleStatus,
  onSubmitRoleChange,
  onRemoveMember,
}: MemberModalProps) {
  const t = useIntl()
  const stableDismiss = useCallback(() => onClose(), [onClose])
  useDismissOnDelete('team-member', member?.id ?? null, stableDismiss)

  const [step, setStep] = useState<Step>('details')
  // Snapshot identity + intent before the parent's state mutation so the
  // success copy still reads the right name + direction after the row
  // disappears (remove) or the role flips (promote/demote) in the source
  // of truth. `wasPromoting` captures the BEFORE state, so a confirmed
  // promotion still reads "Promoted." even though `member.role` is now
  // partner.
  const [actedName, setActedName] = useState<string>('')
  const [wasPromoting, setWasPromoting] = useState<boolean>(false)

  // Reset to root surface every time the modal opens. Gated on the
  // close→open transition via a ref so the parent flipping member.role
  // mid-save (after onSubmitRoleChange resolves) doesn't re-fire the
  // reset and clobber our 'role-success' step — same class of bug we
  // patched on the manage + provider edit modals.
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setStep('details')
      setActedName('')
      setWasPromoting(false)
    }
    wasOpenRef.current = isOpen
  }, [isOpen])

  // Delayed cleanup — runs ~250ms after dismiss animation so the
  // parent's handleUserModalExitComplete (clears selectedMember) does
  // not unmount the modal mid animation.
  useEffect(() => {
    if (isOpen) return
    const timer = window.setTimeout(onExitComplete, 250)
    return () => window.clearTimeout(timer)
  }, [isOpen, onExitComplete])

  if (!member) return null

  const isSelf = member.id === currentUser?.id
  const isPartnerOnPartner = callerRole === 'partner' && member.role === 'partner'
  const isManageable =
    canManageTeam && !isSelf && member.role !== 'owner' && !isPartnerOnPartner
  const isPromoting = member.role === 'employee'

  // Title is only shown on the details step (matches the prior
  // toolbar that rendered an IonTitle there). Sub-steps' toolbars
  // were title-less; they leaned on the body's hero to set context.
  const modalTitleId = isSelf
    ? 'team.member_v2.step_title_self'
    : 'team.member_v2.step_title_other'

  // Back arrow only on the intermediate confirm steps. Terminal success
  // steps don't expose Back — the user closes via the Done pill.
  const onBack: (() => void) | undefined =
    step === 'role-change' || step === 'partner-warn' || step === 'remove'
      ? () => setStep('details')
      : undefined

  const handleChangeRoleTap = () => {
    // Pre-set the proposed direction so the role-change / warning
    // step opens with the right radio selected, then advance.
    setNewRole(isPromoting ? 'partner' : 'employee')
    setStep(isPromoting ? 'partner-warn' : 'role-change')
  }

  const handleRoleChangeConfirm = async () => {
    // Snapshot identity + direction BEFORE the parent mutates the row.
    const name = member.name
    const promoting = isPromoting
    const ok = await onSubmitRoleChange()
    if (ok) {
      setActedName(name)
      setWasPromoting(promoting)
      setStep('role-success')
    } else {
      // Fail closed back to the details surface so an error doesn't
      // strand the user on the confirm step with no Back arrow.
      setStep('details')
    }
  }

  const handleRemoveConfirm = async () => {
    const name = member.name
    const ok = await onRemoveMember()
    if (ok) {
      setActedName(name)
      setStep('remove-success')
    }
  }

  // Footer derived per step. Details step has no footer (its actions
  // are inline action ladder buttons in the body).
  let footer: React.ReactNode = null
  if (step === 'role-change' || step === 'partner-warn') {
    const isDanger = step === 'partner-warn'
    footer = (
      <IonButton
        color={isDanger ? 'danger' : undefined}
        onClick={handleRoleChangeConfirm}
        disabled={roleChangeLoading}
        data-haptic
      >
        {roleChangeLoading ? (
          <IonSpinner name="crescent" />
        ) : (
          t.formatMessage({
            id: isDanger
              ? 'team.member_v2.partner_warning_confirm'
              : 'team.member_v2.role_change_confirm',
          })
        )}
      </IonButton>
    )
  } else if (step === 'remove') {
    footer = (
      <IonButton
        color="danger"
        onClick={handleRemoveConfirm}
        disabled={removeLoading}
        data-haptic
      >
        {removeLoading ? (
          <IonSpinner name="crescent" />
        ) : (
          t.formatMessage({ id: 'team.member_v2.remove_confirm' })
        )}
      </IonButton>
    )
  } else if (step === 'role-success' || step === 'remove-success') {
    footer = (
      <IonButton onClick={onClose} data-haptic>
        {t.formatMessage({ id: 'common.done' })}
      </IonButton>
    )
  }

  const successStampKey = step === 'remove-success'
    ? 'team.member_v2.remove_success_stamp'
    : wasPromoting
      ? 'team.member_v2.role_success_promote_stamp'
      : 'team.member_v2.role_success_demote_stamp'
  const successTitleKey = step === 'remove-success'
    ? 'team.member_v2.remove_success_title'
    : wasPromoting
      ? 'team.member_v2.role_success_promote_title'
      : 'team.member_v2.role_success_demote_title'
  const successSubtitleKey = step === 'remove-success'
    ? 'team.member_v2.remove_success_subtitle'
    : wasPromoting
      ? 'team.member_v2.role_success_promote_subtitle'
      : 'team.member_v2.role_success_demote_subtitle'
  const successLottieSrc = step === 'remove-success'
    ? '/animations/trash.json'
    : '/animations/success.json'

  // Terminal success steps are chromeless — no header bar at all. The user
  // closes via the Done footer pill.
  const isSuccessStep = step === 'role-success' || step === 'remove-success'

  return (
    <ModalShell rawContent isOpen={isOpen} onClose={onClose}>
      {!isSuccessStep && (
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
          {step === 'details' && (
            <IonTitle>{t.formatMessage({ id: modalTitleId })}</IonTitle>
          )}
          <IonButtons slot="end">
            <IonButton
              fill="clear"
              onClick={onClose}
              aria-label={t.formatMessage({ id: 'common.close' })}
            >
              <IonIcon icon={close} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      )}

      <IonContent className="pm-content">
        {step === 'details' && (
          <MemberDetailsBody
            member={member}
            isSelf={isSelf}
            isManageable={isManageable}
            isPromoting={isPromoting}
            onChangeRole={handleChangeRoleTap}
            onToggleStatus={onToggleStatus}
            onRemove={() => setStep('remove')}
            onCloseSelfFooterLink={onClose}
          />
        )}
        {step === 'role-change' && <MemberRoleChangeBody member={member} />}
        {step === 'partner-warn' && <MemberPartnerWarningBody member={member} />}
        {step === 'remove' && <MemberRemoveBody member={member} />}

        {(step === 'role-success' || step === 'remove-success') && (
          <div className="manage-seal" aria-hidden={step !== 'role-success' && step !== 'remove-success'}>
            <div className="manage-seal__lottie">
              <LottiePlayer
                src={successLottieSrc}
                loop={false}
                autoplay={true}
                delay={300}
                style={{ width: 144, height: 144 }}
              />
            </div>

            <span className="manage-seal__stamp">
              {t.formatMessage({ id: successStampKey })}
            </span>

            <h2 className="manage-seal__title">
              {t.formatMessage(
                { id: successTitleKey },
                { em: (chunks) => <em>{chunks}</em> },
              )}
            </h2>

            <p className="manage-seal__subtitle">
              {t.formatMessage(
                { id: successSubtitleKey },
                { name: actedName },
              )}
            </p>
          </div>
        )}
      </IonContent>

      {footer && (
        <IonFooter className="pm-footer">
          <IonToolbar>
            <div className="modal-footer">{footer}</div>
          </IonToolbar>
        </IonFooter>
      )}
    </ModalShell>
  )
}
