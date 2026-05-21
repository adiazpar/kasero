'use client'

import { useIntl } from 'react-intl'
import { useMemo, useState } from 'react'
import {
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonSpinner,
} from '@ionic/react'
import dynamic from '@/lib/next-dynamic-shim'
import { useRouter } from '@/lib/next-navigation-shim'
import {
  Palette,
  Info,
  UserX,
  ChevronRight,
  LogOut,
  ArrowRightLeft,
  Mail,
  MonitorSmartphone,
} from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import { useAuthGate } from '@/contexts/auth-gate-context'
import { useIncomingTransferContext } from '@/contexts/incoming-transfer-context'
import { useTheme } from '@/hooks/useTheme'
import { GroupLabel, UserAvatar } from '@/components/ui'
import { LanguageRow } from '@/components/account/LanguageRow'

// Every modal on this page is closed by default and only needed on user
// action. Dynamic import with `ssr: false` keeps the modal code (plus
// framer-motion transitively via the Modal compound) out of the initial
// account-page chunk.
const ThemeModal = dynamic(
  () => import('@/components/account/ThemeModal').then(m => m.ThemeModal),
  { ssr: false },
)
const EditProfileModal = dynamic(
  () => import('@/components/account/EditProfileModal').then(m => m.EditProfileModal),
  { ssr: false },
)
const AboutModal = dynamic(
  () => import('@/components/account/AboutModal').then(m => m.AboutModal),
  { ssr: false },
)
const DeleteAccountModal = dynamic(
  () => import('@/components/account/DeleteAccountModal').then(m => m.DeleteAccountModal),
  { ssr: false },
)
const ChangeEmailModal = dynamic(
  () => import('@/components/account/ChangeEmailModal').then(m => m.ChangeEmailModal),
  { ssr: false },
)
const IncomingTransferModal = dynamic(
  () => import('@/components/transfer/IncomingTransferModal').then(m => m.IncomingTransferModal),
  { ssr: false },
)

/**
 * Body of the Account page. The Ionic chrome (header + back button) is
 * provided by the route-level wrapper at `apps/web/src/routes/AccountPage.tsx`,
 * so this component renders ONLY the scrollable settings body.
 */
