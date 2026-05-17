# i18n System

Kasero is fully internationalized with `react-intl` (`@formatjs/intl-react`). Every user-visible string in the app — whether rendered by a component or emitted from an API route — flows through a single translation layer. The set of supported languages is driven by a single registry at `packages/shared/src/locales.ts`. Currently registered: English (`en-US`, source of truth), Spanish (`es`), Japanese (`ja`). This doc is the reference for writing new code in a way that stays compatible with that layer, and for adding new languages without touching the rest of the app.

**Read this before**: wrapping any new string, adding a new API route, adding a new Zod schema, catching `ApiError` in a hook, or touching anything under `apps/web/src/i18n/`, `packages/shared/src/api-messages.ts`, `apps/api/src/lib/api-middleware.ts`, or `apps/api/scripts/i18n-translate.ts`.

---

## Architecture at a glance

```
+-------------------------------------------------------------------+
|                       CLIENT (apps/web/)                          |
|                                                                   |
|  UI COMPONENTS         -->   useIntl().formatMessage({ id })      |
|                                                                   |
|  API ERROR HANDLERS    -->   useApiMessage() reads err.envelope   |
|                                                                   |
|  BUSINESS FORMATTING   -->   useBusinessFormat() for $/dates      |
|         |                          (uses business.locale)         |
|         |                                                         |
|         v                                                         |
|  IntlProvider resolves locale, dynamically imports messages JSON  |
|                                                                   |
+--------+----------------------------------------------------------+
         |
         | HTTP (envelopes: { messageCode, messageVars? })
         |
+--------v----------------------------------------------------------+
|                       SERVER (apps/api/)                          |
|                                                                   |
|  API ROUTES         -->  errorResponse() / successResponse()      |
|                          validationError() for Zod failures       |
|                                                                   |
|  ZOD SCHEMAS        -->  Issue mapper translates to codes         |
|                                                                   |
|  api-messages.ts    -->  ApiMessageCode union                     |
|        (lives in packages/shared/, both apps import it)           |
|                                                                   |
+-------------------------------------------------------------------+
```

**The core rule**: strings are a display concern. They live in one place: `apps/web/src/i18n/messages/en-US.json` (the source of truth) and its locale mirrors. The server emits **codes**; the client emits **strings**. This separation is what makes the system work — if you break it, you reintroduce language leaks.

**Language vs formatting**: language (which words appear) is a user preference stored in `users.language`. Formatting (how numbers, dates, and currencies are rendered) is a business property via `businesses.locale` and `businesses.currency`. A Spanish-speaking user viewing a US business sees Spanish UI with USD-formatted prices. Never conflate the two. Use `useBusinessFormat()` for formatting and `useIntl()` for strings.

---

## Key files

| File | Purpose |
|---|---|
| `packages/shared/src/locales.ts` | **Locale registry — single source of truth for adding a new language.** Defines `LOCALES` (label, accept-prefixes, translate metadata), and exports `SUPPORTED_LOCALES`, `DEFAULT_LOCALE`, `SupportedLocale`, `getLocaleConfig()`, `resolveLocaleByPrefix()`. |
| `apps/web/src/i18n/messages/en-US.json` | **Source of truth for strings.** Every new key lands here first. Flat dot-keys. |
| `apps/web/src/i18n/messages/<locale>.json` | One file per registered locale (e.g. `es.json`, `ja.json`). Edit directly when adding new keys to an existing locale. The translate script is reserved for bootstrapping a brand-new locale. |
| `apps/web/src/i18n/AppIntlProvider.tsx` | `<AppIntlProvider>` — wraps the app, resolves locale from `user.language` → browser Accept-Language → `en-US`, dynamically imports the matching messages JSON. |
| `apps/web/src/i18n/loadMessages.ts` | `loadMessages(locale)` — `import()`-based dynamic loader; one JSON per locale, code-split. |
| `apps/web/src/i18n/messageIds.d.ts` | **Generated** type union of all valid message ids. Typos become compile errors. |
| `apps/api/src/lib/accept-language.ts` | Header/Navigator parser used as a fallback when `user.language` isn't yet available. Iterates the registry's `acceptPrefixes` — automatically picks up new locales. |
| `packages/shared/src/api-messages.ts` | **`ApiMessageCode` union** — every server-emitted message code, plus the `ApiMessageEnvelope` shape and the `hasMessageEnvelope` type guard. |
| `apps/api/src/lib/api-middleware.ts` | `errorResponse()`, `successResponse()`, `validationError()`, Zod issue mapper |
| `apps/web/src/lib/api-client.ts` | `ApiError` class — carries `messageCode` + `messageVars` from server responses |
| `apps/web/src/hooks/useApiMessage.ts` | Client hook: translates an envelope into a localized string |
| `apps/web/src/hooks/useBusinessFormat.ts` | Client hook: currency / date / time formatting (NOT translation) |
| `apps/api/scripts/i18n-translate.ts` | CLI translator, uses the Claude API to fill `<locale>.json`. Reserved for bootstrapping a brand-new locale (seed file is byte-identical to `en-US.json`, the script translates the whole tree at once). **Do not** use it to backfill new keys into existing locales — translate those by hand alongside the en-US entry. Run as `npm run i18n:translate --workspace=apps/api`. |

