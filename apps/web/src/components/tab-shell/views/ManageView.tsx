'use client'

import { useIntl } from 'react-intl'
import { useMemo, useState } from 'react'
import { IonItem, IonLabel, IonList, IonNote } from '@ionic/react'
import dynamic from '@/lib/next-dynamic-shim'
import {
  Building2,
  MapPin,
  Users,
  Handshake,
  ArrowRightLeft,
  LogOut,
  Trash2,
  ChevronRight,
  Clock,
  ImageIcon,
} from 'lucide-react'
import { useBusiness } from '@/contexts/business-context'
import { usePageTransition } from '@/contexts/page-transition-context'
import { usePendingTransferContext } from '@/contexts/pending-transfer-context'
import { useIncomingTransferContext } from '@/contexts/incoming-transfer-context'
import { FeatureCard, GroupLabel } from '@/components/ui'
import {
  getBusinessInitials,
  pickBusinessMarkColor,
} from '@/lib/business-mark'

// Every modal below is closed by default; dynamic imports keep the modal
// code out of the initial manage-page chunk until the user opens one.
const EditNameModal = dynamic(
  () => import('@/components/manage/EditNameModal').then(m => m.EditNameModal),
  { ssr: false },
)
const EditLocationModal = dynamic(
  () => import('@/components/manage/EditLocationModal').then(m => m.EditLocationModal),
  { ssr: false },
)
const EditLogoModal = dynamic(
  () => import('@/components/manage/EditLogoModal').then(m => m.EditLogoModal),
  { ssr: false },
)
const TransferOwnershipModal = dynamic(
  () => import('@/components/manage/TransferOwnershipModal').then(m => m.TransferOwnershipModal),
  { ssr: false },
)
const CancelTransferModal = dynamic(
  () => import('@/components/manage/CancelTransferModal').then(m => m.CancelTransferModal),
  { ssr: false },
)
const LeaveBusinessModal = dynamic(
  () => import('@/components/manage/LeaveBusinessModal').then(m => m.LeaveBusinessModal),
  { ssr: false },
)
const DeleteBusinessModal = dynamic(
  () => import('@/components/manage/DeleteBusinessModal').then(m => m.DeleteBusinessModal),
  { ssr: false },
)
const IncomingTransferModal = dynamic(
  () => import('@/components/transfer/IncomingTransferModal').then(m => m.IncomingTransferModal),
  { ssr: false },
)

