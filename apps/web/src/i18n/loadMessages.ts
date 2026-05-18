/**
 * Lazy locale-bundle loader.
 *
 * `react-intl` takes a flat `Record<string, string>` of messages. We split
 * the bundles per locale so the initial JS payload only carries the active
 * locale's strings; the rest are fetched on demand when the user changes
 * language.
 *
 * Vite needs a static analysis hook to know which JSON files to bundle, so
 * we enumerate every supported locale in an explicit `switch`. Adding a
 * new locale requires:
 *   1. Adding an entry in `packages/shared/src/locales.ts`.
 *   2. Adding the matching `<code>.json` file under `./messages/`.
 *   3. Adding a `case` here.
 *
 * The TypeScript exhaustiveness check at the bottom of the switch makes
 * step 3 a compile error rather than a silent runtime fallback.
 */

import type { SupportedLocale } from '@kasero/shared/locales'
// en-US is statically imported by AppIntlProvider for instant first paint.
// Reusing that bundle here keeps Vite from emitting an INEFFECTIVE_DYNAMIC_IMPORT
// warning AND avoids shipping the en-US strings twice.
import enUSMessages from './messages/en-US.json'

const cache = new Map<SupportedLocale, Record<string, string>>([
  ['en-US', enUSMessages],
])

export async function loadMessages(
  locale: SupportedLocale,
): Promise<Record<string, string>> {
  const cached = cache.get(locale)
  if (cached) return cached

  let mod: { default: Record<string, string> }
  switch (locale) {
    case 'en-US':
      // Already in the cache above; this branch is unreachable but
      // satisfies the exhaustiveness check.
      return enUSMessages
    case 'es':
      mod = await import('./messages/es.json')
      break
    case 'ja':
      mod = await import('./messages/ja.json')
      break
    case 'de':
      mod = await import('./messages/de.json')
      break
    case 'fil':
      mod = await import('./messages/fil.json')
      break
    case 'fr':
      mod = await import('./messages/fr.json')
      break
    case 'it':
      mod = await import('./messages/it.json')
      break
    case 'ko':
      mod = await import('./messages/ko.json')
      break
    case 'pt':
      mod = await import('./messages/pt.json')
      break
    case 'vi':
      mod = await import('./messages/vi.json')
      break
    case 'zh':
      mod = await import('./messages/zh.json')
      break
    default: {
      // If a new locale is registered without a corresponding case here,
      // TypeScript fails the build. Better than a runtime "missing
      // translation" cascade.
      const _exhaustive: never = locale
      throw new Error(`Unknown locale: ${String(_exhaustive)}`)
    }
  }
  cache.set(locale, mod.default)
  return mod.default
}
