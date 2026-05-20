'use client'

import { useIntl } from 'react-intl';

import Image from '@/lib/Image'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from '@/lib/next-navigation-shim'
import type { ReactNode } from 'react'
import {
  IonButton,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonToggle,
} from '@ionic/react'
import { Plus, Phone, Mail, MessageCircle, Pencil, ChevronRight, Bell, ImagePlus, Trash2, User as UserIcon, Power, Inbox } from 'lucide-react'
import { TabContainer, ModalShell, PageSpinner, GroupLabel, SwipeRow } from '@/components/ui'
import { pickProviderMarkColor } from '@/lib/provider-mark'
import {
  EditProviderNameModal,
  EditProviderPhoneModal,
  EditProviderEmailModal,
  DeleteProviderModal,
  AddProviderNoteModal,
  EditProviderNoteModal,
  ReliabilityBar,
  getProviderInitials,
} from './'
import { OrderListItem } from '@/components/products'
import {
  computeProviderMetrics,
  computeTypicalItems,
  computeMonthlySpend,
} from '@/lib/provider-metrics'
import { useOrderFlows } from '@/hooks/useOrderFlows'
import { useOrders } from '@/contexts/orders-context'
import { useProviders } from '@/contexts/providers-context'
import { useProducts } from '@/contexts/products-context'
import { apiRequest, apiPost, apiPatch, apiDelete, ApiError } from '@/lib/api-client'
import { useApiMessage } from '@/hooks/useApiMessage'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'
import { useGoBackTo, useDetailEntityGuard } from '@/hooks'
import { useBusiness } from '@/contexts/business-context'
import { useDismissOnDelete } from '@/hooks/useDismissOnDelete'
import { useResyncOnUpdate } from '@/hooks/useResyncOnUpdate'
import { canManageBusiness } from '@kasero/shared/business-role'
import { formatRelative } from '@/lib/formatRelative'
import { getOrderDisplayStatus } from '@/lib/products'
import { getProductIconUrl } from '@/lib/utils'
import { isPresetIcon, getPresetIcon } from '@/lib/preset-icons'
import { MAX_PROVIDER_NOTES } from '@kasero/shared/provider-notes'
import type { Provider, Product, ProviderNote } from '@kasero/shared/types'

interface ProviderDetailResponse {
  success?: boolean
  provider: Provider
  [key: string]: unknown
}

export interface ProviderDetailClientProps {
  businessId: string
  providerId: string
}

/**
 * The wrapping `IonHeader` + `IonBackButton` inside `ProviderDetailPage`
 * provides the title and back affordance for this view. The route
 * component hoists the provider lookup
 * (`useProviders().providers.find(...)`) so the `IonTitle` can render
 * the provider name even before this component finishes its detail
 * fetch. `useRouter()` is retained because it still drives the tab
 * URL state (`router.replace`). The post-delete redirect uses
 * `useGoBackTo` so the IonRouterOutlet pops the dead detail page
 * instead of stacking the providers list on top of it.
 */

type DetailTab = 'summary' | 'history' | 'notes'

const DETAIL_TAB_IDS: readonly DetailTab[] = ['summary', 'history', 'notes'] as const

function isDetailTab(value: string | null): value is DetailTab {
  return (DETAIL_TAB_IDS as readonly string[]).includes(value ?? '')
}

