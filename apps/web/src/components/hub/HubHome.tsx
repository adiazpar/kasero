'use client'

import { useIntl } from 'react-intl'
import { useCallback, useEffect, useState, useMemo } from 'react'
import { useIonViewWillEnter } from '@ionic/react'
import { useRouter } from '@/lib/next-navigation-shim'
import { Building2, SearchX, X } from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import { useAuthGate } from '@/contexts/auth-gate-context'
import { usePageTransition } from '@/contexts/page-transition-context'
import { useCreateBusinessModal } from '@/contexts/create-business-context'
import { useJoinBusinessModal } from '@/contexts/join-business-context'
import { fetchDeduped } from '@/lib/fetch'
import { createSessionCache, CACHE_KEYS } from '@/hooks'
import { FeatureCard, GroupLabel, PageSpinner } from '@/components/ui'
import { BusinessRow } from '@/components/businesses/shared'
import type { MessageId } from '@/i18n/messageIds'

interface Business {
  id: string
  name: string
  role: string
  isOwner: boolean
  memberCount: number
  icon: string | null
  locale: string
  currency: string
}

const hubBusinessesCache = createSessionCache<Business[]>(CACHE_KEYS.HUB_BUSINESSES)

function getCachedBusinessList(): Business[] {
  return hubBusinessesCache.get() ?? []
}

const SearchIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
)

export function HubHome() {
  return <HubHomeBody />
}

