'use client'

import { useIntl } from 'react-intl'
import { useMemo } from 'react'
import { IonButton } from '@ionic/react'
// Deep import (not the '@/components/ui' barrel): this modal sits in the
// always-loaded entry graph via AuthGateProvider, and the barrel would
// drag TabContainer -> framer-motion into the entry chunk.
import { ModalShell } from '@/components/ui/modal-shell'

interface LogoutConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
}

/**
 * Confirmation shown before the logout splash choreography begins.
 * Stateless — every render is derived from props and i18n, so no
 * onExitComplete cleanup is needed. noSwipeDismiss is set so the
 * user has to make a deliberate Cancel/Confirm choice (matching
 * LeaveBusinessModal); the X and backdrop still close the modal.
 * The hero header (eyebrow + italicized title + subtitle) follows
 * the same pattern as LeaveBusinessModal and AccountPage.
 */
export function LogoutConfirmModal({
  isOpen,
  onClose,
  onConfirm,
}: LogoutConfirmModalProps) {
  const intl = useIntl()

  const titleNode = useMemo(() => {
    const full = intl.formatMessage({ id: 'auth.logout_confirm.hero_title' })
    const emphasis = intl.formatMessage({ id: 'auth.logout_confirm.hero_title_emphasis' })
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

  const footer = (
    <>
      <IonButton fill="outline" onClick={onClose}>
        {intl.formatMessage({ id: 'auth.logout_confirm.cancel' })}
      </IonButton>
      <IonButton color="danger" onClick={onConfirm} data-haptic>
        {intl.formatMessage({ id: 'auth.logout_confirm.action' })}
      </IonButton>
    </>
  )

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={intl.formatMessage({ id: 'auth.logout_confirm.title' })}
      footer={footer}
      noSwipeDismiss
    >
      <header className="modal-hero">
        <div className="modal-hero__eyebrow">
          {intl.formatMessage({ id: 'auth.logout_confirm.eyebrow' })}
        </div>
        <h1 className="modal-hero__title">{titleNode}</h1>
        <p className="modal-hero__subtitle">
          {intl.formatMessage({ id: 'auth.logout_confirm.subtitle' })}
        </p>
      </header>
    </ModalShell>
  )
}
