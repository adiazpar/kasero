'use client'

import { useEffect, useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { RefreshCw, Sparkles } from 'lucide-react'
import dynamic from '@/lib/next-dynamic-shim'
import { ModalShell } from '@/components/ui'
import { ApiError, apiPost, type ApiResponse } from '@/lib/api-client'
import { useApiMessage } from '@/hooks/useApiMessage'
import { useBusiness } from '@/contexts/business-context'
import { CACHE_KEYS, scopedCache } from '@/hooks/useSessionCache'

// Lazy modal import keeps the paywall chunk out of the Home bundle until
// a free user actually hits the limit (same pattern as ManageView).
const ProUpgradeModal = dynamic(
  () => import('@/components/manage/ProUpgradeModal').then((m) => m.ProUpgradeModal),
  { ssr: false },
)

interface PulseDigest {
  headline: string
  sections: { title: string; body: string }[]
  watchouts: string[]
  generatedAt: string
}

/**
 * Kasero Pulse card on the Home view — the flagship "why Pro exists"
 * surface. States: idle (pitch + generate), loading (skeleton), ready
 * (headline + first-section preview; tap opens the full digest in a
 * ModalShell), inline error. On PULSE_FREE_LIMIT_REACHED the error state
 * carries an upgrade button that opens ProUpgradeModal.
 *
 * The last digest is persisted per business in sessionStorage so it
 * survives tab switches; the regenerate affordance refetches.
 */
export function PulseCard() {
  const intl = useIntl()
  const translateApiMessage = useApiMessage()
  const { businessId, isPro } = useBusiness()

  const cache = useMemo(
    () =>
      businessId ? scopedCache<PulseDigest>(CACHE_KEYS.PULSE, businessId) : null,
    [businessId],
  )

  const [digest, setDigest] = useState<PulseDigest | null>(() => cache?.get() ?? null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState('')
  const [limitReached, setLimitReached] = useState(false)
  const [digestOpen, setDigestOpen] = useState(false)
  const [upgradeOpen, setUpgradeOpen] = useState(false)

  // Re-hydrate from the per-business cache when the active business
  // changes (the card instance can survive a business switch).
  useEffect(() => {
    setDigest(cache?.get() ?? null)
    setError('')
    setLimitReached(false)
  }, [cache])

  const generate = async () => {
    if (!businessId || isGenerating) return
    setError('')
    setLimitReached(false)
    setIsGenerating(true)
    try {
      const res = await apiPost<ApiResponse & { data: PulseDigest }>(
        `/api/businesses/${businessId}/pulse`,
        {},
      )
      setDigest(res.data)
      cache?.set(res.data)
    } catch (err) {
      console.error('Pulse generation failed:', err)
      if (err instanceof ApiError && err.envelope) {
        setError(translateApiMessage(err.envelope))
        // The free-sample paywall gets its own affordance: the localized
        // message plus an upgrade button into ProUpgradeModal.
        setLimitReached(err.messageCode === 'PULSE_FREE_LIMIT_REACHED')
      } else {
        setError(intl.formatMessage({ id: 'home.pulse_error_fallback' }))
      }
    } finally {
      setIsGenerating(false)
    }
  }

  const firstSection = digest?.sections[0] ?? null

  return (
    <section className="home-pulse">
      <div className="home-pulse__eyebrow-row">
        <span className="home-pulse__eyebrow">
          <Sparkles size={12} aria-hidden="true" />
          {intl.formatMessage({ id: 'home.pulse_eyebrow' })}
        </span>
        {digest && !isGenerating && (
          <button
            type="button"
            className="home-pulse__regenerate"
            onClick={() => void generate()}
            aria-label={intl.formatMessage({ id: 'home.pulse_regenerate' })}
          >
            <RefreshCw size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      {isGenerating ? (
        <div
          className="home-pulse__skeleton"
          role="status"
          aria-label={intl.formatMessage({ id: 'home.pulse_generating' })}
        >
          <div className="home-pulse__skeleton-line home-pulse__skeleton-line--headline" />
          <div className="home-pulse__skeleton-line" />
          <div className="home-pulse__skeleton-line home-pulse__skeleton-line--short" />
        </div>
      ) : digest ? (
        <button
          type="button"
          className="home-pulse__preview"
          onClick={() => setDigestOpen(true)}
        >
          <h3 className="home-pulse__headline">{digest.headline}</h3>
          {firstSection && (
            <p className="home-pulse__excerpt">{firstSection.body}</p>
          )}
          <span className="home-pulse__read-more">
            {intl.formatMessage({ id: 'home.pulse_read_full' })}
          </span>
        </button>
      ) : (
        <div className="home-pulse__idle">
          <p className="home-pulse__pitch">
            {intl.formatMessage({ id: 'home.pulse_pitch' })}
          </p>
          <button
            type="button"
            className="home-pulse__generate"
            onClick={() => void generate()}
          >
            {intl.formatMessage({ id: 'home.pulse_generate' })}
          </button>
          {!isPro && (
            <p className="home-pulse__hint">
              {intl.formatMessage({ id: 'home.pulse_free_hint' })}
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="home-pulse__error" role="alert">
          <p className="home-pulse__error-text">{error}</p>
          {limitReached && (
            <button
              type="button"
              className="home-pulse__upgrade"
              onClick={() => setUpgradeOpen(true)}
            >
              {intl.formatMessage({ id: 'home.pulse_upgrade' })}
            </button>
          )}
        </div>
      )}

      <ModalShell
        isOpen={digestOpen}
        onClose={() => setDigestOpen(false)}
        title={intl.formatMessage({ id: 'home.pulse_modal_title' })}
      >
        {digest && (
          <div className="home-pulse-digest">
            <h2 className="home-pulse-digest__headline">{digest.headline}</h2>
            {digest.sections.map((section) => (
              <section key={section.title} className="home-pulse-digest__section">
                <h3 className="home-pulse-digest__section-title">{section.title}</h3>
                <p className="home-pulse-digest__section-body">{section.body}</p>
              </section>
            ))}
            {digest.watchouts.length > 0 && (
              <section className="home-pulse-digest__section">
                <h3 className="home-pulse-digest__section-title">
                  {intl.formatMessage({ id: 'home.pulse_watchouts_title' })}
                </h3>
                <ul className="home-pulse-digest__watchouts">
                  {digest.watchouts.map((watchout) => (
                    <li key={watchout} className="home-pulse-digest__watchout">
                      {watchout}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </ModalShell>

      <ProUpgradeModal isOpen={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
    </section>
  )
}