---

## Adding UI strings (components)

Every component is a client component (the SPA has no SSR). Use the `useIntl` hook:

```tsx
import { useIntl } from 'react-intl'

export function SaveButton() {
  const intl = useIntl()
  return <button>{intl.formatMessage({ id: 'myFeature.save_button' })}</button>
}
```

For surfaces that touch many strings, destructure `formatMessage` once:

```tsx
const { formatMessage } = useIntl()

return (
  <form>
    <label>{formatMessage({ id: 'productForm.name_label' })}</label>
    <button>{formatMessage({ id: 'common.save' })}</button>
  </form>
)
```

If you need declarative JSX rendering (rare), the `<FormattedMessage id=... />` component is also available — but the hook is the canonical pattern.

### Workflow for adding a new key

1. Decide the namespace prefix. Use an existing prefix if the string belongs to the same feature domain (e.g. `productForm.`, `hub.`, `common.`). Add a new top-level prefix only if it's a brand new feature area.
2. Add the key to `apps/web/src/i18n/messages/en-US.json` as a flat dot-key (`"productForm.name_label": "Name"`). Write the English value directly — no placeholder.
3. Add the key to **every other** `apps/web/src/i18n/messages/<locale>.json` (currently `es.json` and `ja.json`) with the **real translation** in that language. No English placeholders, no follow-up script run. Preserve ICU `{variable}` tokens and `<em>` / other HTML-like tags verbatim. The per-locale tone rules (Spanish: usted form, Latin American POS vocabulary; Japanese: desu/masu polite form, Japanese punctuation) are documented in the `translate.guidance` blocks in `packages/shared/src/locales.ts` — match that voice.
4. Use the key in your component via `intl.formatMessage({ id: 'productForm.name_label' })`. TypeScript will fail the build if you typo it, because `apps/web/src/i18n/messageIds.d.ts` types the union of valid ids.
5. Regenerate the types: `npm run i18n:types --workspace=apps/web`. The `predev`/`prebuild` hooks also do this, but run it explicitly after editing the JSON so the next typecheck sees the new ids.

> **Do not** run `npm run i18n:translate` after adding individual keys to existing locales. That script is reserved for the one-time bootstrap of a brand-new locale (see "Adding a new language" below).

### Naming conventions

- **Keys**: `feature.snake_case_id` (e.g. `productForm.name_label`, `common.delete_confirm_title`).
- **Top-level prefixes**: `camelCase` (`createBusiness.`, `productForm.`, `apiMessages.`).
- **Group by feature, not by string type**. Write `productForm.name_label`, not `labels.name`. This keeps keys discoverable and matches how the UI is organized.

### ICU interpolation

Use ICU MessageFormat `{variable}` syntax for dynamic content. Pluralization is built in:

```jsonc
{
  "common.greeting": "Hello {name}",
  "products.item_count": "{count, plural, one {# item} other {# items}}",
  "products.delete_confirm": "Are you sure you want to delete <b>{name}</b>?"
}
```

```tsx
intl.formatMessage({ id: 'common.greeting' }, { name: user.name })
intl.formatMessage({ id: 'products.item_count' }, { count: items.length })

// Rich text (HTML-like tags) takes a renderer map as the second argument
intl.formatMessage(
  { id: 'products.delete_confirm' },
  {
    name: product.name,
    b: (chunks) => <strong>{chunks}</strong>,
  },
)
```

**Never translate placeholder tokens.** `{name}` must stay `{name}` in every language. The translate script validates this at runtime.

---

## Adding API routes (server)

**Every API route response body must emit an `ApiMessageCode` envelope.** Raw English strings in `error` or `message` fields are forbidden in new code.

### Full route template

```ts
import { NextRequest } from 'next/server'
import { errorResponse, successResponse, validationError } from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { z } from 'zod'

const schema = z.object({
  name: z.string().min(2),  // no custom message -- let the mapper handle it
  quantity: z.number().int().positive(),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const validation = schema.safeParse(body)
    if (!validation.success) {
      return validationError(validation)  // -> VALIDATION_STRING_TOO_SHORT etc.
    }

    const { name, quantity } = validation.data

    const existing = await db.select().from(items).where(...).get()
    if (existing) {
      return errorResponse(ApiMessageCode.ITEM_ALREADY_EXISTS, 400)
    }

    const [newItem] = await db.insert(items).values({ name, quantity }).returning()

    return successResponse({ item: newItem }, ApiMessageCode.ITEM_CREATED)
  } catch (err) {
    console.error('Create item error:', err)
    return errorResponse(ApiMessageCode.INTERNAL_ERROR, 500)
  }
}
```

### The response helpers

| Helper | Signature | Purpose |
|---|---|---|
| `errorResponse(code, status, vars?)` | Build a `{ messageCode, messageVars? }` body with the given HTTP status. For every failure path. |
| `successResponse(data, code?, vars?)` | Merge route data with an optional message code. For every success path. Also includes `success: true` for legacy consumer compat. |
| `validationError(result)` | Take a failed Zod `safeParse` result and convert the first issue into an envelope. For every request-body validation. |

### Wire format

```jsonc
// Error (no vars)
{ "messageCode": "PRODUCT_NOT_FOUND" }

// Error with interpolation variables
{ "messageCode": "VALIDATION_STRING_TOO_SHORT", "messageVars": { "min": 2 } }

// Success (just data, no toast)
{ "products": [...], "success": true }

// Success with a toast / feedback code
{ "product": {...}, "messageCode": "PRODUCT_CREATED", "success": true }

// Error with additional structured data (e.g. a blocking order id)
{ "messageCode": "PRODUCT_PENDING_ORDER_BLOCK", "blockingOrderId": "abc123" }
```

The client's `ApiError` class extracts `messageCode` and `messageVars` automatically, and the `useApiMessage` hook translates them.

### Adding a new `ApiMessageCode`

1. Add the code to the union in `packages/shared/src/api-messages.ts`. Use `UPPER_SNAKE`, group with related codes under the domain comment header (Auth, Products, Barcode, Categories, Orders, Providers, Team, Invite, Transfer, Business, AI, HEIC, etc.).
2. Add a corresponding key to the `apiMessages.` namespace in `apps/web/src/i18n/messages/en-US.json` — the key is the lowercase version of the code (e.g. `PRODUCT_CREATED` → `apiMessages.product_created`).
3. Add the key in **every** non-English locale file (`es.json`, `ja.json`, …) with the **real translation** — no English placeholders, no follow-up script run.
4. Use the code in your route via `ApiMessageCode.YOUR_CODE`.
5. Regenerate `apps/web/src/i18n/messageIds.d.ts` via `npm run i18n:types --workspace=apps/web` so the new id flows into the type union.