export function AccountPageContent() {
  const { user, isLoading } = useAuth()
  const { requestLogout } = useAuthGate()
  const router = useRouter()
  const intl = useIntl()
  const { theme } = useTheme()
  const [isThemeModalOpen, setIsThemeModalOpen] = useState(false)
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false)
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [isChangeEmailModalOpen, setIsChangeEmailModalOpen] = useState(false)
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false)
  const { transfer: incomingTransfer } = useIncomingTransferContext()

  // Page title with italic accent on a single word — same pattern as
  // login / register / hub. Locale-aware via the *_emphasis key.
  const titleNode = useMemo(() => {
    const full = intl.formatMessage({ id: 'account.page_title' })
    const emphasis = intl.formatMessage({ id: 'account.page_title_emphasis' })
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

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <IonSpinner name="crescent" />
      </div>
    )
  }

  if (!user) {
    router.push('/')
    return null
  }

  const themeLabel = intl.formatMessage({ id: `account.theme_${theme}` })

  const handleLogout = () => {
    requestLogout('/')
  }

  return (
    <>
      <div className="account-body">
        <header className="page-hero">
          <div className="page-hero__eyebrow">
            {intl.formatMessage({ id: 'account.page_eyebrow' })}
          </div>
          <h1 className="page-hero__title">{titleNode}</h1>
        </header>

        {/* Profile card — terracotta avatar, name + email, edit affordance */}
        <button
          type="button"
          className="account-card"
          onClick={() => setIsProfileModalOpen(true)}
        >
          <span className="account-card__avatar">
            {user.avatar ? (
              <img src={user.avatar} alt="" />
            ) : (
              <UserAvatar name={user.name} size="lg" />
            )}
          </span>
          <span className="account-card__who">
            <span className="account-card__name">{user.name}</span>
            <span className="account-card__email">{user.email}</span>
          </span>
          <span className="account-card__edit" aria-hidden="true">
            <ChevronRight />
          </span>
        </button>

        {/* Incoming transfer banner */}
        {incomingTransfer && (
          <button
            type="button"
            className="incoming-transfer"
            onClick={() => setIsTransferModalOpen(true)}
          >
            <span className="incoming-transfer__icon">
              <ArrowRightLeft />
            </span>
            <span className="incoming-transfer__body">
              <span className="incoming-transfer__title">
                {intl.formatMessage({ id: 'account.incoming_transfer_heading' })}
              </span>
              <span className="incoming-transfer__desc">
                {incomingTransfer.fromUser
                  ? intl.formatMessage(
                      { id: 'account.incoming_transfer_description' },
                      {
                        name: incomingTransfer.fromUser.name,
                        business: incomingTransfer.business.name,
                      }
                    )
                  : intl.formatMessage(
                      { id: 'account.incoming_transfer_description_anonymous' },
                      { business: incomingTransfer.business.name }
                    )}
              </span>
            </span>
            <span className="incoming-transfer__chev" aria-hidden="true">
              <ChevronRight />
            </span>
          </button>
        )}

        <GroupLabel>
          {intl.formatMessage({ id: 'account.section_account' })}
        </GroupLabel>
        <IonList inset lines="full" className="account-list">
          <IonItem button detail onClick={() => setIsChangeEmailModalOpen(true)}>
            <Mail slot="start" className="text-text-secondary w-5 h-5" />
            <IonLabel>
              <h3>{intl.formatMessage({ id: 'account.row_change_email' })}</h3>
              <p className="account-list__email-value">{user.email}</p>
            </IonLabel>
          </IonItem>
          <IonItem button detail routerLink="/account/sessions" routerDirection="forward">
            <MonitorSmartphone slot="start" className="text-text-secondary w-5 h-5" />
            <IonLabel>
              <h3>{intl.formatMessage({ id: 'account.row_sessions' })}</h3>
            </IonLabel>
          </IonItem>
        </IonList>

        <GroupLabel>
          {intl.formatMessage({ id: 'account.section_preferences' })}
        </GroupLabel>
        <IonList inset lines="full" className="account-list">
          <IonItem button detail onClick={() => setIsThemeModalOpen(true)}>
            <Palette slot="start" className="text-text-secondary w-5 h-5" />
            <IonLabel>
              <h3>{intl.formatMessage({ id: 'account.row_theme' })}</h3>
            </IonLabel>
            <IonNote slot="end">{themeLabel}</IonNote>
          </IonItem>
          <LanguageRow />
        </IonList>

        <GroupLabel>
          {intl.formatMessage({ id: 'account.section_support' })}
        </GroupLabel>
        <IonList inset lines="full" className="account-list">
          <IonItem button detail onClick={() => setIsAboutModalOpen(true)}>
            <Info slot="start" className="text-text-secondary w-5 h-5" />
            <IonLabel>
              <h3>{intl.formatMessage({ id: 'account.row_about' })}</h3>
            </IonLabel>
          </IonItem>
        </IonList>

        <GroupLabel tone="danger">
          {intl.formatMessage({ id: 'account.section_danger_zone' })}
        </GroupLabel>
        <IonList inset lines="full" className="account-list account-list--danger">
          <IonItem button detail onClick={handleLogout}>
            <LogOut slot="start" className="text-error w-5 h-5" />
            <IonLabel color="danger">
              <h3>{intl.formatMessage({ id: 'account.row_logout' })}</h3>
            </IonLabel>
          </IonItem>
          <IonItem button detail onClick={() => setIsDeleteModalOpen(true)}>
            <UserX slot="start" className="text-error w-5 h-5" />
            <IonLabel color="danger">
              <h3>{intl.formatMessage({ id: 'account.row_delete_account' })}</h3>
            </IonLabel>
          </IonItem>
        </IonList>
      </div>

      <ThemeModal
        isOpen={isThemeModalOpen}
        onClose={() => setIsThemeModalOpen(false)}
      />
      <EditProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
      />
      <AboutModal
        isOpen={isAboutModalOpen}
        onClose={() => setIsAboutModalOpen(false)}
      />
      <DeleteAccountModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
      />
      <ChangeEmailModal
        isOpen={isChangeEmailModalOpen}
        onClose={() => setIsChangeEmailModalOpen(false)}
      />
      <IncomingTransferModal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
      />
    </>
  )
}
