'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useIntl } from 'react-intl'
import { Globe } from 'lucide-react'
import { ModalShell } from '@/components/ui/modal-shell'
import { useAuth } from '@/contexts/auth-context'
import {
  LOCALES,
  SUPPORTED_LOCALES,
  resolveTranslationLocale,
  type SupportedLocale,
} from '@/i18n/config'

export interface LanguageModalProps {
  isOpen: boolean
  onClose: () => void
}

/**
 * Flag emoji per supported locale. iOS / macOS render these as the country
 * flag glyph natively. Android renders them as letter pairs (no flag font);
 * the layout still holds because the stamp tile is sized for two glyphs.
 *
 * Locales NOT in this map fall back to a neutral globe icon — so adding a
 * fourth supported locale without updating this file degrades gracefully
 * rather than rendering a missing-emoji box.
 */
const FLAGS: Partial<Record<SupportedLocale, string>> = {
  'en-US': '\u{1F1FA}\u{1F1F8}', // US
  es:      '\u{1F1EA}\u{1F1F8}', // Spain
  ja:      '\u{1F1EF}\u{1F1F5}', // Japan
  de:      '\u{1F1E9}\u{1F1EA}', // Germany
  fil:     '\u{1F1F5}\u{1F1ED}', // Philippines
  fr:      '\u{1F1EB}\u{1F1F7}', // France
  it:      '\u{1F1EE}\u{1F1F9}', // Italy
  ko:      '\u{1F1F0}\u{1F1F7}', // South Korea
  pt:      '\u{1F1E7}\u{1F1F7}', // Brazil (pt-BR target)
  vi:      '\u{1F1FB}\u{1F1F3}', // Vietnam
  zh:      '\u{1F1E8}\u{1F1F3}', // China (Simplified)
}

/**
 * Locale code shown beneath the native name in mono — like an airport
 * three-letter code. Uppercased and tracked-out in CSS. We pre-format the
 * value here so future locales (e.g. `pt-BR`) read as `PT-BR` not `pt-br`.
 */
function formatLocaleCode(code: SupportedLocale): string {
  return code.toUpperCase()
}

/**
 * Language picker rendered as a stack of "specimen cards" — one per
 * supported locale. Each card shows a square paper-deep stamp tile with
 * the country flag, the locale's name in its own script (Fraunces SOFT 30),
 * and the locale code beneath in mono. The active card is marked by a 3px
 * terracotta inset stripe along the leading edge plus a mono ACTIVE chip.
 *
 * Selection is non-blocking: tapping fires `changeLanguage(locale)` (which
 * updates the API + emits LANGUAGE_CHANGE_EVENT for AppIntlProvider) and
 * dismisses the modal immediately. The new bundle repaints as it loads.
 */
export function LanguageModal({ isOpen, onClose }: LanguageModalProps) {
  const intl = useIntl()
  const { user, changeLanguage } = useAuth()
  const activeButtonRef = useRef<HTMLButtonElement>(null)

  // Compose the title with one italic-terracotta accent word — same
  // pattern as ThemeModal / page-hero. The emphasis substring lives in
  // its own i18n key so translators can move the accent to whichever
  // word reads best in their language.
  const titleNode = useMemo(() => {
    const full = intl.formatMessage({ id: 'account.language_modal_title' })
    const emphasis = intl.formatMessage({ id: 'account.language_modal_title_emphasis' })
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

  const currentLanguage = user ? resolveTranslationLocale(user.language) : null

  // Focus the active row when the modal opens so keyboard navigation
  // starts from the user's current language. The IonModal animation
  // takes ~300ms — defer the focus call until after it settles or the
  // browser swallows it (focus on a transitioning element is a no-op
  // on iOS Safari). 320ms matches the IonModal default enter duration.
  useEffect(() => {
    if (!isOpen) return
    const timeout = window.setTimeout(() => {
      activeButtonRef.current?.focus()
    }, 320)
    return () => window.clearTimeout(timeout)
  }, [isOpen])

  if (!user) return null

  const handlePick = (locale: SupportedLocale) => {
    if (locale !== currentLanguage) {
      void changeLanguage(locale)
    }
    onClose()
  }

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={intl.formatMessage({ id: 'account.row_language' })}
      noSwipeDismiss
    >
      <header className="modal-hero language-modal__intro">
        <div className="modal-hero__eyebrow">
          {intl.formatMessage({ id: 'account.language_modal_eyebrow' })}
        </div>
        <h1 className="modal-hero__title">{titleNode}</h1>
        <p className="modal-hero__subtitle">
          {intl.formatMessage({ id: 'account.language_modal_subtitle' })}
        </p>
      </header>

      <ul
        className="language-modal__list"
        role="radiogroup"
        aria-label={intl.formatMessage({ id: 'account.row_language' })}
      >
        {SUPPORTED_LOCALES.map((locale) => {
          const isActive = locale === currentLanguage
          const flag = FLAGS[locale]
          return (
            <li key={locale} className="language-modal__list-item">
              <button
                ref={isActive ? activeButtonRef : undefined}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => handlePick(locale)}
                className={`language-modal__card ${isActive ? 'is-active' : ''}`}
              >
                <span className="language-modal__stamp" aria-hidden="true">
                  {flag ? (
                    <span className="language-modal__flag">{flag}</span>
                  ) : (
                    <Globe className="language-modal__globe" />
                  )}
                </span>
                <span className="language-modal__meta">
                  <span className="language-modal__name">
                    {LOCALES[locale].label}
                  </span>
                  <span className="language-modal__code">
                    {formatLocaleCode(locale)}
                  </span>
                </span>
                <span className="language-modal__status" aria-hidden="true">
                  {isActive ? (
                    <span className="language-modal__status-tag">
                      {intl.formatMessage({ id: 'account.language_modal_active' })}
                    </span>
                  ) : (
                    <span className="language-modal__status-dot" />
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <p className="language-modal__footnote">
        {intl.formatMessage({ id: 'account.language_modal_footnote' })}
      </p>
    </ModalShell>
  )
}