**Generic codes that cross domains** — `RATE_LIMITED`, `REQUEST_TOO_LARGE`, `REQUEST_LENGTH_REQUIRED`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `INTERNAL_ERROR` — are emitted by the middleware helpers (`applyRateLimit`, `enforceMaxContentLength`, `withBusinessAuth`, `withAuth`). They're already in the union + JSON and shouldn't need to be added per-route.

### Zod schemas

**Don't write custom error messages.** The `validationError()` helper reads Zod issue codes and maps them to generic `VALIDATION_*` codes automatically. Writing `.min(2, 'Must be at least 2')` is dead code.

```ts
// Right
z.object({
  name: z.string().min(2),
  email: z.email(),
  age: z.number().int().min(18),
})

// Wrong - the English message is unreachable
z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
})
```

**The mapper handles:**

| Zod issue | Maps to |
|---|---|
| `too_small` + `origin: 'string'` | `VALIDATION_STRING_TOO_SHORT` with `{ min }` |
| `too_small` + `origin: 'number'` | `VALIDATION_NUMBER_TOO_SMALL` with `{ min }` |
| `too_big` + `origin: 'string'` | `VALIDATION_STRING_TOO_LONG` with `{ max }` |
| `too_big` + `origin: 'number'` | `VALIDATION_NUMBER_TOO_LARGE` with `{ max }` |
| `invalid_format` + `format: 'email'` | `VALIDATION_INVALID_EMAIL` |
| `invalid_format` (other) | `VALIDATION_INVALID_FORMAT` |
| `invalid_type` with undefined input | `VALIDATION_REQUIRED` |
| `invalid_type` (other) | `VALIDATION_INVALID_TYPE` |
| Anything else | `VALIDATION_GENERIC` |

**Extending the mapper**: if you add a new Zod constraint that the mapper doesn't handle, add a branch to `mapZodIssueToEnvelope()` in `apps/api/src/lib/api-middleware.ts` and a corresponding `VALIDATION_*` code to the union in `packages/shared/src/api-messages.ts`.

### Custom `.refine()` errors

Refines produce Zod issues with `code: 'custom'`. The mapper reads `issue.params.apiMessageCode` and uses it directly. Any refine can emit any code:

```ts
z.string().refine(
  (val) => isValidSomething(val),
  { params: { apiMessageCode: 'MY_CUSTOM_CODE' } }
)
```

First add `MY_CUSTOM_CODE` to the `ApiMessageCode` union and its translation key to `apiMessages`, then use it in the refine. The current example in the codebase is `BUSINESS_ICON_INVALID` in `Schemas.businessIcon()` in `apps/api/src/lib/schemas.ts` — copy that pattern.

---

## Locale resolution (client)

The SPA resolves the active locale once at IntlProvider mount and re-resolves whenever the authenticated user's language preference changes:

```tsx
function AppIntlProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const locale = useMemo(
    () => user?.language ?? matchBrowserLocale(LOCALES) ?? 'en-US',
    [user?.language],
  )
  const messages = useMessages(locale)  // dynamic import per locale → code-split
  return (
    <IntlProvider locale={locale} messages={messages} defaultLocale="en-US">
      {children}
    </IntlProvider>
  )
}
```

**Resolution chain:**
1. `user.language` (set in `users.language` via `PATCH /api/user/language`).
2. Browser `navigator.language` / Accept-Language header for first-time anonymous visitors.
3. `en-US` fallback.

**No cookies, no server-side resolution** — the SPA is fully client-rendered, so `react-intl`'s built-in `<IntlProvider>` is enough. The `kasero-locale` cookie that previously existed for `next-intl` is gone.

---

## Handling API errors in hooks and components

When a client hook or component catches an `ApiError` from `apiRequest` / `apiPost` / etc., check `err.envelope` first and translate via `useApiMessage`. Provide a local fallback id for non-envelope failures (network errors, legacy routes during migrations).

### Hook pattern