function HubHomeBody() {
  const router = useRouter()
  const { user, isLoading: authLoading } = useAuth()
  const { markHubReady } = useAuthGate()
  // navigate() (not raw ionRouter.push) is required for business
  // drilldowns: it sets pendingHref + wraps the route change in a
  // startTransition, both of which the BusinessProvidersFromUrl tree +
  // ContentGuard depend on to keep the page-load handshake clean. A
  // direct ionRouter.push leaves the second visit to the same business
  // showing a blank ContentGuard (no business resolved yet) because
  // the in-flight navigation isn't registered with the page-transition
  // context. Animation direction is good enough via history.push for
  // this path — the modal-dismiss-tick edge case that justified the
  // ionRouter trick on /account doesn't apply here.
  const { navigate, setCachedBusinesses } = usePageTransition()
  const { createdBusiness, openCreateModal } = useCreateBusinessModal()
  const { openJoinModal } = useJoinBusinessModal()
  const [businesses, setBusinesses] = useState<Business[]>(() => getCachedBusinessList())
  const [isLoading, setIsLoading] = useState(() => getCachedBusinessList().length === 0)
  const [searchQuery, setSearchQuery] = useState('')
  const intl = useIntl()

  // Release the auth-gate's hold phase as soon as the hub has its data.
  useEffect(() => {
    if (!authLoading && !isLoading) markHubReady()
  }, [authLoading, isLoading, markHubReady])

  const fetchBusinesses = useCallback(async () => {
    try {
      const res = await fetchDeduped('/api/businesses/list')
      if (res.ok) {
        const data = await res.json()
        const fetchedBusinesses = data.businesses || []
        setBusinesses(fetchedBusinesses)
        setCachedBusinesses(fetchedBusinesses)
        hubBusinessesCache.set(fetchedBusinesses)
      }
    } catch (error) {
      console.error('Failed to fetch businesses:', error)
    } finally {
      setIsLoading(false)
    }
  }, [setCachedBusinesses])

  const userId = user?.id
  useEffect(() => {
    if (authLoading) return
    if (!userId) {
      router.push('/')
      return
    }
    fetchBusinesses()
  }, [userId, authLoading, router, fetchBusinesses])

  // Refresh after a new business is created.
  useEffect(() => {
    if (createdBusiness) fetchBusinesses()
  }, [createdBusiness, fetchBusinesses])

  // Refetch whenever the hub becomes the active view. `goBackTo('/')`
  // pops the business stack back to this page rather than remounting
  // it, so a delete/edit/leave inside a business would otherwise leave
  // the React state holding the pre-mutation list. clearHubBusinessesCache()
  // wipes sessionStorage but can't reach this component's state directly.
  // `useIonViewWillEnter` is the idiomatic pop-back refresh hook;
  // `fetchDeduped` collapses the duplicate fetch on initial activation.
  useIonViewWillEnter(() => {
    if (authLoading || !userId) return
    fetchBusinesses()
  }, [authLoading, userId, fetchBusinesses])

  const handleEnterBusiness = (businessId: string) => {
    navigate(`/${businessId}/home`)
  }

  const filteredBusinesses = useMemo(() => {
    if (!searchQuery.trim()) return businesses
    const query = searchQuery.toLowerCase().trim()
    return businesses.filter((b) => b.name.toLowerCase().includes(query))
  }, [businesses, searchQuery])

  const ownedBusinesses = filteredBusinesses.filter((b) => b.isOwner)
  const joinedBusinesses = filteredBusinesses.filter((b) => !b.isOwner)
  const hasBusinesses = businesses.length > 0
  const hasFilteredResults = filteredBusinesses.length > 0

  if (authLoading || isLoading) {
    return (
      <PageSpinner />
    )
  }

  return (
    <div className={hasBusinesses ? 'hub-body' : 'hub-body hub-body--empty'}>
      <HubGreeting userName={user?.name ?? null} locale={intl.locale} />

      <GroupLabel>
        {intl.formatMessage({ id: 'hub.get_started_label' })}
      </GroupLabel>

      <div className="hub-actions">
        <FeatureCard
          primary
          kicker={intl.formatMessage({ id: 'hub.action_create_kicker' })}
          title={intl.formatMessage({ id: 'hub.action_create_title' })}
          description={intl.formatMessage({ id: 'hub.action_create_desc_short' })}
          onClick={openCreateModal}
        />
        <FeatureCard
          kicker={intl.formatMessage({ id: 'hub.action_join_kicker' })}
          title={intl.formatMessage({ id: 'hub.action_join_title' })}
          description={intl.formatMessage({ id: 'hub.action_join_desc_short' })}
          onClick={openJoinModal}
        />
      </div>

      {!hasBusinesses && (
        <div className="hub-empty">
          <Building2 className="hub-empty__icon" aria-hidden="true" />
          <h2 className="hub-empty__title">
            {intl.formatMessage({ id: 'hub.empty_state_title' })}
          </h2>
          <p className="hub-empty__desc">
            {intl.formatMessage({ id: 'hub.empty_state_description' })}
          </p>
        </div>
      )}

      {hasBusinesses && (
        <>
          <label className="app-search">
            <span className="app-search__icon">{SearchIcon}</span>
            <input
              type="search"
              className="app-search__input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={intl.formatMessage({ id: 'hub.search_placeholder' })}
              aria-label={intl.formatMessage({ id: 'hub.search_placeholder' })}
              autoComplete="off"
              spellCheck={false}
            />
            {searchQuery && (
              <button
                type="button"
                className="app-search__clear"
                onClick={() => setSearchQuery('')}
                aria-label={intl.formatMessage({ id: 'hub.search_clear' })}
              >
                <X />
              </button>
            )}
          </label>

          {searchQuery && !hasFilteredResults ? (
            <div className="hub-empty-search">
              <SearchX className="hub-empty-search__icon" />
              <p>
                {intl.formatMessage(
                  { id: 'hub.no_results' },
                  { query: searchQuery }
                )}
              </p>
            </div>
          ) : null}

          {ownedBusinesses.length > 0 && (
            <>
              <GroupLabel count={ownedBusinesses.length}>
                {intl.formatMessage({ id: 'hub.section_owned' })}
              </GroupLabel>
              <div>
                {ownedBusinesses.map((b) => (
                  <BusinessRow
                    key={b.id}
                    business={b}
                    onClick={() => handleEnterBusiness(b.id)}
                  />
                ))}
              </div>
            </>
          )}

          {joinedBusinesses.length > 0 && (
            <>
              <GroupLabel count={joinedBusinesses.length}>
                {intl.formatMessage({ id: 'hub.section_joined' })}
              </GroupLabel>
              <div>
                {joinedBusinesses.map((b) => (
                  <BusinessRow
                    key={b.id}
                    business={b}
                    onClick={() => handleEnterBusiness(b.id)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

// Time-of-day greeting bucket.
type GreetingKey =
  | 'hub.greeting_morning'
  | 'hub.greeting_afternoon'
  | 'hub.greeting_evening'

function computeGreetingKey(): GreetingKey {
  const hour = new Date().getHours()
  if (hour >= 6 && hour < 12) return 'hub.greeting_morning'
  if (hour >= 12 && hour < 18) return 'hub.greeting_afternoon'
  return 'hub.greeting_evening'
}

const EMPHASIS_KEY: Record<GreetingKey, MessageId> = {
  'hub.greeting_morning': 'hub.greeting_emphasis_morning',
  'hub.greeting_afternoon': 'hub.greeting_emphasis_afternoon',
  'hub.greeting_evening': 'hub.greeting_emphasis_evening',
}

interface HubGreetingProps {
  userName: string | null
  locale: string
}

function HubGreeting({ userName, locale }: HubGreetingProps) {
  const intl = useIntl()
  // Compute greeting in an effect to avoid an SSR/client hour boundary
  // mismatch — see CLAUDE.md "Time-of-Day Greetings" pattern.
  const [greetingKey, setGreetingKey] = useState<GreetingKey | null>(null)
  useEffect(() => setGreetingKey(computeGreetingKey()), [])

  // Localised date stamp ("THU · MAY 8") rendered as the eyebrow above
  // the greeting. Uses the user's UI locale (intl.locale) so it matches
  // the rest of the auth-scoped surface (the hub has no business yet).
  const dateLabel = useMemo(() => {
    try {
      const fmt = new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
      return fmt
        .format(new Date())
        // Replace ", " with " · " for visual rhythm; locales that use
        // different separators (e.g. ja-JP "5月8日(木)") are unaffected.
        .replace(/,\s+/g, ' · ')
        .toUpperCase()
    } catch {
      return ''
    }
  }, [locale])

  if (!greetingKey || !userName) return null

  const firstName = userName.trim().split(/\s+/)[0] || userName

  // Italic accent on the time-of-day word ("Good evening" → "Good <em>evening</em>").
  const greetingFull = intl.formatMessage({ id: greetingKey })
  const emphasis = intl.formatMessage({ id: EMPHASIS_KEY[greetingKey] })
  const idx = greetingFull.indexOf(emphasis)
  const greetingNode =
    !emphasis || idx === -1 ? (
      <>{greetingFull}</>
    ) : (
      <>
        {greetingFull.slice(0, idx)}
        <em>{emphasis}</em>
        {greetingFull.slice(idx + emphasis.length)}
      </>
    )

  return (
    <header className="page-hero">
      {dateLabel ? <div className="page-hero__eyebrow">{dateLabel}</div> : null}
      <h1 className="page-hero__title">
        {greetingNode}, {firstName}.
      </h1>
    </header>
  )
}