export function ProviderDetailClient({ businessId, providerId }: ProviderDetailClientProps) {
  const router = useRouter()
  const goBackTo = useGoBackTo()
  const searchParams = useSearchParams()
  const intl = useIntl()
  const { formatCurrencyCompact } = useBusinessFormat()
  // Relative time ("3 days ago") is LANGUAGE, not formatting — use user UI
  // locale, not business locale, so an English UI doesn't show "hace 3 días".
  const userLocale = intl.locale
  const translateApiMessage = useApiMessage()
  const { role } = useBusiness()
  const canManage = canManageBusiness(role)

  // Tab state — initialized from the URL so browser back/forward and
  // router.back() restore the tab the user was on (mirrors the products
  // page pattern).
  const [activeTab, setActiveTab] = useState<DetailTab>(() => {
    const fromUrl = searchParams?.get('tab') ?? null
    return isDetailTab(fromUrl) ? fromUrl : 'summary'
  })

  const urlForTab = useCallback(
    (tab: DetailTab) => {
      const base = `/${businessId}/providers/${providerId}`
      return tab === 'summary' ? base : `${base}?tab=${tab}`
    },
    [businessId, providerId],
  )

  const handleTabChange = useCallback(
    (tab: DetailTab) => {
      setActiveTab(tab)
      router.replace(urlForTab(tab), { scroll: false })
    },
    [router, urlForTab],
  )

  const [provider, setProvider] = useState<Provider | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  const [isContactSheetOpen, setContactSheetOpen] = useState(false)

  // Per-field edit + delete modal state. We keep one shared isSaving /
  // editError pair because only one modal can be open at a time. Each
  // modal owns its own save-success flag locally so it can flip
  // atomically with its step transition — see EditProviderNameModal.
  const [isNameEditOpen, setNameEditOpen] = useState(false)
  const [isPhoneEditOpen, setPhoneEditOpen] = useState(false)
  const [isEmailEditOpen, setEmailEditOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [editError, setEditError] = useState('')

  // Inline Active toggle state — no modal. Optimistic flip with revert on
  // API failure; isTogglingActive locks the toggle while the PATCH is in
  // flight so a rapid double-tap doesn't race.
  const [isTogglingActive, setIsTogglingActive] = useState(false)
  const [activeError, setActiveError] = useState('')

  // Delete provider modal state.
  const [isDeleteOpen, setDeleteOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [providerDeleted, setProviderDeleted] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  // Notes state — one add modal and one edit/delete modal. Draft state
  // (title + body) is shared between them since only one is ever open at
  // a time; `editingNoteId` is the discriminator that also surfaces the
  // existing note for the confirm-delete copy and the hasChanges gate.
  const [isAddNoteOpen, setAddNoteOpen] = useState(false)
  const [isEditNoteOpen, setEditNoteOpen] = useState(false)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editNoteInitialStep, setEditNoteInitialStep] = useState<0 | 1>(0)
  const [noteTitle, setNoteTitle] = useState('')
  const [noteBody, setNoteBody] = useState('')
  const [isSavingNote, setIsSavingNote] = useState(false)
  const [noteSaved, setNoteSaved] = useState(false)
  const [noteError, setNoteError] = useState('')
  const [isDeletingNote, setIsDeletingNote] = useState(false)
  const [noteDeleted, setNoteDeleted] = useState(false)

  // Shared orders + providers + products stores. Orders whose providerId
  // changes elsewhere fall out of this page's derived list automatically;
  // the providers + products stores power the New Order / Order Detail
  // modal dropdowns and picker without any local fetch on this page.
  // Provider history shows every order ever placed with this provider, so
  // we load both buckets on mount. ensureXLoaded is idempotent — if either
  // bucket was already primed by the products page in this session, the
  // call is a no-op.
  const {
    orders: allOrders,
    setOrders,
    ensureActiveLoaded: ensureActiveOrdersLoaded,
    ensureCompletedLoaded: ensureCompletedOrdersLoaded,
  } = useOrders()
  const {
    providers: allProvidersAll,
    setProviders,
    ensureLoaded: ensureProvidersLoaded,
  } = useProviders()
  // Defense-in-depth: if the provider disappears from the shared context
  // for any reason other than this page's own delete flow, slide back to
  // the providers list instead of rendering stale data. Disabled during
  // our own delete-success animation (providerDeleted), since that path
  // owns the navigation via goBackTo in the modal's onExitComplete.
  useDetailEntityGuard(
    allProvidersAll.find(p => p.id === providerId),
    `/${businessId}/providers`,
    { enabled: !providerDeleted },
  )
  const { products, ensureLoaded: ensureProductsLoaded } = useProducts()
  const allProviders = useMemo(
    () => allProvidersAll.filter(p => p.active),
    [allProvidersAll],
  )
  const providerOrders = useMemo(
    () => allOrders.filter(o => o.providerId === providerId),
    [allOrders, providerId],
  )
  const metrics = useMemo(() => computeProviderMetrics(providerOrders), [providerOrders])

  // Count of orders currently in "overdue" display status — powers the
  // red banner at the top of the Summary tab.
  const overdueCount = useMemo(
    () => providerOrders.filter(o => getOrderDisplayStatus(o) === 'overdue').length,
    [providerOrders],
  )

  // ===== Wire up the shared order-flows hook =====
  const orderFlows = useOrderFlows({
    businessId,
    providers: allProviders,
    canDelete: canManage,
    canManage,
  })

  // ===== Load data =====
  // Only the provider detail is page-specific. Orders, providers list, and
  // products all come from shared contexts — we just ensure each is loaded
  // in parallel with the detail fetch.
  const loadAll = useCallback(async () => {
    try {
      setError('')
      const [detail] = await Promise.all([
        apiRequest<ProviderDetailResponse>(`/api/businesses/${businessId}/providers/${providerId}`),
        ensureActiveOrdersLoaded(),
        ensureCompletedOrdersLoaded(),
        ensureProvidersLoaded(),
        ensureProductsLoaded(),
      ])
      setProvider(detail.provider)
    } catch (err) {
      setError(
        err instanceof ApiError && err.envelope
          ? translateApiMessage(err.envelope)
          : intl.formatMessage({
          id: 'providers.error_failed_to_load'
        })
      )
    } finally {
      setIsLoading(false)
    }
  }, [businessId, providerId, ensureActiveOrdersLoaded, ensureCompletedOrdersLoaded, ensureProvidersLoaded, ensureProductsLoaded, intl, translateApiMessage])

  useEffect(() => { loadAll() }, [loadAll])

  // ===== Realtime: dismiss per-field modals when provider is deleted elsewhere =====
  // stableCloseAllEdits: stable identity via useCallback so the subscription
  // doesn't re-register on every render. Closes all per-field edit modals that
  // might be open when a remote delete arrives.
  const stableCloseAllEdits = useCallback(() => {
    setNameEditOpen(false)
    setPhoneEditOpen(false)
    setEmailEditOpen(false)
  }, [])
  useDismissOnDelete('provider', provider?.id ?? null, stableCloseAllEdits)

  // Resync local provider snapshot when a remote update arrives. By the time
  // this fires, the providers context has already been refetched by callRefetch
  // in the handler. Read the fresh provider from the shared list.
  const handleProviderResync = useCallback(() => {
    const fresh = allProvidersAll.find(p => p.id === providerId)
    if (fresh) setProvider(fresh)
  }, [allProvidersAll, providerId])
  useResyncOnUpdate('provider', provider?.id ?? null, handleProviderResync)

  // ===== Per-field edit =====
  // Generic single-field PATCH helper. Each per-field modal hands us
  // the new trimmed value; we shape the payload so empty strings clear
  // the field on the server (route accepts `null` for phone/email; name
  // requires a non-empty value enforced by the modal's canSave gate).
  // Updates local provider state + syncs the shared providers list so
  // the order-modal dropdowns on other pages see the new values.
  const patchProviderField = useCallback(
    async (
      payload: { name?: string } | { phone?: string | null } | { email?: string | null } | { active?: boolean },
    ): Promise<boolean> => {
      setIsSaving(true)
      setEditError('')
      try {
        const result = await apiPatch<{ success: true; provider: Provider }>(
          `/api/businesses/${businessId}/providers/${providerId}`,
          payload,
        )
        setProvider(result.provider)
        setProviders(prev => prev.map(p => (p.id === result.provider.id ? result.provider : p)))
        return true
      } catch (err) {
        setEditError(
          err instanceof ApiError && err.envelope
            ? translateApiMessage(err.envelope)
            : intl.formatMessage({ id: 'providers.error_failed_to_save' }),
        )
        return false
      } finally {
        setIsSaving(false)
      }
    },
    [businessId, providerId, setProviders, intl, translateApiMessage],
  )

  // Per-field handlers feeding each modal's onSubmit prop. Empty
  // phone/email strings collapse to null (server clears the column).
  const handleSaveName = useCallback(
    (next: string) => patchProviderField({ name: next }),
    [patchProviderField],
  )
  const handleSavePhone = useCallback(
    (next: string) => patchProviderField({ phone: next.length > 0 ? next : null }),
    [patchProviderField],
  )
  const handleSaveEmail = useCallback(
    (next: string) => patchProviderField({ email: next.length > 0 ? next : null }),
    [patchProviderField],
  )

  // Open helpers — clear shared state so a previous modal's error or
  // success flag doesn't bleed into this session.
  const openNameEdit = useCallback(() => {
    setEditError('')
    setNameEditOpen(true)
  }, [])
  const openPhoneEdit = useCallback(() => {
    setEditError('')
    setPhoneEditOpen(true)
  }, [])
  const openEmailEdit = useCallback(() => {
    setEditError('')
    setEmailEditOpen(true)
  }, [])

  // Inline Active toggle — optimistic flip, revert on failure.
  const handleToggleActive = useCallback(async () => {
    if (!provider || isTogglingActive) return
    const next = !provider.active
    const previous = provider
    setIsTogglingActive(true)
    setActiveError('')
    setProvider({ ...provider, active: next })
    try {
      const result = await apiPatch<{ success: true; provider: Provider }>(
        `/api/businesses/${businessId}/providers/${providerId}`,
        { active: next },
      )
      setProvider(result.provider)
      setProviders(prev => prev.map(p => (p.id === result.provider.id ? result.provider : p)))
    } catch (err) {
      // Revert the optimistic flip and surface the error inline.
      setProvider(previous)
      setActiveError(
        err instanceof ApiError && err.envelope
          ? translateApiMessage(err.envelope)
          : intl.formatMessage({ id: 'providers.error_failed_to_save' }),
      )
    } finally {
      setIsTogglingActive(false)
    }
  }, [businessId, providerId, provider, isTogglingActive, setProviders, intl, translateApiMessage])

  // Open the delete confirm modal.
  const openDelete = useCallback(() => {
    setDeleteError('')
    setProviderDeleted(false)
    setDeleteOpen(true)
  }, [])

  // ===== Notes =====
  // The list lives on `provider.notes` (seeded from the detail GET). Each
  // create/update/delete returns the full, already-sorted list so we can
  // replace it in one shot without re-sorting on the client.
  const notes = provider?.notes ?? []
  const notesCount = notes.length
  const atNotesLimit = notesCount >= MAX_PROVIDER_NOTES
  const editingNote = editingNoteId
    ? notes.find(n => n.id === editingNoteId) ?? null
    : null

  const applyNotesUpdate = useCallback((next: ProviderNote[]) => {
    setProvider(prev => (prev ? { ...prev, notes: next } : prev))
  }, [])

  const openAddNote = useCallback(() => {
    if (atNotesLimit) return
    setNoteTitle('')
    setNoteBody('')
    setNoteError('')
    setNoteSaved(false)
    setAddNoteOpen(true)
  }, [atNotesLimit])

  // Stable onExitComplete handlers — wrapped in useCallback so the modal's
  // delayed-cleanup effect doesn't see a fresh reference on every keystroke
  // (an inline lambda would make the cleanup-effect re-run + reschedule its
  // 250ms onExitComplete timer on every parent render, eventually firing
  // while the user is still mid-draft and wiping noteTitle/noteBody).
  const handleAddNoteExitComplete = useCallback(() => {
    setNoteTitle('')
    setNoteBody('')
    setNoteSaved(false)
    setNoteError('')
  }, [])
  const handleEditNoteExitComplete = useCallback(() => {
    setEditingNoteId(null)
    setNoteTitle('')
    setNoteBody('')
    setNoteSaved(false)
    setNoteDeleted(false)
    setNoteError('')
    setEditNoteInitialStep(0)
  }, [])

  const openEditNote = useCallback((note: ProviderNote) => {
    setEditingNoteId(note.id)
    setNoteTitle(note.title)
    setNoteBody(note.body)
    setNoteError('')
    setNoteSaved(false)
    setNoteDeleted(false)
    setEditNoteInitialStep(0)
    setEditNoteOpen(true)
  }, [])

  const openDeleteNote = useCallback((note: ProviderNote) => {
    setEditingNoteId(note.id)
    setNoteTitle(note.title)
    setNoteBody(note.body)
    setNoteError('')
    setNoteSaved(false)
    setNoteDeleted(false)
    setEditNoteInitialStep(1)
    setEditNoteOpen(true)
  }, [])

  const handleAddNote = useCallback(async (): Promise<boolean> => {
    setIsSavingNote(true)
    setNoteError('')
    try {
      const result = await apiPost<{ success: true; notes: ProviderNote[] }>(
        `/api/businesses/${businessId}/providers/${providerId}/notes`,
        { title: noteTitle.trim(), body: noteBody.trim() },
      )
      applyNotesUpdate(result.notes)
      setNoteSaved(true)
      return true
    } catch (err) {
      setNoteError(
        err instanceof ApiError && err.envelope
          ? translateApiMessage(err.envelope)
          : intl.formatMessage({
          id: 'providers.error_failed_to_save'
        })
      )
      return false
    } finally {
      setIsSavingNote(false)
    }
  }, [businessId, providerId, noteTitle, noteBody, applyNotesUpdate, intl, translateApiMessage])

  const handleUpdateNote = useCallback(async (): Promise<boolean> => {
    if (!editingNoteId) return false
    setIsSavingNote(true)
    setNoteError('')
    try {
      const result = await apiPatch<{ success: true; notes: ProviderNote[] }>(
        `/api/businesses/${businessId}/providers/${providerId}/notes/${editingNoteId}`,
        { title: noteTitle.trim(), body: noteBody.trim() },
      )
      applyNotesUpdate(result.notes)
      setNoteSaved(true)
      return true
    } catch (err) {
      setNoteError(
        err instanceof ApiError && err.envelope
          ? translateApiMessage(err.envelope)
          : intl.formatMessage({
          id: 'providers.error_failed_to_save'
        })
      )
      return false
    } finally {
      setIsSavingNote(false)
    }
  }, [businessId, providerId, editingNoteId, noteTitle, noteBody, applyNotesUpdate, intl, translateApiMessage])

  const handleDeleteNote = useCallback(async (): Promise<boolean> => {
    if (!editingNoteId) return false
    setIsDeletingNote(true)
    setNoteError('')
    try {
      const result = await apiDelete<{ success: true; notes: ProviderNote[] }>(
        `/api/businesses/${businessId}/providers/${providerId}/notes/${editingNoteId}`,
      )
      applyNotesUpdate(result.notes)
      setNoteDeleted(true)
      return true
    } catch (err) {
      setNoteError(
        err instanceof ApiError && err.envelope
          ? translateApiMessage(err.envelope)
          : intl.formatMessage({
          id: 'providers.error_failed_to_delete'
        })
      )
      return false
    } finally {
      setIsDeletingNote(false)
    }
  }, [businessId, providerId, editingNoteId, applyNotesUpdate, intl, translateApiMessage])

  // ===== Delete provider =====
  // Returns true on successful delete, which lets the modal navigate to the
  // delete-success step. The actual navigation back to the providers list
  // happens once the modal has fully closed — see onExitComplete below —
  // so the delete-success animation plays before the slide-back fires.
  const handleDelete = useCallback(async (): Promise<boolean> => {
    setIsDeleting(true)
    setDeleteError('')
    try {
      await apiDelete(`/api/businesses/${businessId}/providers/${providerId}`)
      // Detach the provider from every piece of client state so no UI
      // anywhere in the app keeps a dangling reference:
      //   - Remove it from the shared providers list (dropdowns, the
      //     /providers list page).
      //   - Null out providerId and drop the `provider` expansion on
      //     every order that referenced it (matches the backend, which
      //     already nulls orders.providerId on delete).
      setProviders(prev => prev.filter(p => p.id !== providerId))
      setOrders(prev =>
        prev.map(o => {
          if (o.providerId !== providerId) return o
          const nextExpand = o.expand ? { ...o.expand } : undefined
          if (nextExpand) delete nextExpand.provider
          return { ...o, providerId: null, expand: nextExpand }
        }),
      )
      setProviderDeleted(true)
      return true
    } catch (err) {
      setDeleteError(
        err instanceof ApiError && err.envelope
          ? translateApiMessage(err.envelope)
          : intl.formatMessage({
          id: 'providers.error_failed_to_delete'
        })
      )
      return false
    } finally {
      setIsDeleting(false)
    }
  }, [businessId, providerId, setOrders, setProviders, intl, translateApiMessage])

  // ===== Typical items =====
  // Hide the whole section until the provider has at least 3 orders —
  // anything less and the "what you habitually buy" narrative is noise.
  const typicalItems = useMemo(
    () => (providerOrders.length < 3 ? [] : computeTypicalItems(providerOrders)),
    [providerOrders],
  )
  // Look up the current product for each typical item so we can render
  // its icon. Items keyed by productName (product was deleted) fall
  // through to the default placeholder chip.
  const productsById = useMemo(() => {
    const map = new Map<string, Product>()
    for (const p of products) map.set(p.id, p)
    return map
  }, [products])

  // ===== Monthly spend =====
  // Fixed 6-month window ending at the current month. Shown whenever the
  // provider has at least one order; months with no orders render as stubs.
  const monthlySpend = useMemo(() => computeMonthlySpend(providerOrders), [providerOrders])
  const monthlySpendMax = useMemo(
    () => monthlySpend.reduce((max, b) => Math.max(max, b.total), 0),
    [monthlySpend],
  )

  if (isLoading) {
    return (
      <PageSpinner />
    );
  }

  if (error || !provider) {
    return (
      <div className="pd-error">
        {error || intl.formatMessage({
          id: 'providers.error_failed_to_load'
        })}
      </div>
    );
  }

  const initials = getProviderInitials(provider.name)
  const hasOrders = providerOrders.length > 0
  const markColor = pickProviderMarkColor(provider.id)
  const lifetimeSpend = formatCurrencyCompact(metrics.totalSpent)
  const sinceMonthYear = provider.createdAt
    ? formatMonthYear(provider.createdAt, userLocale)
    : null
  const phoneValue = provider.phone?.trim() ?? ''
  const emailValue = provider.email?.trim() ?? ''

  return (
    <>
      <div className="px-4 pt-3 pb-8">
        {/* ============== Editorial hero — display only ==============
            Mark + eyebrow ("PROVIDER · MEMBER SINCE NOV '24") +
            Fraunces name + meta line (status pill · order count ·
            lifetime spend). The hero is intentionally non-interactive;
            edit affordances live in the Details rows below. */}
        <div className="pd-hero">
          <span
            className="pv-mark pv-mark--lg"
            data-active={provider.active}
            style={provider.active ? { background: markColor } : undefined}
            aria-hidden="true"
          >
            {initials}
          </span>
          <div className="pd-hero__body">
            <div className="pd-hero__eyebrow">
              <span>{intl.formatMessage({ id: 'providers.detail_eyebrow' })}</span>
              {sinceMonthYear && (
                <>
                  <span className="pd-hero__eyebrow-sep" aria-hidden="true" />
                  <span>
                    {intl.formatMessage(
                      { id: 'providers.since_date' },
                      { date: sinceMonthYear },
                    )}
                  </span>
                </>
              )}
            </div>
            <h1 className="pd-hero__name">{provider.name}</h1>
            {hasOrders && (
              <div className="pd-hero__meta">
                <span className="pd-hero__meta-item">
                  {intl.formatMessage(
                    { id: 'orders.order_count' },
                    { count: providerOrders.length },
                  )}
                </span>
                <span className="pd-hero__meta-sep" aria-hidden="true">·</span>
                <span className="pd-hero__meta-item">
                  {intl.formatMessage(
                    { id: 'providers.lifetime_total' },
                    { value: lifetimeSpend },
                  )}
                </span>
              </div>
            )}
          </div>
          {/* Status pill lives in the hero's third grid column so it
              right-aligns with the page edge. Top-aligned via align-self
              so it sits at the cap-line of the eyebrow row. */}
          <span
            className="pd-hero__status"
            data-active={provider.active}
          >
            <span className="pd-hero__status-dot" aria-hidden="true" />
            {intl.formatMessage({
              id: provider.active
                ? 'providers.status_active'
                : 'providers.status_inactive',
            })}
          </span>
        </div>

        {/* ============== Primary action row ==============
            Page-level paired pills mirroring the team-roster invite-pill
            family — terracotta primary for "New order" (manager-only),
            ghost outline secondary for "Contact". 14px Lucide glyphs,
            mono uppercase tracked label, 8px gap. When the user is a
            non-manager, Contact stretches full width. */}
        <div className="pd-actions">
          {canManage && (
            <button
              type="button"
              className="pd-action-pill"
              onClick={() => orderFlows.openNewOrder(providerId)}
            >
              <Plus aria-hidden="true" />
              <span>
                {intl.formatMessage({ id: 'providers.new_order_button' })}
              </span>
            </button>
          )}
          <button
            type="button"
            className="pd-action-pill pd-action-pill--ghost"
            onClick={() => setContactSheetOpen(true)}
            disabled={!provider.phone && !provider.email}
          >
            <Phone aria-hidden="true" />
            <span>{intl.formatMessage({ id: 'providers.contact_button' })}</span>
          </button>
        </div>

        {/* ============== Details list (manager-only) ==============
            Mirrors ManageView's per-field row pattern: each row is a
            tap target that opens its own focused modal (Name / Phone /
            Email). The Status row owns its toggle inline — no modal —
            because boolean state doesn't warrant the ceremony of an
            open/save flow. Non-managers don't see this section. */}
        {canManage && (
          <div className="pd-section">
            <GroupLabel>
              {intl.formatMessage({ id: 'providers.section_details' })}
            </GroupLabel>
            <IonList inset lines="full" className="account-list">
              <IonItem button detail onClick={openNameEdit}>
                <UserIcon slot="start" className="text-text-secondary w-5 h-5" />
                <IonLabel>
                  <h3>{intl.formatMessage({ id: 'providers.name_label' })}</h3>
                </IonLabel>
                <IonNote slot="end" className="pd-detail__value">
                  {provider.name}
                </IonNote>
              </IonItem>
              <IonItem button detail onClick={openPhoneEdit}>
                <Phone slot="start" className="text-text-secondary w-5 h-5" />
                <IonLabel>
                  <h3>{intl.formatMessage({ id: 'providers.phone_label' })}</h3>
                </IonLabel>
                <IonNote
                  slot="end"
                  className={phoneValue ? 'pd-detail__value' : 'pd-detail__placeholder'}
                >
                  {phoneValue || '—'}
                </IonNote>
              </IonItem>
              <IonItem button detail onClick={openEmailEdit}>
                <Mail slot="start" className="text-text-secondary w-5 h-5" />
                <IonLabel>
                  <h3>{intl.formatMessage({ id: 'providers.email_label' })}</h3>
                </IonLabel>
                <IonNote
                  slot="end"
                  className={emailValue ? 'pd-detail__value' : 'pd-detail__placeholder'}
                >
                  {emailValue || '—'}
                </IonNote>
              </IonItem>
              {/* Status row owns its IonToggle inline — tap routes through
                  the toggle, not the row chassis (we drop button/detail). */}
              <IonItem lines="full">
                <Power slot="start" className="text-text-secondary w-5 h-5" />
                <IonLabel>
                  <h3>{intl.formatMessage({ id: 'providers.active_label' })}</h3>
                </IonLabel>
                <span
                  slot="end"
                  className="pd-toggle-value"
                  data-active={provider.active}
                >
                  <span>
                    {intl.formatMessage({
                      id: provider.active
                        ? 'providers.status_active'
                        : 'providers.status_inactive',
                    })}
                  </span>
                  <IonToggle
                    checked={provider.active}
                    disabled={isTogglingActive}
                    onIonChange={handleToggleActive}
                    aria-label={intl.formatMessage({ id: 'providers.active_label' })}
                  />
                </span>
              </IonItem>
            </IonList>
            {activeError && (
              <p className="pd-error" role="alert" style={{ margin: 'var(--space-3) 0 0' }}>
                {activeError}
              </p>
            )}
          </div>
        )}

        {/* ============== Danger zone (manager-only) ==============
            Mirrors ManageView's danger-zone idiom: a separate red-tinted
            IonList sitting alongside the editable Details rows. Sits
            above the tab strip because the page's primary purpose is
            management — Summary / History / Notes are reference, not
            action. Single Delete row opens DeleteProviderModal. */}
        {canManage && (
          <div className="pd-section pd-danger">
            <GroupLabel tone="danger">
              {intl.formatMessage({ id: 'providers.section_danger' })}
            </GroupLabel>
            <IonList inset lines="full" className="account-list account-list--danger">
              <IonItem button detail onClick={openDelete}>
                <Trash2 slot="start" className="text-error w-5 h-5" />
                <IonLabel color="danger">
                  <h3>{intl.formatMessage({ id: 'providers.delete_provider_row' })}</h3>
                </IonLabel>
              </IonItem>
            </IonList>
          </div>
        )}

        {/* ============== Tabs ==============
            Pill segmented control mirroring the Products page convention
            (.products-segment). Plain <button role="tab"> elements rather
            than IonSegment — IonSegment's gesture/touch routing was
            misrouting taps inside the active TabContainer body below.
            Mono uppercase tracked labels with an optional count chip on
            History and Notes. The TabContainer below stays in charge of
            swipeable, URL-persisted state. */}
        <div className="pd-section">
          <div
            role="tablist"
            aria-label={intl.formatMessage({ id: 'providers.tab_switcher_aria' })}
            className="pd-segment"
          >
            {DETAIL_TAB_IDS.map((id) => {
              const isActive = activeTab === id
              const countLabel =
                id === 'notes' && notesCount > 0
                  ? `${notesCount}/${MAX_PROVIDER_NOTES}`
                  : null
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className="pd-segment__button"
                  onClick={() => handleTabChange(id)}
                >
                  <span>{intl.formatMessage({ id: `providers.tab_${id}` })}</span>
                  {countLabel && (
                    <span className="pd-segment__count">{countLabel}</span>
                  )}
                </button>
              )
            })}
          </div>

          <TabContainer
            activeTab={activeTab}
            onTabChange={id => handleTabChange(id as DetailTab)}
            swipeable
            fitActiveHeight
            preserveScrollOnChange
          >
            {/* ---- Summary ----
                Cards always render — on a brand-new provider, each card
                tells its own empty-state story (stats at zero, reliability
                as "not enough data", typical items promising what will
                appear). The overdue banner is the only card that stays
                conditional (only shown when orders are actually overdue). */}
            <TabContainer.Tab id="summary">
              <div className="flex flex-col gap-3">
                {/* Overdue banner — paper-overlay alert. Tap to jump to
                    the History tab. Oxblood, not generic red. */}
                {overdueCount > 0 && (
                  <button
                    type="button"
                    className="pd-overdue"
                    onClick={() => handleTabChange('history')}
                  >
                    <span className="pd-overdue__icon" aria-hidden="true">
                      <Bell />
                    </span>
                    <span>
                      <span className="pd-overdue__title">
                        {intl.formatMessage({
                          id: 'providers.overdue_banner_title'
                        }, { count: overdueCount })}
                      </span>
                      <span className="pd-overdue__sub">
                        {intl.formatMessage({
                          id: 'providers.overdue_banner_subtitle'
                        })}
                      </span>
                    </span>
                    <ChevronRight className="pd-overdue__chev" />
                  </button>
                )}

                {/* Stats — two-up tile grid. Mono uppercase label,
                    Fraunces value, mono sub-line. Reliability swaps the
                    big number for a percent + horizontal bar; insufficient-
                    data state collapses to a quiet italic line. */}
                <div className="pd-stats">
                  {/* ---- Total spent ---- */}
                  <div className="pd-stat">
                    <div className="pd-stat__label">
                      {intl.formatMessage({ id: 'providers.stat_total_spent' })}
                    </div>
                    <div className="pd-stat__value">
                      {formatCurrencyCompact(metrics.totalSpent)}
                    </div>
                    <div className="pd-stat__sub">
                      {metrics.orderCount === 0
                        ? intl.formatMessage({ id: 'providers.stat_never_ordered' })
                        : metrics.cadenceDays != null
                          ? intl.formatMessage(
                              { id: 'providers.stat_total_spent_subtext_with_cadence' },
                              { count: metrics.orderCount, days: metrics.cadenceDays },
                            )
                          : intl.formatMessage(
                              { id: 'providers.stat_total_spent_subtext_orders_only' },
                              { count: metrics.orderCount },
                            )}
                    </div>
                  </div>

                  {/* ---- Reliability ---- */}
                  <div className="pd-stat">
                    <div className="pd-stat__label">
                      {intl.formatMessage({ id: 'providers.stat_reliability_label' })}
                    </div>
                    {metrics.reliability ? (
                      <>
                        <div className="pd-stat__value">
                          {metrics.reliability.percent}%
                        </div>
                        <div className="pd-stat__bar">
                          <ReliabilityBar
                            percent={metrics.reliability.percent}
                            ariaLabel={intl.formatMessage({
                              id: 'providers.stat_reliability_label'
                            }) + ': ' + metrics.reliability.percent + '%'}
                          />
                        </div>
                        <div className="pd-stat__sub">
                          {intl.formatMessage(
                            { id: 'providers.stat_reliability_breakdown' },
                            { onTime: metrics.reliability.onTime, total: metrics.reliability.resolved },
                          )}
                          {metrics.reliability.windowSize < metrics.orderCount && (
                            <>
                              {' · '}
                              {intl.formatMessage(
                                { id: 'providers.stat_reliability_window' },
                                { count: metrics.reliability.windowSize },
                              )}
                            </>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="pd-stat__value--muted">
                        {intl.formatMessage({ id: 'providers.stat_reliability_insufficient' })}
                      </div>
                    )}
                  </div>
                </div>

                {/* ---- Typical items ----
                    Mono "WHAT YOU BUY" header, hairline divider, then a
                    tight list of icon + name + units/last-ordered subline.
                    Empty state collapses to a quiet italic line. */}
                <div className="pd-card">
                  <div className="pd-card__head">
                    <span className="pd-card__head-title">
                      {intl.formatMessage({ id: 'providers.typical_items_title' })}
                    </span>
                  </div>
                  <hr className="pd-card__rule" />
                  {typicalItems.length > 0 ? (
                    <div className="pd-typical">
                      {typicalItems.map(item => {
                        // Resolve the icon via the same chain the products +
                        // sales pages use: getProductIconUrl → isPresetIcon
                        // → getPresetIcon. Items keyed by name (product was
                        // deleted) fall through to the ImagePlus placeholder.
                        const product = productsById.get(item.key)
                        const iconUrl = product ? getProductIconUrl(product) : null
                        const isPreset = iconUrl ? isPresetIcon(iconUrl) : false
                        const isPhoto = !!iconUrl && !isPreset
                        return (
                          <div key={item.key} className="pd-typical__row">
                            <div
                              className={`pd-typical__icon${
                                isPhoto ? ' pd-typical__icon--photo' : ''
                              }`}
                              aria-hidden="true"
                            >
                              {iconUrl && isPreset ? (
                                (() => {
                                  const p = getPresetIcon(iconUrl)
                                  return p ? (
                                    <p.icon size={20} className="text-text-primary" />
                                  ) : null
                                })()
                              ) : iconUrl ? (
                                <Image
                                  src={iconUrl}
                                  alt=""
                                  width={40}
                                  height={40}
                                  className="object-cover w-full h-full"
                                  unoptimized
                                />
                              ) : (
                                <ImagePlus size={16} className="text-text-tertiary" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="pd-typical__name">{item.name}</div>
                              <div className="pd-typical__sub">
                                {intl.formatMessage(
                                  { id: 'providers.typical_items_subtitle' },
                                  {
                                    units: item.totalUnits,
                                    date: formatRelative(item.lastOrderedAt, userLocale),
                                  },
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="pd-card__empty">
                      {intl.formatMessage({ id: 'providers.typical_items_empty' })}
                    </p>
                  )}
                </div>

                {/* ---- Monthly spend ----
                    Fixed 6-month window ending at the current month. Bars
                    scale relative to the tallest in the window; empty
                    months render as thin stubs so the time axis stays
                    consistent. The current-month bar uses the brand
                    color; past months sit in paper-deep. */}
                <div className="pd-card">
                  <div className="pd-card__head">
                    <span className="pd-card__head-title">
                      {intl.formatMessage({ id: 'providers.monthly_spend_title' })}
                    </span>
                  </div>
                  <hr className="pd-card__rule" />
                  <div className="pd-spend">
                    {monthlySpend.map(bucket => {
                      const heightPct =
                        monthlySpendMax > 0 && bucket.total > 0
                          ? Math.max(6, (bucket.total / monthlySpendMax) * 100)
                          : 0
                      const monthLabel = new Intl.DateTimeFormat(userLocale, {
                        month: 'short',
                      }).format(bucket.start)
                      const valueLabel = formatCurrencyCompact(bucket.total)
                      return (
                        <div
                          key={bucket.start.toISOString()}
                          className="pd-spend__col"
                          data-current={bucket.isCurrent}
                          data-empty={bucket.total === 0}
                        >
                          <span className="pd-spend__value">{valueLabel}</span>
                          <div className="pd-spend__bar-wrap">
                            <div
                              className="pd-spend__bar"
                              style={
                                bucket.total > 0 ? { height: `${heightPct}%` } : undefined
                              }
                            />
                          </div>
                          <span className="pd-spend__label">{monthLabel}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </TabContainer.Tab>

          {/* ---- History ----
              Same card primitive (.pd-card), mono header (label · count ·
              total), hairline rule, then the OrderListItem rows. The
              "Ordered to:" metadata row is suppressed because the whole
              page is already about one provider. */}
          <TabContainer.Tab id="history">
            <div className="pd-card">
              <div className="pd-card__head">
                <span className="pd-card__head-title">
                  {intl.formatMessage({ id: 'providers.order_history_title' })}
                </span>
                {hasOrders && (
                  <span className="pd-card__head-meta">
                    {intl.formatMessage(
                      { id: 'orders.order_count' },
                      { count: providerOrders.length },
                    )}
                    {' · '}
                    {formatCurrencyCompact(metrics.totalSpent)}
                  </span>
                )}
              </div>
              <hr className="pd-card__rule" />

              {!hasOrders ? (
                <p className="pd-card__empty">
                  {intl.formatMessage({ id: 'providers.order_history_empty' })}
                </p>
              ) : (
                <IonList lines="full" className="pd-history__list">
                  {providerOrders.map((order) => {
                    const alreadyReceived = getOrderDisplayStatus(order) === 'received'
                    // Same semantic ordering as the Products page Orders tab.
                    // Receive is available to any active member; Edit + Delete
                    // are manager-only.
                    const swipeActions = [
                      {
                        id: `${order.id}-receive`,
                        icon: <Inbox size={20} />,
                        label: intl.formatMessage({
                          id: 'orders.action_receive'
                        }),
                        variant: 'primary' as const,
                        disabled: alreadyReceived,
                        onClick: () => orderFlows.openOrderDetail(order, 'receive'),
                      },
                      ...(canManage ? [
                        {
                          id: `${order.id}-edit`,
                          icon: <Pencil size={20} />,
                          label: intl.formatMessage({
                            id: 'orders.action_edit'
                          }),
                          variant: 'neutral' as const,
                          disabled: alreadyReceived,
                          onClick: () => orderFlows.openOrderDetail(order, 'edit'),
                        },
                        {
                          id: `${order.id}-delete`,
                          icon: <Trash2 size={20} />,
                          label: intl.formatMessage({
                            id: 'orders.action_delete'
                          }),
                          variant: 'danger' as const,
                          disabled: alreadyReceived,
                          onClick: () => orderFlows.openOrderDetail(order, 'delete'),
                        },
                      ] : []),
                    ]
                    return (
                      <SwipeRow key={order.id} actions={swipeActions}>
                        <IonItem lines="full">
                          <OrderListItem
                            order={order}
                            onView={() => orderFlows.openOrderDetail(order)}
                            hideProviderRow
                          />
                        </IonItem>
                      </SwipeRow>
                    )
                  })}
                </IonList>
              )}
            </div>
          </TabContainer.Tab>

          {/* ---- Notes ----
              Editorial paper card. Mono "NOTES · X/5" header, hairline,
              then either the empty-state italic line or the divided
              note list. Each note: Fraunces title + mono "EDITED X AGO"
              + body in Geist, with manager-only edit/trash icon buttons.
              Same shell for empty + populated so card height doesn't
              jump when a note is first added. */}
          <TabContainer.Tab id="notes">
            <div className="pd-card">
              <div className="pd-card__head">
                <span className="pd-card__head-title">
                  {intl.formatMessage({ id: 'providers.notes_card_header' })}
                </span>
                <span className="pd-card__head-meta">
                  {intl.formatMessage(
                    { id: 'providers.notes_count_label' },
                    { count: notesCount, max: MAX_PROVIDER_NOTES },
                  )}
                </span>
              </div>
              <hr className="pd-card__rule" />

              {notesCount === 0 ? (
                <p className="pd-card__empty">
                  {intl.formatMessage({ id: 'providers.notes_empty' })}
                </p>
              ) : (
                <div className="pd-notes">
                  {notes.map((note) => (
                    <div key={note.id} className="pd-note">
                      <div className="pd-note__head">
                        <div className="pd-note__title-block">
                          <span className="pd-note__title">{note.title}</span>
                          <span className="pd-note__meta">
                            {intl.formatMessage(
                              { id: 'providers.note_edited_on' },
                              { date: formatRelative(note.updatedAt, userLocale) },
                            )}
                          </span>
                        </div>
                        {canManage && (
                          <div className="pd-note__actions">
                            <button
                              type="button"
                              onClick={() => openEditNote(note)}
                              className="pd-note__icon-btn"
                              aria-label={intl.formatMessage({
                                id: 'providers.note_edit_aria',
                              })}
                            >
                              <Pencil style={{ width: 16, height: 16 }} />
                            </button>
                            <button
                              type="button"
                              onClick={() => openDeleteNote(note)}
                              className="pd-note__icon-btn pd-note__icon-btn--danger"
                              aria-label={intl.formatMessage({
                                id: 'providers.note_delete_aria',
                              })}
                            >
                              <Trash2 style={{ width: 16, height: 16 }} />
                            </button>
                          </div>
                        )}
                      </div>
                      <p className="pd-note__body">{note.body}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Bottom-right "+ Add note" button. Disabled when the
                  per-provider cap is reached; server still enforces. */}
              {canManage && (
                <>
                  <hr className="pd-card__rule" />
                  <div className="pd-notes__add-row">
                    <IonButton
                      fill="outline"
                      size="small"
                      shape="round"
                      onClick={openAddNote}
                      disabled={atNotesLimit}
                    >
                      <Plus slot="start" style={{ width: 14, height: 14 }} />
                      {intl.formatMessage({ id: 'providers.add_note_button' })}
                    </IonButton>
                  </div>
                </>
              )}
            </div>
          </TabContainer.Tab>
        </TabContainer>
        </div>
      </div>
      {/* ============== Per-field edit modals ==============
          Each modal owns one field and its own local save-success
          flag so the Lottie gate flips atomically with the step
          transition. onExitComplete just clears the shared error so a
          re-open lands on a clean form. */}
      <EditProviderNameModal
        isOpen={isNameEditOpen}
        onClose={() => setNameEditOpen(false)}
        onExitComplete={() => setEditError('')}
        initialName={provider.name}
        isSaving={isSaving}
        error={editError}
        onSubmit={handleSaveName}
      />
      <EditProviderPhoneModal
        isOpen={isPhoneEditOpen}
        onClose={() => setPhoneEditOpen(false)}
        onExitComplete={() => setEditError('')}
        initialPhone={provider.phone ?? ''}
        isSaving={isSaving}
        error={editError}
        onSubmit={handleSavePhone}
      />
      <EditProviderEmailModal
        isOpen={isEmailEditOpen}
        onClose={() => setEmailEditOpen(false)}
        onExitComplete={() => setEditError('')}
        initialEmail={provider.email ?? ''}
        isSaving={isSaving}
        error={editError}
        onSubmit={handleSaveEmail}
      />
      {/* ============== Delete provider modal ==============
          Standalone confirm + delete-success flow. After the modal has
          finished animating closed on a successful delete, we navigate
          back to the providers list — deferring the navigation lets the
          delete-success surface play inside the modal first. */}
      <DeleteProviderModal
        isOpen={isDeleteOpen}
        onClose={() => setDeleteOpen(false)}
        onExitComplete={() => {
          setDeleteError('')
          if (providerDeleted) {
            goBackTo(`/${businessId}/providers`)
            setProviderDeleted(false)
          }
        }}
        provider={provider}
        isDeleting={isDeleting}
        error={deleteError}
        providerDeleted={providerDeleted}
        onDelete={handleDelete}
      />
      {/* ============== Add note modal ============== */}
      <AddProviderNoteModal
        isOpen={isAddNoteOpen}
        onClose={() => setAddNoteOpen(false)}
        onExitComplete={handleAddNoteExitComplete}
        title={noteTitle}
        onTitleChange={setNoteTitle}
        body={noteBody}
        onBodyChange={setNoteBody}
        isSaving={isSavingNote}
        noteSaved={noteSaved}
        error={noteError}
        onSubmit={handleAddNote}
      />
      {/* ============== Edit / delete note modal ==============
          Opens at step 0 from the edit pencil and step 1 (delete confirm)
          from the trash icon. Delete-success plays as step 2, save-success
          as step 3 — same shape as EditProviderModal. */}
      <EditProviderNoteModal
        isOpen={isEditNoteOpen}
        onClose={() => setEditNoteOpen(false)}
        onExitComplete={handleEditNoteExitComplete}
        initialStep={editNoteInitialStep}
        editingNote={editingNote}
        title={noteTitle}
        onTitleChange={setNoteTitle}
        body={noteBody}
        onBodyChange={setNoteBody}
        isSaving={isSavingNote}
        noteSaved={noteSaved}
        error={noteError}
        onSubmit={handleUpdateNote}
        isDeleting={isDeletingNote}
        noteDeleted={noteDeleted}
        onDelete={handleDeleteNote}
      />
      {/* ============== Contact sheet ==============
          Tapping a row fires the native handler (tel:, mailto:, wa.me) and
          closes the sheet so returning to the app doesn't land back inside
          an open overlay. Rows for missing contact fields are omitted.

          Visual: mirrors the user-menu drawer's hairline-row chassis but
          opens with a printed-stub hero (mono "REACH" eyebrow above a
          Fraunces italic provider name) so the sheet reads as a calling
          card. `flushContent` removes the default modal inset so each row
          paints edge-to-edge — the per-row padding handles its own gutter,
          matching .user-menu-content. The toolbar IonTitle is left empty
          (the body hero carries the identity) but a screen-reader-only
          accessible name still rides on the modal via the same translation
          key the previous version exposed. */}
      <ModalShell
        isOpen={isContactSheetOpen}
        onClose={() => setContactSheetOpen(false)}
        title={intl.formatMessage({
          id: 'providers.contact_sheet_title'
        }, { name: provider.name })}
        variant="half"
        flushContent
      >
        <header className="pv-contact-hero">
          <span className="pv-contact-hero__eyebrow">
            {intl.formatMessage({ id: 'providers.modal_v2.section_reach' })}
          </span>
          <h2 className="pv-contact-hero__name">{provider.name}</h2>
        </header>
        <div className="pv-contact-list" role="list">
          {provider.phone && (
            <ContactSheetRow
              icon={<Phone />}
              variant="call"
              label={intl.formatMessage({
                id: 'providers.action_call'
              })}
              value={provider.phone}
              href={`tel:${provider.phone}`}
              onAction={() => setContactSheetOpen(false)}
            />
          )}
          {provider.phone && (
            <ContactSheetRow
              icon={<MessageCircle />}
              variant="whatsapp"
              label={intl.formatMessage({
                id: 'providers.action_whatsapp'
              })}
              value={provider.phone}
              href={`https://wa.me/${provider.phone.replace(/\D/g, '')}`}
              external
              onAction={() => setContactSheetOpen(false)}
            />
          )}
          {provider.email && (
            <ContactSheetRow
              icon={<Mail />}
              variant="email"
              label={intl.formatMessage({
                id: 'providers.action_email'
              })}
              value={provider.email}
              href={`mailto:${provider.email}`}
              onAction={() => setContactSheetOpen(false)}
            />
          )}
        </div>
      </ModalShell>
      {/* ============== Order flows (new order + order detail/edit/receive/delete) ============== */}
      {orderFlows.modals}
    </>
  );
}

function formatMonthYear(date: Date | string, locale: string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  // 4-digit year so "May 26" can't be misread as a day-of-month.
  return new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' }).format(d)
}

interface ContactSheetRowProps {
  icon: ReactNode
  /** Channel variant — drives the icon-chip tint (saffron / moss / ink). */
  variant: 'call' | 'whatsapp' | 'email'
  label: string
  value: string
  href: string
  external?: boolean
  onAction: () => void
}

/**
 * One row of the contact sheet. Shares its hairline-divider, paper-warm
 * hover wash, and chevron-trailing-edge chassis with `.user-menu-item`
 * (see providers-modal.css §9 + interactive.css `.user-menu-item`) so the
 * supplier sheet feels like a sibling of the user-menu drawer rather than
 * a one-off overlay. The leading `pv-contact-row__chip` tints itself per
 * channel; the value sits below the label in JetBrains Mono so phone
 * numbers fall into tabular alignment across rows.
 */
function ContactSheetRow({
  icon,
  variant,
  label,
  value,
  href,
  external,
  onAction,
}: ContactSheetRowProps) {
  return (
    <a
      href={href}
      onClick={onAction}
      role="listitem"
      className="pv-contact-row"
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      <span
        className={`pv-contact-row__chip pv-contact-row__chip--${variant}`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="pv-contact-row__body">
        <span className="pv-contact-row__label">{label}</span>
        <span className="pv-contact-row__value">{value}</span>
      </span>
      <ChevronRight className="pv-contact-row__arrow" aria-hidden="true" />
    </a>
  )
}