```tsx
import { ApiError } from '@/lib/api-client'
import { useApiMessage } from '@/hooks/useApiMessage'
import { useIntl } from 'react-intl'

export function useMyFeature() {
  const intl = useIntl()
  const translateApiMessage = useApiMessage()
  const [error, setError] = useState('')

  const handleAction = useCallback(async () => {
    try {
      await apiPost(`/api/.../something`, payload)
    } catch (err) {
      console.error('Action failed:', err)
      setError(
        err instanceof ApiError && err.envelope
          ? translateApiMessage(err.envelope)
          : intl.formatMessage({ id: 'myFeature.error_generic_fallback' })
      )
    }
  }, [intl, translateApiMessage])

  return { error, handleAction }
}
```

`translateApiMessage` and `intl` go into the `useCallback` dep array.

### Direct `fetch()` pattern (when you can't use `apiRequest`)

Some routes return `{ success: false, messageCode: ... }` with a 200 status (for example, invite validation where "invalid code" is a logical outcome, not an error). For these, use `hasMessageEnvelope` to inspect the body inline:

```tsx
import { hasMessageEnvelope } from '@kasero/shared/api-messages'

const response = await fetch('/api/invite/validate', { ... })
const data = await response.json()

if (!data.success) {
  setError(
    hasMessageEnvelope(data)
      ? translateApiMessage(data)
      : intl.formatMessage({ id: 'myFeature.error_generic_fallback' })
  )
  return
}
```

---

## What NEVER gets translated

These are **data**, not UI copy. They are rendered verbatim in every language. This is the single most important rule in this doc.

- **User-entered content**: product names, category names, provider names, business names, user names, email addresses, phone numbers, notes, invite codes, transfer codes. Rendered as `{value}` in JSX.
- **Enum values**: `'pending'`, `'received'`, `'owner'`, `'partner'`, `'employee'`, `'active'`, `'disabled'`. These are identifiers, not UI text. When the UI needs a human label, build a map at the call site: `{ pending: intl.formatMessage({ id: 'orders.status_pending' }), received: intl.formatMessage({ id: 'orders.status_received' }) }`.
- **Brand name**: `"Kasero"` is never translated. The translate script's system prompt explicitly forbids it.
- **Route paths, CSS class names, `data-*` attributes, HTML element variants** (`'primary'`, `'secondary'`).
- **Sort option keys** (`'name_asc'`, `'price_desc'`, etc.) and similar structural constants. Translate the label at the call site via a map.
- **Zod schema error messages** — `validationError()` handles them.
- **Console.log / console.error** — developer-facing, never shown to users.
- **PWA manifest strings, marketing / SEO meta tags** — left as English forever.

If you catch yourself thinking "maybe I should translate this product name" — stop. The answer is no.

---

## Translate script

**Reserved for bootstrapping a brand-new locale.** When adding individual keys to existing locales (`es.json`, `ja.json`, …), translate them by hand alongside the en-US entry — see "Workflow for adding a new key" above. Do not use the script as a backfill mechanism for new keys, because (a) the per-key tone tends to drift away from existing strings in the same domain, (b) every batched run costs API credits the workflow doesn't need to spend, and (c) you lose the alignment-pass moment where you would have caught wording issues in en-US before they were echoed into every other locale.

The translate script at `apps/api/scripts/i18n-translate.ts` generates locale mirrors from `en-US.json` via the Claude API. Run it from `apps/api/`, only when seeding a brand-new locale file.

```bash
# Bootstrap a freshly-seeded locale (file must exist; see "Adding a new language" below)
npm run i18n:translate -- --target pt

# Dry run (print pending keys without hitting the API)
npm run i18n:translate -- --dry-run --target pt

# Only a single namespace prefix (for incremental testing during bootstrap)
npm run i18n:translate -- --target pt --only productForm

# Force retranslate everything (overwrites manual tweaks — rarely the right call on an established locale)
npm run i18n:translate -- --target pt --force

# Change the batch size or model
npm run i18n:translate -- --target pt --batch-size 25
npm run i18n:translate -- --target pt --model claude-opus-4-6
```

**Requires `ANTHROPIC_API_KEY` in `apps/api/.env.local`.** The script runs locally and is never invoked in production. The output (`<locale>.json`, e.g. `es.json` / `ja.json`) is committed to the repo and served by Vite.

