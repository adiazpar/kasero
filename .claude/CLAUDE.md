# Kasero

A multi-business management system for small businesses (food vendors, artisans, retailers). Built for speed, simplicity, and offline capability.

## Architecture

npm-workspaces monorepo. Frontend (`apps/web/`) is a Vite + React + Ionic SPA using `@ionic/react-router` (react-router v5) for stack-based mobile-feeling navigation. Backend (`apps/api/`) is Next.js running in API-only mode — 55 routes, Drizzle/Turso/JWT. Shared code (Drizzle schema, types, Zod schemas, `ApiMessageCode`, business-role helpers, locale registry) lives in `packages/shared/` and is consumed by both apps via TS project references. In production, `apps/api/scripts/prepare-spa.mjs` copies the built SPA into `apps/api/public/`, so a single Next.js deployment serves both `/api/*` and the SPA shell from one origin. In development, API runs on `8000` and Vite on `3000` with `/api/*` proxied. Same-origin in both environments — no CORS, cookies work natively.

## Documentation

All project documentation lives in `.claude/docs/`. The `.claude/` directory is tracked in git, so doc edits, plans, and `CLAUDE.md` updates are all committed alongside code changes.

**Superpowers skills location override**: design specs, implementation plans, and any other spec/plan artifacts produced by superpowers skills go to `.claude/docs/plans/YYYY-MM-DD-<topic>-<kind>.md` — NOT the skills' defaults.

**Guides** (read before building features that touch these areas):

| Guide | Read before |
|---|---|
| `.claude/docs/tech-stack.md` | Stack decisions, repo layout, project tree, **database schema** (tables/timestamps/indexes), environment variables, Vercel deployment, per-app commands |
| `.claude/docs/i18n-system.md` | Wrapping any string, adding any API route, handling `ApiError` in a hook |
| `.claude/docs/backend-patterns.md` | API routes, auth, validation, rate limiting, offline envelope handling, **full route index** |
| `.claude/docs/performance-patterns.md` | Optimistic UI, access caching, sessionStorage SWR, icon uploads, IonTabs persistence, Workbox SW, online/offline detection, navigation feedback |
| `.claude/docs/modal-system.md` | Modal compound component API, rules, patterns |
| `.claude/docs/tab-system.md` | `TabContainer` in-page sub-tabs primitive (top-level shell is Ionic `IonTabs`) |
| `.claude/docs/ai-product-pipeline.md` | AI snap-to-add pipeline |
| `.claude/docs/barcode-system.md` | Barcode identifiers, cascade, scanner, live camera, validation, rendering |

## Critical rules

### No emojis

No emojis in code, comments, UI, or commits. Commit messages are clean and human-readable; never include `Co-Authored-By: Claude ...` or any trailer indicating Claude co-authorship.

### CSS variables

All styling uses CSS variables. Brand tokens live in `apps/web/src/styles/base.css`; the Ionic theming bridge in `apps/web/src/styles/ionic-theme.css` maps them to `--ion-*` variables so Ionic primitives inherit the brand palette automatically. Never hardcode colors.

```css
/* Right */  color: var(--color-text-primary);
/* Wrong */  color: #1E293B;
```

### i18n — the 7 rules for new code

**MUST READ before wrapping strings, adding routes, or handling errors:** `.claude/docs/i18n-system.md`.

Kasero is fully internationalized with `react-intl` (English, Spanish, Japanese — see `packages/shared/src/locales.ts`). Every user-visible string — in components and in API route responses — must be translatable. Language is a user preference (`users.language`); formatting is a business property (`businesses.locale` / `businesses.currency`). Never conflate the two.

1. **Every new UI string goes through `intl.formatMessage({ id })`.** No exceptions. JSX with hardcoded English is a bug.
2. **Every new API route returns an `ApiMessageCode` envelope.** Use `errorResponse()` / `successResponse()` / `validationError()` from `@/lib/api-middleware`. Never write `NextResponse.json({ error: 'English' })`.
3. **Every new key lands in `en-US.json` first**, then add the **real translation** for every other registered locale (`es.json`, `ja.json`, …) directly — no English placeholders, do **not** run `npm run i18n:translate` for existing locales. After adding the keys, regenerate `apps/web/src/i18n/messageIds.d.ts` via `npm run i18n:types --workspace=apps/web`.
4. **Every new Zod schema uses the generic issue mapper.** Don't add `.min(n, 'custom message')` — it becomes dead code. For `.refine()`, use `{ params: { apiMessageCode: 'YOUR_CODE' } }`.
5. **Every hook that catches `ApiError` translates via `useApiMessage`**, with a fallback to a local `intl.formatMessage({ id: 'error_...' })` for non-envelope failures.
6. **Never hardcode `'en-US'` or `'USD'` in component code.** Use `useBusinessFormat()` for formatting and `useIntl()` for strings.
7. **Never translate user-entered content.** Product names, category names, business names, user names, emails, notes, invite codes — rendered verbatim via `{value}`, always.

