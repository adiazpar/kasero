/**
 * Server-side i18n for transactional emails. Loads the same JSON bundles
 * the SPA uses (apps/web/src/i18n/messages/) so subject lines and body
 * copy stay in lockstep with the in-app translations. The browser path
 * uses react-intl with full ICU; servers only need simple {placeholder}
 * interpolation for these short strings, so this module ships a small
 * dependency-free interpolator instead of pulling react-intl onto the
 * server runtime.
 *
 * Bundles are loaded via static JSON imports so the Next.js bundler can
 * inline them into the server chunk at build time. A previous version
 * used readFileSync with a path derived from import.meta.url; that
 * worked in dev and vitest but broke in production because the bundled
 * function chunks live under .next/server/ and have no relative access
 * to apps/web/src/i18n/messages/.
 */
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from '@kasero/shared/locales'

import de from '../../../web/src/i18n/messages/de.json' with { type: 'json' }
import enUS from '../../../web/src/i18n/messages/en-US.json' with { type: 'json' }
import es from '../../../web/src/i18n/messages/es.json' with { type: 'json' }
import fil from '../../../web/src/i18n/messages/fil.json' with { type: 'json' }
import fr from '../../../web/src/i18n/messages/fr.json' with { type: 'json' }
import it from '../../../web/src/i18n/messages/it.json' with { type: 'json' }
import ja from '../../../web/src/i18n/messages/ja.json' with { type: 'json' }
import ko from '../../../web/src/i18n/messages/ko.json' with { type: 'json' }
import pt from '../../../web/src/i18n/messages/pt.json' with { type: 'json' }
import vi from '../../../web/src/i18n/messages/vi.json' with { type: 'json' }
import zh from '../../../web/src/i18n/messages/zh.json' with { type: 'json' }

type MessageBundle = Record<string, string>

const bundles: Record<SupportedLocale, MessageBundle> = {
  'en-US': enUS as MessageBundle,
  es: es as MessageBundle,
  ja: ja as MessageBundle,
  de: de as MessageBundle,
  fil: fil as MessageBundle,
  fr: fr as MessageBundle,
  it: it as MessageBundle,
  ko: ko as MessageBundle,
  pt: pt as MessageBundle,
  vi: vi as MessageBundle,
  zh: zh as MessageBundle,
}

const PLACEHOLDER_RE = /\{(\w+)\}/g

function interpolate(template: string, values?: Record<string, string | number>): string {
  if (!values) return template
  return template.replace(PLACEHOLDER_RE, (match, key: string) => {
    const v = values[key]
    return v === undefined ? match : String(v)
  })
}

export interface ServerIntl {
  formatMessage(
    descriptor: { id: string },
    values?: Record<string, string | number>,
  ): string
}

export function getMessages(locale: SupportedLocale | string): ServerIntl {
  const resolved = (SUPPORTED_LOCALES as readonly string[]).includes(locale)
    ? (locale as SupportedLocale)
    : DEFAULT_LOCALE
  const primary = bundles[resolved]
  const fallback = bundles[DEFAULT_LOCALE]
  return {
    formatMessage(descriptor, values) {
      const template = primary[descriptor.id] ?? fallback[descriptor.id] ?? descriptor.id
      return interpolate(template, values)
    },
  }
}