**Idempotent**: keys whose target value already differs from the English source are skipped. This makes the bootstrap re-runnable mid-flight if a network blip kills a batch, without retranslation cost or overwriting your manual edits.

**Style guide**: the script's system prompt is built from the per-locale `translate.guidance` block in `packages/shared/src/locales.ts`. Hard rules (preserve ICU placeholders, preserve HTML-like tags, do not translate "Kasero", do not translate enum identifiers, no trailing punctuation where the source has none) are baked into `buildSystemPrompt()` and apply to every locale. Locale-specific rules (form-of-address, anglicism traps, market-specific vocabulary, punctuation conventions) live in the registry — for example, the Spanish entry enforces usted form and Latin American POS vocabulary; the Japanese entry enforces desu/masu polite form, kanji-where-natural, and Japanese punctuation discipline. See `buildSystemPrompt()` in `apps/api/scripts/i18n-translate.ts` and the `translate.guidance` blocks in `packages/shared/src/locales.ts` for the full prompt.

**Cost**: ~$0.05–$0.50 per full run depending on the model and the number of pending keys. Sonnet 4.5 is the default and is more than sufficient for UI translation.

### Flat-key handling

The script operates on flat-key JSON files (`"hub.empty_state_title": "..."`). Internally it groups keys by their first prefix segment for the `--only <prefix>` filter and for batching, but the on-disk format stays flat.

---

## Adding a new language

Adding a language touches **one file** plus two CLI commands. Everything else (the registry-derived constants, the Accept-Language picker, the business-locale resolver, the language-row label, the translate-script system prompt) derives from the locale registry.

1. **Add an entry to `LOCALES`** in `packages/shared/src/locales.ts`:
   ```ts
   pt: {
     label: 'Português',
     acceptPrefixes: ['pt'],
     translate: {
       name: 'Portuguese',
       guidance: `Portuguese-specific rules:
   - Use Brazilian Portuguese (pt-BR) as the default dialect.
   - Use the "voce" form for user-facing copy.
   - ... (anglicism traps, market-specific vocabulary, punctuation conventions)`,
     },
   },
   ```
   The `acceptPrefixes` are the BCP-47 base codes that should resolve to this locale (`['en']` for `en-US` so `en-GB` / `en-AU` also resolve there; `['es']` so all Spanish variants collapse to `es`). The `translate.guidance` block is injected verbatim into the translate script's system prompt — keep it focused on form-of-address, vocabulary preferences, punctuation conventions, and common anglicism traps.

2. **Seed the messages file** by copying `en-US.json`:
   ```bash
   cp apps/web/src/i18n/messages/en-US.json apps/web/src/i18n/messages/pt.json
   ```

3. **Run the translate script** (from `apps/api/`):
   ```bash
   npm run i18n:translate -- --target pt
   ```

That's it. No edits to `AppIntlProvider.tsx`, `accept-language.ts`, `LanguageRow.tsx`, or `i18n-translate.ts` are needed — they all read from the registry.

### Test fixtures

The `accept-language.test.ts` file uses `zz` / `xx` (ISO 639-1 reserved/unassigned codes) for fallback assertions, **never** real ISO codes that might one day become supported. Adding a new locale therefore does not invalidate any existing test. If you want to document the new locale's variant collapse explicitly, add a small variant test (see the existing `'collapses all Japanese variants to ja'` test for the pattern); otherwise the registry-driven resolution is already covered by the existing prefix-match assertions.

### Spot-check

Use the in-app language picker to switch to the new locale, or set `users.language` directly in dev DB for your test account. Walk through a few high-density screens (login, home, products, manage) to make sure punctuation, line lengths, and vocabulary feel right. The translate script's system prompt is a guide, not a guarantee — small touch-ups by hand are fine, and they survive future re-runs because the script's idempotency check skips any key whose target value differs from the English source.

---

## Daily development rules

These are the rules that matter for writing new code. They are the contract between the i18n system and the rest of the codebase.