### Locale-aware formatting

Every business has `locale` (e.g. `'en-US'`, `'es-PE'`) and `currency` (e.g. `'USD'`, `'PEN'`). In components, always use the hook:

```tsx
import { useBusinessFormat } from '@/hooks/useBusinessFormat'

const { formatCurrency, formatDate, formatTime } = useBusinessFormat()
formatCurrency(9.99)   // "$9.99" for en-US/USD, "S/ 9.99" for es-PE/PEN
```

For price inputs, use `<PriceInput>` from `@/components/ui`. Full details in `backend-patterns.md`.

### Modals

See `.claude/docs/modal-system.md` before building any modal. Key rules:

- `Modal.Step` and `Modal.Footer` must be **direct children** (no wrapper components).
- Separate add/edit into different modals (never combine with conditional rendering).
- Clean up state in `onExitComplete`, never in `onClose`.
- Use optimistic UI for success steps (navigate before API call).

### Navigation

Every UI route is a `<Route>` rendering an `IonPage` inside an `IonRouterOutlet`. The 4 business-context bottom tabs live inside `BusinessTabsLayout`'s `IonTabs`. Drill-downs push via `useIonRouter().push()` / `<IonRouterLink>`. `IonRouterOutlet` owns stack animations, peel-back, parallax, scroll preservation — don't reimplement. Details in `tech-stack.md` and `tab-system.md`.

### Code standards

- TypeScript strict mode.
- Validate inputs with Zod.
- Co-locate shared types in `packages/shared/src/types/` so both apps consume the same definition.

### Content Security Policy

The prod CSP lives in `apps/api/next.config.js` under the `headers()` callback. It is currently shipped as `Content-Security-Policy-Report-Only` but the stated plan is to flip to enforcing once the report stream is clean — so **any new violation is a real bug**, not just console noise. Walk the affected page in prod after merging and confirm DevTools → Console is clean.

Whenever you introduce a resource that the browser fetches from a new origin or scheme, update the matching directive in the same PR. Quick map:

| You add… | Directive to update |
|---|---|
| External `<script src>` or worker | `script-src` |
| External `<link rel="stylesheet">` or `@import` | `style-src` |
| Inline `<style>` / `style=""` (only when truly unavoidable) | already covered by `'unsafe-inline'`; prefer CSS variables instead |
| `<link rel="preconnect">` / `<link rel="dns-prefetch">` to a new origin | `connect-src` (preconnect/preload also needs the matching resource directive) |
| `<img>` / `background-image` from a new origin, `data:`, `blob:` | `img-src` |
| `@font-face` URL or Google Fonts `.woff2` | `font-src` |
| `fetch()` / `XMLHttpRequest` / `WebSocket` / `EventSource` to a new origin | `connect-src` |
| `<iframe>` or embedded frame | `frame-src` and `child-src` |
| `<audio>` / `<video>` / `<track>` from a new origin | `media-src` |
| Web Worker / Service Worker script | `worker-src` (falls back to `script-src`) |
| `<form action="…">` posting to a new origin | `form-action` |

Prefer self-hosting assets where practical (smaller attack surface, no third-party origin needed); only widen the policy when a third-party origin is genuinely required, and never widen to `*` or unrestricted wildcards. If you need an inline script for boot-critical work (e.g. the theme-init in `apps/web/index.html`), prefer moving it to `/public/*.js` over expanding `'unsafe-inline'` further.

**Service worker gotcha.** The Workbox runtime routes in `apps/web/src/pwa/sw.ts` (`StaleWhileRevalidate` for scripts/styles, `CacheFirst` for images) must be scoped to same-origin via `url.origin === self.location.origin`. When the SW intercepts a cross-origin resource and calls `fetch()` to populate its cache, that fetch runs in worker-script context, so CSP evaluates it against `connect-src` — not `script-src` / `style-src` / `img-src`. A cross-origin font/script/image routed through the SW will violate `connect-src` even after you correctly widen the natural directive. Keep runtime routes same-origin; let the browser fetch cross-origin resources directly.

## Commands (from repo root)

| Command | Description |
|---------|-------------|
| `npm run dev` | Starts both servers in parallel. API on `8000`, web on `3000`. |
| `npm run build` | Builds both apps (`build:api` then `build:web`). |
| `npm run lint` | Runs lint in every workspace. |
| `npm run test` | Runs tests in every workspace. |

Per-app scripts (`db:push`, `db:push:prod`, `db:studio`, `start:local`, `i18n:translate`, `splash:generate`, etc.) are documented in `tech-stack.md`.
