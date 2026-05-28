'use client'

import { useIntl } from 'react-intl'
import { useEffect, useMemo, useState } from 'react'
import { Check, Mail } from 'lucide-react'
import { IonButton, IonSpinner } from '@ionic/react'
import { ModalShell, ConfirmationAnimation } from '@/components/ui'
import { AuthField } from '@/components/auth'
import { useAuth } from '@/contexts/auth-context'
import { useBusiness } from '@/contexts/business-context'
import { usePendingTransferContext } from '@/contexts/pending-transfer-context'
import { useTransferOwnership } from '@/hooks/useTransferOwnership'
import { fetchDeduped } from '@/lib/fetch'
import { getUserInitials } from '@kasero/shared/auth'

interface TeamMember {
  id: string
  email: string
  name: string
  avatar?: string | null
  role: 'owner' | 'partner' | 'employee'
  status: 'active' | 'disabled'
}

interface Props { isOpen: boolean; onClose: () => void }

type Step = 'form' | 'confirm' | 'success'

export function TransferOwnershipModal({ isOpen, onClose }: Props) {
  const intl = useIntl()
  const { user } = useAuth()
  const { business, businessId } = useBusiness()
  const { submit, isSubmitting, error, reset } = useTransferOwnership()
  const { refresh: refreshPendingTransfer } = usePendingTransferContext()

  const [step, setStep] = useState<Step>('form')
  const [members, setMembers] = useState<TeamMember[]>([])
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null)
  const [customEmail, setCustomEmail] = useState('')
  const [mode, setMode] = useState<'picker' | 'email'>('picker')
  const [typedConfirm, setTypedConfirm] = useState('')
  const [transferSent, setTransferSent] = useState(false)

  useEffect(() => {
    if (!isOpen || !businessId) return
    let cancelled = false
    async function load() {
      try {
        const res = await fetchDeduped(`/api/businesses/${businessId}/team`)
        const data = await res.json()
        if (cancelled) return
        const eligible: TeamMember[] = (data.teamMembers ?? []).filter(
          (m: TeamMember) => m.role !== 'owner',
        )
        setMembers(eligible)
      } catch (err) { console.error('Load team error:', err) }
    }
    load()
    return () => { cancelled = true }
  }, [isOpen, businessId])

  // Reset all state after the modal has finished closing
  useEffect(() => {
    if (!isOpen) {
      const t = setTimeout(() => {
        setStep('form')
        setSelectedEmail(null)
        setCustomEmail('')
        setMode('picker')
        setTypedConfirm('')
        setTransferSent(false)
        reset()
      }, 250)
      return () => clearTimeout(t)
    }
  }, [isOpen, reset])

  const recipient = mode === 'picker'
    ? (selectedEmail ? members.find(m => m.email === selectedEmail) : null)
    : null
  const recipientEmail = mode === 'picker' ? selectedEmail : customEmail.trim()
  const recipientLabel = recipient?.name ?? recipientEmail ?? ''
  const isStep1Valid = mode === 'picker'
    ? !!selectedEmail
    : /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customEmail.trim())
  const isStep2Valid = typedConfirm === business?.name

  const handleSubmit = async () => {
    if (!recipientEmail) return
    const ok = await submit(recipientEmail)
    if (ok) {
      await refreshPendingTransfer()
      setTransferSent(true)
      setStep('success')
    }
  }

  // Hero title for the form step (with italic emphasis word).
  const titleNode = useMemo(() => {
    const full = intl.formatMessage({ id: 'manage.transfer_hero_title' })
    const emphasis = intl.formatMessage({ id: 'manage.transfer_hero_title_emphasis' })
    const idx = full.indexOf(emphasis)
    if (!emphasis || idx === -1) return full
    return (
      <>
        {full.slice(0, idx)}
        <em>{emphasis}</em>
        {full.slice(idx + emphasis.length)}
      </>
    )
  }, [intl])

  const titlesByStep: Record<Step, string> = {
    form: intl.formatMessage({ id: 'manage.transfer_ownership' }),
    confirm: intl.formatMessage({ id: 'manage.transfer_ownership' }),
    success: '',
  }

  const onBack = step === 'confirm' ? () => setStep('form') : undefined

  const footer =
    step === 'form' ? (
      <IonButton expand="block" onClick={() => setStep('confirm')} disabled={!isStep1Valid}>
        {intl.formatMessage({ id: 'common.continue' })}
      </IonButton>
    ) : step === 'confirm' ? (
      <IonButton expand="block" onClick={handleSubmit} disabled={isSubmitting || !isStep2Valid} data-haptic>
        {isSubmitting ? <IonSpinner name="crescent" /> : intl.formatMessage({ id: 'manage.transfer_send_request' })}
      </IonButton>
    ) : (
      <IonButton expand="block" onClick={onClose}>
        {intl.formatMessage({ id: 'common.done' })}
      </IonButton>
    )

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={titlesByStep[step]}
      chromeless={step === 'success'}
      onBack={onBack}
      footer={footer}
      noSwipeDismiss
    >
      {/* ===== Step 0: pick recipient ===== */}
      {step === 'form' && (
        <>
          {error && <div className="modal-error">{error}</div>}

          <header className="modal-hero transfer-ownership__hero">
            <div className="modal-hero__eyebrow">
              {intl.formatMessage({ id: 'manage.transfer_hero_eyebrow' })}
            </div>
            <h1 className="modal-hero__title">{titleNode}</h1>
            <p className="modal-hero__subtitle">
              {intl.formatMessage({ id: 'manage.transfer_hero_subtitle' })}
            </p>
          </header>

          {mode === 'picker' && (
            <>
              <div className="transfer-ownership__section-eyebrow">
                <span>{intl.formatMessage({ id: 'manage.transfer_section_team' })}</span>
              </div>

              {members.length === 0 ? (
                <div className="transfer-ownership__no-team">
                  {intl.formatMessage({ id: 'manage.transfer_no_team' })}
                </div>
              ) : (
                <ul className="transfer-ownership__members">
                  {members.map((m) => {
                    const isActive = m.status === 'active'
                    const isSelected = selectedEmail === m.email
                    return (
                      <li key={m.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedEmail(m.email)}
                          disabled={!isActive}
                          className={
                            'transfer-ownership__member' + (isSelected ? ' is-active' : '')
                          }
                        >
                          <span className="transfer-ownership__member-avatar">
                            {m.avatar ? (
                              <img src={m.avatar} alt="" />
                            ) : (
                              getUserInitials(m.name)
                            )}
                          </span>
                          <span className="transfer-ownership__member-meta">
                            <span className="transfer-ownership__member-name">{m.name}</span>
                            <span className="transfer-ownership__member-email">{m.email}</span>
                          </span>
                          <span
                            className={
                              'transfer-ownership__member-tag ' +
                              (isActive
                                ? 'transfer-ownership__member-tag--active'
                                : 'transfer-ownership__member-tag--disabled')
                            }
                          >
                            {isActive
                              ? intl.formatMessage({ id: 'team.status_active' })
                              : intl.formatMessage({ id: 'team.status_disabled' })}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}

              <div className="transfer-ownership__section-eyebrow">
                <span>{intl.formatMessage({ id: 'manage.transfer_section_email' })}</span>
              </div>

              <button
                type="button"
                className="transfer-ownership__switch"
                onClick={() => { setMode('email'); setSelectedEmail(null) }}
              >
                <Mail />
                {intl.formatMessage({ id: 'manage.transfer_switch_to_email' })}
              </button>
            </>
          )}

          {mode === 'email' && (
            <div className="transfer-ownership__custom">
              <AuthField
                label={intl.formatMessage({ id: 'manage.transfer_member_email_label' })}
                type="email"
                value={customEmail}
                onChange={(e) => setCustomEmail(e.target.value)}
                placeholder="email@example.com"
                autoComplete="email"
                autoCapitalize="off"
                spellCheck={false}
              />
              <div className="manage-edit__note">
                {intl.formatMessage({ id: 'manage.transfer_recipient_must_have_account' })}
              </div>
              <button
                type="button"
                className="transfer-ownership__custom-back"
                onClick={() => { setMode('picker'); setCustomEmail('') }}
              >
                {intl.formatMessage({ id: 'manage.transfer_switch_to_picker' })}
              </button>
            </div>
          )}
        </>
      )}

      {/* ===== Step 1: confirm — the deed plate ===== */}
      {step === 'confirm' && (
        <>
          {error && <div className="modal-error">{error}</div>}

          <header className="modal-hero transfer-ownership__hero">
            <div className="modal-hero__eyebrow">
              {intl.formatMessage({ id: 'manage.transfer_confirm_eyebrow' })}
            </div>
            <h1 className="modal-hero__title">{titleNode}</h1>
          </header>

          <div className="transfer-ownership__deed">
            <div className="transfer-ownership__deed-eyebrow">
              <span>{intl.formatMessage({ id: 'manage.transfer_ownership' })}</span>
              <span className="transfer-ownership__deed-eyebrow-tag">
                {intl.formatMessage({ id: 'manage.transfer_confirm_status_tag' })}
              </span>
            </div>

            <p className="transfer-ownership__deed-business">{business?.name ?? ''}</p>

            <div className="transfer-ownership__deed-row">
              <div className="transfer-ownership__deed-cell">
                <span className="transfer-ownership__deed-eyebrow-mini">
                  {intl.formatMessage({ id: 'manage.transfer_confirm_from' })}
                </span>
                <span className="transfer-ownership__deed-avatar">
                  {user?.avatar ? (
                    <img src={user.avatar} alt="" />
                  ) : (
                    getUserInitials(user?.name ?? '')
                  )}
                </span>
                <span className="transfer-ownership__deed-name">{user?.name ?? ''}</span>
                <span className="transfer-ownership__deed-email">{user?.email ?? ''}</span>
              </div>

              <div className="transfer-ownership__deed-arrow" aria-hidden="true">
                <svg viewBox="0 0 26 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <line x1="0" y1="7" x2="22" y2="7" stroke="currentColor" strokeWidth="1.4" />
                  <polyline
                    points="17 2, 24 7, 17 12"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>

              <div className="transfer-ownership__deed-cell">
                <span className="transfer-ownership__deed-eyebrow-mini">
                  {intl.formatMessage({ id: 'manage.transfer_confirm_to' })}
                </span>
                <span className="transfer-ownership__deed-avatar">
                  {recipient?.avatar ? (
                    <img src={recipient.avatar} alt="" />
                  ) : (
                    getUserInitials(recipientLabel || (recipientEmail ?? ''))
                  )}
                </span>
                <span className="transfer-ownership__deed-name">
                  {recipient?.name ?? recipientEmail ?? ''}
                </span>
                <span className="transfer-ownership__deed-email">
                  {recipientEmail ?? ''}
                </span>
              </div>
            </div>
          </div>

          <div className="transfer-ownership__confirm-target">
            <span className="transfer-ownership__confirm-target-eyebrow">
              {intl.formatMessage({ id: 'manage.transfer_confirm_target_eyebrow' })}
            </span>
            <span className="transfer-ownership__confirm-target-value">
              {business?.name ?? ''}
            </span>
          </div>

          <AuthField
            label={intl.formatMessage(
              { id: 'manage.transfer_type_to_confirm' },
              { businessName: business?.name ?? '' },
            )}
            type="text"
            value={typedConfirm}
            onChange={(e) => setTypedConfirm(e.target.value)}
            placeholder={business?.name ?? ''}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />

          <div
            className={
              'transfer-ownership__check' + (isStep2Valid ? ' is-met' : '')
            }
          >
            <span className="transfer-ownership__check-marker" aria-hidden="true">
              <Check />
            </span>
            {intl.formatMessage({ id: 'manage.transfer_confirm_check' })}
          </div>
        </>
      )}

      {/* ===== Step 2: success — plane Lottie ===== */}
      {step === 'success' && (
        <ConfirmationAnimation
          type="success"
          src="/animations/plane.json"
          triggered={transferSent}
          title={intl.formatMessage({ id: 'manage.transfer_sent_heading' })}
          subtitle={intl.formatMessage(
            { id: 'manage.transfer_sent_subtitle' },
            { recipient: recipientLabel },
          )}
        />
      )}
    </ModalShell>
  )
}