1. **Every new UI string goes through `intl.formatMessage({ id })`.** No exceptions. If you're writing JSX and typing English text that isn't inside `{variable}`, you're wrong.
2. **Every new API route returns an `ApiMessageCode` envelope.** Use `errorResponse()` / `successResponse()` / `validationError()`. Never write `NextResponse.json({ error: 'English' })`.
3. **Every new key lands in `en-US.json` first**, then add the **real translation** for every other registered locale (`es.json`, `ja.json`, …) directly — no English placeholders, no follow-up script run. Match the per-locale voice documented in the `translate.guidance` blocks in `packages/shared/src/locales.ts`. Regenerate `messageIds.d.ts` via `npm run i18n:types --workspace=apps/web`. The translate script is reserved for bootstrapping a brand-new locale.
4. **Every new Zod schema uses the generic issue mapper.** Don't add `.min(n, 'custom message')` — it becomes dead code. If a `.refine()` needs a specific error, use `{ params: { apiMessageCode: 'YOUR_CODE' } }`.
5. **Every hook that catches `ApiError` translates via `useApiMessage`**, with a fallback to a local `intl.formatMessage({ id: 'myFeature.error_...' })` for non-envelope failures.
6. **Never hardcode `'en-US'` or `'USD'` in component code.** Use `useBusinessFormat()` for formatting and `useIntl()` for strings.
7. **Locale comes from `user.language` and the registry; never read it from a URL, prop, or literal string.** `<IntlProvider>` is the single source of truth at runtime.

---

## Common mistakes

**"I added `setError(err.message)` in my new hook."**
Stop. Use the `ApiError.envelope` + `useApiMessage` pattern. `err.message` only contains the legacy `data.error` string fallback, which is an empty generic string for envelope routes.

**"I wrote `return NextResponse.json({ error: 'Invalid input' }, { status: 400 })`."**
Use `errorResponse(ApiMessageCode.VALIDATION_GENERIC, 400)` instead. Or better yet, let Zod handle the validation and call `validationError(result)` which produces a more specific code.

**"I added `.min(2, 'Name is too short')` to my new Zod schema."**
The custom message is dead code — the mapper produces `VALIDATION_STRING_TOO_SHORT` automatically. Drop the second argument.

**"I'm rendering `{category.name}` in a component and want it translated."**
Don't. `category.name` is user-entered data. The user typed that name when they created the category. Spanish users typing "Bebidas" see "Bebidas", English users typing "Drinks" see "Drinks". Translating it would corrupt user input.

**"My enum value renders as `pending` in Spanish."**
Enums are identifiers, not strings. Build a map at the call site:
```tsx
const statusLabels: Record<OrderStatus, string> = {
  pending: intl.formatMessage({ id: 'orders.status_pending' }),
  received: intl.formatMessage({ id: 'orders.status_received' }),
}
return <span>{statusLabels[order.status]}</span>
```

**"I added a new key and only wrote the English version."**
The key renders as its English source in every other locale because each `<locale>.json` is missing it (or kept as a byte-identical copy of the English). For existing locales (`es.json`, `ja.json`, …) add the real translation by hand alongside the en-US entry — do not reach for the translate script. The script is reserved for bootstrapping a brand-new locale; backfilling new keys through it tends to drift the tone away from existing strings in the same domain.

**"I used `useTranslations('hub')` and got a TypeScript error."**
That was the `next-intl` API, which is no longer in the codebase. Use `useIntl()` from `react-intl` and call `intl.formatMessage({ id: 'hub.<key>' })` with the full dot-key id.

**"The translate script failed with a JSON parse error."**
Claude occasionally wraps JSON in markdown fences. The script strips them before parsing and retries up to 3 times. If it consistently fails on a specific batch, try `--batch-size 25` to isolate the problem, or `--model claude-opus-4-6` for more reliable JSON output.

**"I see `success: true` in my new API response but it feels redundant."**
It is. `successResponse()` adds it for backwards compat with ~13 consumer sites that check `!data.success`. A future cleanup pass will migrate consumers to `response.ok` checks and drop the field. For now, ignore it.