export function ManageView() {
  const intl = useIntl()
  const { business, businessId, isOwner } = useBusiness()
  const { navigate } = usePageTransition()
  const { transfer: pendingTransfer } = usePendingTransferContext()
  const { transfer: incomingTransfer } = useIncomingTransferContext()

  const [nameOpen, setNameOpen] = useState(false)
  const [locationOpen, setLocationOpen] = useState(false)
  const [logoOpen, setLogoOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [cancelTransferOpen, setCancelTransferOpen] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [incomingTransferOpen, setIncomingTransferOpen] = useState(false)

  // Page-hero title with one italic-terracotta accent word. Same pattern
  // as Account / Hub / Login. Falls back to plain text if the locale's
  // emphasis term doesn't substring-match the title.
  const titleNode = useMemo(() => {
    const full = intl.formatMessage({ id: 'manage.page_title' })
    const emphasis = intl.formatMessage({ id: 'manage.page_title_emphasis' })
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

  // Only show the incoming-transfer banner on the Manage page of the
  // target business. On any other business's Manage page the banner is
  // irrelevant (the transfer doesn't concern this business).
  const showIncomingTransferBanner =
    Boolean(incomingTransfer) &&
    incomingTransfer?.business.id === businessId

  if (!business || !businessId) return null

  const slideTo = (href: string) => navigate(href)

  const localeLabel = `${business.locale} · ${business.currency}`

  return (
    <>
      <div className="manage-body">
        <header className="page-hero">
          <div className="page-hero__eyebrow">
            {intl.formatMessage({ id: 'manage.page_eyebrow' })}
          </div>
          <h1 className="page-hero__title">{titleNode}</h1>
        </header>

        {/* Business identity card — the "you are here" plate above the
            settings sections. Mark + Fraunces name + mono pill row. */}
        <div className="manage-hero">
          <span
            className="manage-hero__mark"
            style={{ background: pickBusinessMarkColor(business.id) }}
          >
            {business.icon && business.icon.startsWith('data:') ? (
              <img src={business.icon} alt="" />
            ) : business.icon ? (
              <span className="manage-hero__mark-emoji">{business.icon}</span>
            ) : (
              <span>{getBusinessInitials(business.name)}</span>
            )}
          </span>
          <span className="manage-hero__body">
            <span className="manage-hero__name">{business.name}</span>
            <span className="manage-hero__pills">
              <span className="manage-pill">{localeLabel}</span>
            </span>
          </span>
        </div>

        {isOwner && pendingTransfer && (
          <button
            type="button"
            className="manage-banner"
            onClick={() => setCancelTransferOpen(true)}
          >
            <span className="manage-banner__icon">
              <Clock />
            </span>
            <span className="manage-banner__body">
              <span className="manage-banner__title">
                {intl.formatMessage({ id: 'manage.transfer_pending_heading' })}
              </span>
              <span className="manage-banner__desc">
                {intl.formatMessage(
                  { id: 'manage.transfer_pending_waiting' },
                  { recipient: pendingTransfer.toEmail },
                )}
              </span>
            </span>
            <span className="manage-banner__chev" aria-hidden="true">
              <ChevronRight />
            </span>
          </button>
        )}

        {showIncomingTransferBanner && incomingTransfer && (
          <button
            type="button"
            className="manage-banner"
            onClick={() => setIncomingTransferOpen(true)}
          >
            <span className="manage-banner__icon">
              <ArrowRightLeft />
            </span>
            <span className="manage-banner__body">
              <span className="manage-banner__title">
                {intl.formatMessage({ id: 'account.incoming_transfer_heading' })}
              </span>
              <span className="manage-banner__desc">
                {incomingTransfer.fromUser
                  ? intl.formatMessage(
                      { id: 'account.incoming_transfer_description' },
                      {
                        name: incomingTransfer.fromUser.name,
                        business: incomingTransfer.business.name,
                      },
                    )
                  : intl.formatMessage(
                      { id: 'account.incoming_transfer_description_anonymous' },
                      { business: incomingTransfer.business.name },
                    )}
              </span>
            </span>
            <span className="manage-banner__chev" aria-hidden="true">
              <ChevronRight />
            </span>
          </button>
        )}

        <GroupLabel>
          {intl.formatMessage({ id: 'manage.section_business' })}
        </GroupLabel>
        <IonList inset lines="full" className="account-list">
          <IonItem
            button={isOwner}
            detail={isOwner}
            onClick={isOwner ? () => setLogoOpen(true) : undefined}
          >
            <ImageIcon slot="start" className="text-text-secondary w-5 h-5" />
            <IonLabel>
              <h3>{intl.formatMessage({ id: 'manage.row_logo' })}</h3>
            </IonLabel>
          </IonItem>
          <IonItem
            button={isOwner}
            detail={isOwner}
            onClick={isOwner ? () => setNameOpen(true) : undefined}
          >
            <Building2 slot="start" className="text-text-secondary w-5 h-5" />
            <IonLabel>
              <h3>{intl.formatMessage({ id: 'manage.row_name' })}</h3>
            </IonLabel>
            <IonNote slot="end">{business.name}</IonNote>
          </IonItem>
          <IonItem
            button={isOwner}
            detail={isOwner}
            onClick={isOwner ? () => setLocationOpen(true) : undefined}
          >
            <MapPin slot="start" className="text-text-secondary w-5 h-5" />
            <IonLabel>
              <h3>{intl.formatMessage({ id: 'manage.row_location' })}</h3>
            </IonLabel>
            <IonNote slot="end">{localeLabel}</IonNote>
          </IonItem>
        </IonList>

        <GroupLabel>
          {intl.formatMessage({ id: 'manage.section_workspace' })}
        </GroupLabel>
        <div className="manage-workspace">
          <FeatureCard
            kicker={
              <span className="inline-flex items-center gap-1.5">
                <Users style={{ width: 12, height: 12 }} />
                {intl.formatMessage({ id: 'manage.shortcut_team' })}
              </span>
            }
            title={intl.formatMessage({ id: 'manage.shortcut_team' })}
            description={intl.formatMessage({ id: 'manage.shortcut_team_desc' })}
            onClick={() => slideTo(`/${businessId}/team`)}
          />
          <FeatureCard
            kicker={
              <span className="inline-flex items-center gap-1.5">
                <Handshake style={{ width: 12, height: 12 }} />
                {intl.formatMessage({ id: 'manage.shortcut_providers' })}
              </span>
            }
            title={intl.formatMessage({ id: 'manage.shortcut_providers' })}
            description={intl.formatMessage({ id: 'manage.shortcut_providers_desc' })}
            onClick={() => slideTo(`/${businessId}/providers`)}
          />
        </div>

        <GroupLabel tone="danger">
          {intl.formatMessage({ id: 'manage.section_danger' })}
        </GroupLabel>
        <IonList inset lines="full" className="account-list account-list--danger">
          {!isOwner && (
            <IonItem button detail onClick={() => setLeaveOpen(true)}>
              <LogOut slot="start" className="text-error w-5 h-5" />
              <IonLabel color="danger">
                <h3>{intl.formatMessage({ id: 'manage.leave_business' })}</h3>
              </IonLabel>
            </IonItem>
          )}
          {isOwner && (
            <>
              <IonItem
                button
                detail
                disabled={Boolean(pendingTransfer)}
                onClick={() => setTransferOpen(true)}
              >
                <ArrowRightLeft slot="start" className="text-error w-5 h-5" />
                <IonLabel color="danger">
                  <h3>{intl.formatMessage({ id: 'manage.transfer_ownership' })}</h3>
                </IonLabel>
              </IonItem>
              <IonItem button detail onClick={() => setDeleteOpen(true)}>
                <Trash2 slot="start" className="text-error w-5 h-5" />
                <IonLabel color="danger">
                  <h3>{intl.formatMessage({ id: 'manage.delete_business' })}</h3>
                </IonLabel>
              </IonItem>
            </>
          )}
        </IonList>
      </div>

      <EditNameModal isOpen={nameOpen} onClose={() => setNameOpen(false)} />
      <EditLocationModal isOpen={locationOpen} onClose={() => setLocationOpen(false)} />
      <EditLogoModal isOpen={logoOpen} onClose={() => setLogoOpen(false)} />
      <TransferOwnershipModal isOpen={transferOpen} onClose={() => setTransferOpen(false)} />
      <CancelTransferModal isOpen={cancelTransferOpen} onClose={() => setCancelTransferOpen(false)} />
      <LeaveBusinessModal isOpen={leaveOpen} onClose={() => setLeaveOpen(false)} />
      <DeleteBusinessModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} />
      <IncomingTransferModal
        isOpen={incomingTransferOpen}
        onClose={() => setIncomingTransferOpen(false)}
      />
    </>
  )
}
