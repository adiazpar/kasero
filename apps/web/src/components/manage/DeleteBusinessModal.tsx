'use client'

import { useIntl } from 'react-intl'
import { useEffect, useMemo, useState } from 'react'
import { AlertOctagon, Check } from 'lucide-react'
import { IonButton, IonSpinner } from '@ionic/react'
import { ModalShell } from '@/components/ui'
import { AuthField } from '@/components/auth'
import { LottiePlayerDynamic as LottiePlayer } from '@/components/animations'
import { useBusiness } from '@/contexts/business-context'
import { useDeleteBusiness } from '@/hooks/useDeleteBusiness'
import { useGoBackTo } from '@/hooks'

interface Props { isOpen: boolean; onClose: () => void }

type Stage = 'form' | 'success'

// Hold the success step long enough for the trash Lottie to play through
// before we pop back to the hub. Matches DeleteAccountModal's beat.
const SUCCESS_DISPLAY_MS = 2400

/**
 * DeleteBusinessModal — most permanent action in the manage tab. Mirrors
 * DeleteAccountModal's friction pattern:
 *   - Oxblood hero with italic "*certain*" emphasis
 *   - "WHAT YOU'LL LOSE" warning list (every member, every product, …)
 *   - TYPE TO CONFIRM block with the business name as the target string
 *     in mono — copy-resistant and the user must read it
 *   - Live READY CHECK list lights up moss when the name matches
 *   - Single oxblood "Delete forever" primary
 */
export function DeleteBusinessModal({ isOpen, onClose }: Props) {
  const intl = useIntl()
  const goBackTo = useGoBackTo()
  const { business } = useBusiness()
  const { deleteBusiness, isSubmitting, error } = useDeleteBusiness()
  const [typed, setTyped] = useState('')
  const [stage, setStage] = useState<Stage>('form')
  const [deleted, setDeleted] = useState(false)

  // Reset state after the dismissal animation plays so the contents
  // don't flash back into view while the modal slides away.
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setTyped('')
        setStage('form')
        setDeleted(false)
      }, 250)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  const nameMatches = !!business && typed === business.name
  const canDelete = nameMatches && !isSubmitting

  const handleDelete = async () => {
    if (!canDelete) return
    const ok = await deleteBusiness()
    if (!ok) return
    // Move to the success stage so the trash Lottie plays; the modal
    // owns the navigation timing so users get a visible confirmation
    // beat before the business stack pops back to the hub. Mirrors
    // DeleteAccountModal's flow.
    setStage('success')
    setDeleted(true)
    window.setTimeout(() => {
      onClose()
      goBackTo('/')
    }, SUCCESS_DISPLAY_MS)
  }

  const titleNode = useMemo(() => {
    const full = intl.formatMessage({ id: 'manage.delete_business_hero_title' })
    const emphasis = intl.formatMessage({ id: 'manage.delete_business_hero_title_emphasis' })
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

  const lossItems = [
    intl.formatMessage({ id: 'manage.delete_business_warning_team' }),
    intl.formatMessage({ id: 'manage.delete_business_warning_products' }),
    intl.formatMessage({ id: 'manage.delete_business_warning_orders' }),
    intl.formatMessage({ id: 'manage.delete_business_warning_sales' }),
    intl.formatMessage({ id: 'manage.delete_business_warning_irreversible' }),
  ]

  const checks = [
    {
      key: 'name',
      label: intl.formatMessage({ id: 'manage.delete_business_check_name' }),
      met: nameMatches,
    },
  ]

  const footer = stage === 'success' ? undefined : (
    <IonButton
      color="danger"
      expand="block"
      onClick={handleDelete}
      disabled={!canDelete}
      data-haptic
    >
      {isSubmitting
        ? <IonSpinner name="crescent" />
        : intl.formatMessage({ id: 'manage.delete_business_button_long' })}
    </IonButton>
  )

  if (stage === 'success') {
    return (
      <ModalShell
        isOpen={isOpen}
        onClose={onClose}
        title=""
        footer={footer}
        noSwipeDismiss
      >
        <div className="delete-business__success">
          <div style={{ width: 160, height: 160 }}>
            {deleted && (
              <LottiePlayer
                src="/animations/trash.json"
                loop={false}
                autoplay={true}
                delay={120}
                style={{ width: 160, height: 160 }}
              />
            )}
          </div>
          <p className="delete-business__success-heading">
            {intl.formatMessage(
              { id: 'manage.delete_business_success_heading' },
              {
                em: (chunks) => (
                  <em className="delete-business__success-heading-em">{chunks}</em>
                ),
              },
            )}
          </p>
          <p className="delete-business__success-desc">
            {intl.formatMessage({ id: 'manage.delete_business_success_desc' })}
          </p>
        </div>
      </ModalShell>
    )
  }

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={intl.formatMessage({ id: 'manage.delete_business' })}
      footer={footer}
      noSwipeDismiss
    >
      {error && <div className="modal-error">{error}</div>}

      <header className="modal-hero delete-business__hero">
        <div className="modal-hero__eyebrow modal-hero__eyebrow--danger">
          <AlertOctagon size={12} />
          {intl.formatMessage({ id: 'manage.delete_business_eyebrow' })}
        </div>
        <h1 className="modal-hero__title modal-hero__title--danger">{titleNode}</h1>
        <p className="modal-hero__subtitle">
          {intl.formatMessage({ id: 'manage.delete_business_hero_subtitle' })}
        </p>
      </header>

      <div className="delete-business__warning">
        <div className="delete-business__warning-eyebrow">
          <AlertOctagon />
          {intl.formatMessage({ id: 'manage.delete_business_warning_eyebrow' })}
        </div>
        <ul className="delete-business__warning-list">
          {lossItems.map((label, i) => (
            <li key={i} className="delete-business__warning-item">{label}</li>
          ))}
        </ul>
      </div>

      <div className="delete-business__target">
        <span className="delete-business__target-eyebrow">
          {intl.formatMessage({ id: 'manage.delete_business_target_eyebrow' })}
        </span>
        <span className="delete-business__target-value">{business?.name ?? ''}</span>
      </div>

      <div className="delete-business__form">
        <AuthField
          label={intl.formatMessage({ id: 'manage.delete_business_confirm_label' })}
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={business?.name ?? ''}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          required
        />
      </div>

      <div className="delete-business__checks">
        <div className="delete-business__checks-eyebrow">
          {intl.formatMessage({ id: 'manage.delete_business_checks_eyebrow' })}
        </div>
        <ul className="delete-business__check-list">
          {checks.map((c) => (
            <li
              key={c.key}
              className={'delete-business__check' + (c.met ? ' is-met' : '')}
            >
              <span className="delete-business__check-marker" aria-hidden="true">
                <Check />
              </span>
              {c.label}
            </li>
          ))}
        </ul>
      </div>
    </ModalShell>
  )
}
