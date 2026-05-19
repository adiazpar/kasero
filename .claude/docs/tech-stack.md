# Tech Stack

This document explains the technology choices for Kasero and the reasoning behind each decision.

## Overview

Kasero is a multi-business management system optimized for:
- **Zero monthly cost** - Free tier services only
- **Edge performance** - Fast globally via Vercel
- **Offline capability** - Works without internet (PWA)
- **Multi-tenant** - Supports multiple businesses in one database
- **Mobile-feeling navigation** - Native iOS-style stack navigation via Ionic

## Architecture

```
                        Vercel (single Next.js project)
                                  │
                                  ▼
                ┌─────────────────────────────────┐
                │  apps/api/  (Next.js, deployed) │
                │                                 │
                │  /api/*  ──> route.ts handlers  │
                │  /     ──> public/index.html    │
                │  /assets/*, /icons/*, /splash/* │
                │      └──> public/* (static)     │
                │  /<other>  ──> rewrites().      │
                │      fallback → /index.html     │
                │      (SPA history mode)         │
                └─────────────────┬───────────────┘
                                  │
                  prebuild copies SPA into public/
                                  │
                ┌─────────────────┴───────────────┐
                ▼                                 ▼
    ┌──────────────────────┐          ┌──────────────────────┐
    │  apps/web/           │          │  apps/api/ (source)  │
    │  Vite SPA            │          │  Next.js (API only)  │
    │  React 19 + Ionic 8  │          │  Drizzle + better-   │
    │  Tailwind v4         │          │  auth, rate-limit,   │
    │  vite-plugin-pwa     │          │  file-sniff, mw      │
    └─────────┬────────────┘          └──────────┬───────────┘
              │                                   │
              │              imports              │
              └─────────┬───────────┬─────────────┘
                        ▼           ▼
                ┌────────────────────────┐
                │  packages/shared/      │
                │  Drizzle schema        │
                │  Zod validation        │
                │  ApiMessageCode union  │
                │  Types, locales, role  │
                └───────────┬────────────┘
                            │
                            ▼
                  ┌─────────────────────┐
                  │     DATABASE        │
                  │  Local SQLite (dev) │
                  │  Turso libSQL (prod)│
                  └─────────────────────┘
```

The frontend and API share an origin in production — but it's not Vercel rewrites doing the bridging. Instead, `apps/api/scripts/prepare-spa.mjs` (the API's `prebuild` hook) builds the Vite SPA and copies `apps/web/dist/*` into `apps/api/public/`, so a single Next.js deployment serves both. `/api/*` hits route handlers; static SPA assets (index.html, /assets, /icons, /splash, etc.) are served straight from `public/`; anything else is sent to `/index.html` by `next.config.js` `rewrites().fallback` so React Router can take over client-side. Cookies travel with every request without CORS plumbing.

## Stack Components

| Layer | Technology | Cost |
|-------|------------|------|
| **Frontend framework** | Vite 6, React 19, TypeScript | $0 |
| **Routing + nav primitives** | `@ionic/react` 8, `@ionic/react-router` 8, `react-router` v5 | $0 |
| **i18n** | `react-intl` (`@formatjs/intl-react`), ICU MessageFormat | $0 |
| **State management** | React Context (13 providers) | $0 |
| **Styling** | Tailwind CSS v4 + brand CSS variables + Ionic theme bridge | $0 |
| **PWA / Service Worker** | `vite-plugin-pwa` (Workbox `injectManifest`) | $0 |
| **Backend framework** | Next.js 15 (App Router, API-only) | $0 |
| **Database (dev)** | Local SQLite (`apps/api/data/local.db`) | $0 |
| **Database (prod)** | Turso (libSQL — edge SQLite) | $0 |
| **ORM** | Drizzle ORM | $0 |
| **Auth** | `better-auth` 1.6 (DB sessions, passwordless email-OTP sign-in, Google OAuth) | $0 |
| **Rate limiting** | Two paths share one Upstash database: (a) `@upstash/ratelimit` SDK for app-level limits in `rate-limit.ts`, (b) better-auth `secondaryStorage` (via `@upstash/redis`) for auth-surface limits in `auth.ts`. In-memory fallback in dev. | $0 (Upstash free tier) |
| **Realtime** | SSE over Upstash Redis pub/sub + Streams via `ioredis`. In-memory EventEmitter backend in dev (no env var needed). See `.claude/docs/realtime-system.md`. | $0 (Upstash free tier) |
| **Shared package** | `packages/shared/` — TypeScript-only, consumed via TS project references | $0 |
| **Icons** | Lucide React + custom SVGs in `apps/web/src/components/icons/` | $0 |
| **Barcodes** | `html5-qrcode` (decode) + `bwip-js` (render; lazy-imported) | $0 |
| **Animation (in-page)** | `framer-motion` (drag, swipe, pan inside `TabContainer`) | $0 |
| **Animation (stack nav)** | Native to `IonRouterOutlet` (no library) | $0 |
| **Currency input** | `react-currency-input-field` | $0 |
| **Hosting** | Vercel (free tier, single Next.js project; SPA folded into `apps/api/public/` at build time) | $0 |
| **File Storage** | Base64 in DB (icons, avatars, logos) — raster-only, content-sniffed at upload | $0 |

**Total monthly cost: $0**

---

## Repo Layout (npm workspaces monorepo)

```
kasero/
├── package.json                    # root; workspaces config; npm-run-all parallel dev script
├── tsconfig.base.json              # shared TS settings + project references
├── .env.example                    # documents API_PORT, VITE_WEB_PORT
├── .gitignore
├── .claude/                        # gitignored docs (plans + guides)
│
├── apps/
│   ├── api/                        # Next.js, API-only
│   │   ├── package.json            # next, drizzle-orm, better-auth,
│   │   │                           #   @better-auth/drizzle-adapter, resend, ...
│   │   ├── next.config.js          # pruned (no next-intl, no Serwist)
│   │   ├── middleware.ts
│   │   ├── tsconfig.json
│   │   ├── drizzle.config.ts       # schema: '../../packages/shared/src/db/schema.ts'
│   │   ├── data/                   # local SQLite (gitignored)
│   │   ├── certificates/           # Tailscale dev certs (gitignored)
│   │   └── src/
│   │       ├── app/
│   │       │   ├── layout.tsx      # minimal: html/body + bg, no UI providers
│   │       │   ├── page.tsx        # returns null (Vite serves /)
│   │       │   └── api/            # route handlers — see backend-patterns.md
│   │       │       ├── auth/[...all]/  # better-auth catch-all (email-OTP,
│   │       │       │                   #   sign-in, sign-out, Google OAuth, ...)
│   │       │       ├── account/delete/        # OTP step-up account deletion
│   │       │       ├── account/change-email/  # dual-OTP email change
│   │       │       └── cron/cleanup-unverified/  # daily cleanup cron
│   │       └── lib/                # auth.ts (better-auth config),
│   │                               #   email.ts (Resend),
│   │                               #   i18n-server.ts (server msg bundle),
│   │                               #   api-middleware, business-auth,
│   │                               #   rate-limit, file-sniff, schemas
│   │
│   └── web/                        # Vite SPA
│       ├── package.json            # vite, react, @ionic/react,
│       │                           #   @ionic/react-router, react-router@5,
│       │                           #   react-intl, vite-plugin-pwa, ...
│       ├── vite.config.ts          # ports, https, /api proxy, vite-plugin-pwa
│       ├── tsconfig.json
│       ├── index.html              # <head> theme-color script, iOS startup images
│       ├── public/                 # manifest.json, icons, splash images, kasero-logo.png
│       └── src/
│           ├── main.tsx
│           ├── App.tsx             # IonApp + ErrorBoundary + IonReactRouter +
│           │                       #   AppIntlProvider + AuthProvider +
│           │                       #   AuthGateProvider + HapticFeedbackProvider;
│           │                       #   /login, /register, * → AuthenticatedShell
│           ├── routes/
│           │   ├── AuthenticatedShell.tsx   # /, /account, /join, /:businessId/* router
│           │   ├── BusinessProvidersFromUrl.tsx  # mounts per-business provider tree
│           │   │                                 # when URL is a business URL
│           │   ├── HubPage.tsx
│           │   ├── AccountPage.tsx
│           │   ├── JoinPage.tsx
│           │   ├── LoginPage.tsx
│           │   ├── RegisterPage.tsx
│           │   ├── BusinessTabsLayout.tsx   # IonTabs + IonRouterOutlet
│           │   └── tabs/                    # all tab pages + drill-downs
│           │       ├── HomeTab.tsx
│           │       ├── SalesTab.tsx
│           │       ├── ProductsTab.tsx
│           │       ├── ManageTab.tsx
│           │       ├── ProvidersTab.tsx
│           │       ├── TeamTab.tsx
│           │       └── ProviderDetailPage.tsx
│           ├── components/         # Tailwind components
│           │   ├── ui/             # Modal, Input, PriceInput, TabContainer, SwipeableRow
│           │   ├── auth/           # ContentGuard
│           │   ├── layout/         # NavigationErrorNotice, OfflineBadge,
│           │   │                   #   BusinessDataPreloader, error-boundary,
│           │   │                   #   auth-gate-overlay, haptic-feedback-provider
│           │   ├── businesses/shared/
│           │   ├── products/
│           │   ├── providers/
│           │   ├── team/
│           │   ├── manage/
│           │   ├── account/
│           │   ├── create-business/
│           │   ├── join/
│           │   ├── transfer/
│           │   ├── icons/
│           │   └── animations/
│           ├── contexts/           # auth, auth-gate, business, products, orders,
│           │                       #   providers, product-settings, sales,
│           │                       #   sales-sessions, page-transition,
│           │                       #   pending-transfer, incoming-transfer,
│           │                       #   product-form, join-business, create-business
│           ├── hooks/              # useBusinessFormat, useBarcodeScan,
│           │                       #   useRevalidateOnFocus, useOnlineStatus,
│           │                       #   useApiMessage, useSessionCache, ...
│           ├── lib/                # api-client, fetch (deduped), freshness,
│           │                       #   storage-client, qr, barcode-render,
│           │                       #   barcode-print, ... (barcode core +
│           │                       #   locale-config now live in @kasero/shared)
│           ├── i18n/
│           │   ├── AppIntlProvider.tsx
│           │   ├── messages/       # en-US.json, es.json, ja.json — flat dot-keys
│           │   ├── loadMessages.ts
│           │   └── messageIds.d.ts # generated type union of valid message ids
│           ├── pwa/
│           │   └── sw.ts           # Workbox custom SW (consumed by vite-plugin-pwa)
│           └── styles/             # tailwind input + interactive.css/modal.css/
│                                   #   forms.css/buttons.css/animations.css +
│                                   #   ionic-theme.css (brand vars → Ionic vars)
│
└── packages/
    └── shared/
        ├── package.json            # name: "@kasero/shared"
        ├── tsconfig.json
        └── src/
            ├── index.ts            # barrel (excludes db/schema to avoid pulling drizzle)
            ├── db/schema.ts        # Drizzle schema (the only definition)
            ├── types/              # Business, Product, Order, Provider, User, Sale, Invite, ApiEnvelope
            ├── api-messages.ts     # ApiMessageCode union + envelope helpers
            ├── business-role.ts    # BusinessRole enum + canManageBusiness, canManageTeam, isOwner
            ├── locales.ts          # LOCALES registry (label, acceptPrefixes, translate metadata)
            ├── locale-config.ts    # currency-by-locale, region grouping for the picker
            ├── barcodes.ts         # detectBarcodeFormat, normalizeBarcodeValue, computeCanonicalGtin,
            │                       #   gtinCheckDigit, generateInternalProductBarcode (KSR-)
            ├── provider-notes.ts   # MAX_PROVIDER_NOTES, etc.
            └── sales-helpers.ts    # session/sale aggregation utilities (used by web + api)
```

Server-side Zod schemas live in `apps/api/src/lib/schemas.ts` — `Schemas.email()`, `Schemas.amount()`, `Schemas.businessIcon()`, etc.

Both apps consume `@kasero/shared` via TypeScript project references — no compile step. The shared package exports source `.ts` directly:

```jsonc
// packages/shared/package.json
{
  "name": "@kasero/shared",
  "type": "module",
  "exports": {
    "./db/schema": "./src/db/schema.ts",
    "./types": "./src/types/index.ts",
    "./api-messages": "./src/api-messages.ts",
    "./business-role": "./src/business-role.ts",
    "./locales": "./src/locales.ts",
    "./validation/*": "./src/validation/*.ts"
  }
}
```

Both apps then import via the workspace name: `import { businesses } from '@kasero/shared/db/schema'`.

Root `package.json` orchestrates dev / build / lint / test across the workspaces:

```jsonc
{
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "npm-run-all --parallel dev:api dev:web",
    "dev:api": "npm run dev --workspace=apps/api",
    "dev:web": "npm run dev --workspace=apps/web",
    "build": "npm run build:api && npm run build:web",
    "lint": "npm run lint --workspaces --if-present",
    "test": "npm run test --workspaces --if-present"
  }
}
```

---

## Technology Decisions

### Frontend framework: Vite + React 19

**What it is:** Vite is a build tool that uses native ES modules in dev (no bundling) and Rollup in production. React 19 is the UI library.

**Why we chose it:**

1. **Sub-100ms HMR** — Native ES modules in dev mean every change reloads the only-affected modules; no full bundle rebuild. Significantly faster than the previous Next.js dev experience for client work.
2. **No SSR overhead** — The app is purely a client SPA. Vite's `index.html` + module entrypoint model matches that exactly.
3. **First-class TypeScript** — TS source is consumed directly with esbuild for transforms; type checking runs in parallel.
4. **Plugin ecosystem** — `vite-plugin-pwa`, Tailwind v4 Vite plugin, Ionic's component compatibility, all production-grade.
5. **Same React 19** — JSX, hooks, Suspense — nothing in component code changed when we switched off Next.js.

**Alternatives considered:**

| Option | Rejected because |
|--------|------------------|
| Stay on Next.js (App Router client components) | The custom layered-navigation system on top of Next.js's URL-driven routing produced persistent iOS-Safari rendering bugs that resisted multiple fix attempts. |
| Remix / React Router v7 framework | Heavier than needed for an offline-first SPA; SSR adds complexity we don't want. |
| Astro / SvelteKit | Would require rewriting components and breaking the React Context state layer. |

---

### Navigation: Ionic React + React Router v5

**What it is:** `@ionic/react` provides `IonApp`, `IonRouterOutlet`, `IonPage`, `IonHeader`, `IonContent`, `IonTabs`, `IonBackButton`, etc. `@ionic/react-router` integrates them with `react-router` v5 (Ionic 8 still uses v5 — do not upgrade to v6).

**Why we chose it:**

1. **iOS-style peel-back gesture for free.** Ionic's `IonRouterOutlet` ships a hardened, eight-years-iterated implementation of stack navigation: slide-in on push, peel-back on swipe-from-left, parallax under the active page, scroll-lock on the inactive page. Replacing the previous custom Framer Motion implementation removed a class of compositor bugs.
2. **Memory persistence by default.** Pages in the stack stay mounted, so peel-back reveals the previous page in its exact prior state — scroll position, form input, expanded rows. We don't have to reimplement TabShell-style persistence.
3. **`IonTabs` for the bottom-nav shell.** Native handling of tab switching with persistence and scroll preservation per tab.
4. **`prefers-reduced-motion` honored automatically.**

**What we deliberately limited:**

We use Ionic for **navigation only**. Buttons, inputs, modals, lists — those remain Tailwind components inside `IonContent`. The Ionic UI rewrite would be a much larger change with no functional benefit. Keeping our existing components reduces migration risk and preserves the design language.

**Why react-router v5:** Ionic 8 is built against react-router v5's API (`<Switch>`, `<Route render>`, `useRouteMatch`). v6 is incompatible. This is a known, documented constraint — don't accidentally upgrade.

---

### State: React Context

**What it is:** Standard `React.createContext` providers wrapping the route tree.

**Why we kept it:**

The 13 existing providers (Auth, Business, Products, Orders, Providers, ProductSettings, PageTransition, PendingTransfer, IncomingTransfer, ProductForm, JoinBusiness, CreateBusiness, AuthGate) work fine and the migration cost to Zustand or Jotai is independent of the Vite / Ionic move. Migrating state management is on the roadmap as a future, separate change.

Provider re-render cost is controlled via `useMemo` on context values + `useCallback` on every callback (see `performance-patterns.md` Section 5).

---

### Styling: Tailwind v4 + Ionic theme bridge

**What it is:** Tailwind CSS v4 (Vite plugin) + brand tokens in `apps/web/src/styles/base.css` + an Ionic CSS variable bridge in `apps/web/src/styles/ionic-theme.css`.

**Why we chose it:**

1. **Brand colors stay the source of truth.** The bridge maps `--color-brand`, `--color-bg-base`, `--color-text-primary`, etc. to `--ion-color-primary`, `--ion-background-color`, `--ion-text-color`, etc. Light/dark theming flips the brand tokens; Ionic primitives inherit automatically.
2. **No utility-class diff.** Components keep using `className="rounded-lg bg-bg-surface text-text-primary"` — Tailwind compiles them the same way it always did.
3. **Tailwind v4 specifically.** Faster than v3, native CSS-variable based, smaller config surface.

```css
/* apps/web/src/styles/ionic-theme.css */
:root {
  --ion-color-primary: var(--color-brand);
  --ion-background-color: var(--color-bg-base);
  --ion-text-color: var(--color-text-primary);
  --ion-toolbar-background: var(--color-bg-surface);
  --ion-tab-bar-background: var(--color-bg-surface);
  --ion-tab-bar-color-selected: var(--color-brand);
  --ion-border-color: var(--color-border);
  --ion-card-background: var(--color-bg-surface);
}
```

---

### i18n: react-intl

**What it is:** `react-intl` (`@formatjs/intl-react`) with `<IntlProvider locale messages>` at the root and `useIntl()` / `intl.formatMessage({ id })` everywhere else.

**Why we chose it:**

1. **Same ICU MessageFormat as `next-intl`.** Translation strings are byte-identical between the two libraries. The migration was a key-flattening codemod (`hub.empty_state_title` instead of `t('empty_state_title')` inside `useTranslations('hub')`), not a rewrite.
2. **No framework coupling.** `react-intl` works in any React tree; we don't need Next.js's request-scoped locale machinery.
3. **Code-split message bundles.** Each locale's JSON is dynamically imported per locale, so users only download the language they need.
4. **Type-safe message ids.** A build-time codegen produces a union type of all valid keys; `intl.formatMessage({ id: 'typo' })` is a compile error.

**Translation files:** flat dot-keys at `apps/web/src/i18n/messages/{en-US,es,ja}.json`. The translate script lives at `apps/api/scripts/i18n-translate.ts` and reads tone guidance from `packages/shared/src/locales.ts`.

**Server-side i18n: gone.** API routes don't translate; they emit `ApiMessageCode` envelopes. The client's `useApiMessage()` hook maps codes → translated strings using the current locale's JSON.

See `.claude/docs/i18n-system.md` for the full guide.

---

### PWA / Service Worker: vite-plugin-pwa (Workbox)

**What it is:** `vite-plugin-pwa` is the canonical PWA plugin for Vite. It uses Workbox under the hood and supports `injectManifest` mode where you write the SW yourself and the plugin injects the precache manifest.

**Configuration** (`apps/web/vite.config.ts`):

```ts
VitePWA({
  registerType: 'autoUpdate',
  strategies: 'injectManifest',
  srcDir: 'src/pwa',
  filename: 'sw.ts',
  manifest: { /* ported from current public/manifest.json */ },
  devOptions: { enabled: false },  // SW disabled in `vite dev` to avoid HMR conflicts
})
```

**Custom SW** (`apps/web/src/pwa/sw.ts`):

- `precacheAndRoute(self.__WB_MANIFEST)` — SPA shell + assets, content-hashed.
- `NavigationRoute` with `denylist: [/^\/api\//]` — SPA fallback for any deep link.
- `CacheFirst` for image destinations (product / business icons).
- `/api/*` routed to `NetworkOnly` — no API caching at the SW layer.
- `skipWaiting()` + `clients.claim()` on install/activate so updates take effect on next page load.

**Why Workbox specifically:**

1. **Same engine family as the previous Serwist setup.** Serwist is a Workbox-based wrapper; switching to vanilla Workbox is a configuration change, not a behavior change. Cache strategies, manifest injection, lifecycle handling all match.
2. **`vite-plugin-pwa` integrates Workbox cleanly.** It handles dev-mode disabling, HTTPS detection, and manifest generation; we just register routes.
3. **Old Serwist SW unregisters cleanly on first visit.** Workbox's `skipWaiting` + `clients.claim` semantics handle the transition.

To verify the SW locally: `npm run start:local` from `apps/api/`. This runs `next build && node scripts/start-https.mjs` (and the `prebuild` hook builds the SPA into `apps/api/public/` first), serving the production build over HTTPS using the Tailscale dev certs (required for PWA install on a phone).

---

### Backend: Next.js 15 (API-only)

**What it is:** Next.js still hosts the 55 API routes under `apps/api/src/app/api/`. `app/layout.tsx` is a minimal html/body shell (required by Next.js even for API-only projects). `app/page.tsx` was deleted — without a route at `/`, the `next.config.js` `rewrites().fallback` rule sends `/` to `/index.html` (the static SPA shell copied into `public/` by the prebuild step).

**Why we kept it:**

1. **Zero behavioral change to 55 routes.** Wholesale rewriting to Express, Hono, or another runtime would be high-risk for no functional gain. The routes already use a clean middleware/wrapper architecture (`withBusinessAuth`, `withAuth`).
2. **Vercel deployment unchanged.** Vercel knows how to deploy Next.js API routes as Lambdas. We don't have to rebuild the deployment story.
3. **Same-origin without external rewrites.** The Vite SPA is folded into `apps/api/public/` by `apps/api/scripts/prepare-spa.mjs` (the API's `prebuild` hook). One Next.js deployment serves `/api/*` and the SPA shell from one origin. Cookies, no CORS, no auth re-architecture.
4. **Auth runs in Node.** `apps/api/src/lib/auth.ts` is the better-auth config (Node-only — libsql + Drizzle adapter both need Node APIs). `apps/api/src/middleware.ts` runs on Edge but does a cookie-PRESENCE-only check; full session verification happens server-side in route handlers via `auth.api.getSession({ headers })`.

**What changed in the API workspace:**

- `next.config.js` pruned: dropped `withNextIntl`, dropped `withSerwistInit`, dropped `allowedDevOrigins` (no client to HMR).
- `package.json` pruned: removed client-only deps (`framer-motion`, `next-intl`, `@serwist/next`, `serwist`, `lottie-react`, `lucide-react`, `react-currency-input-field`, `html5-qrcode`, `bwip-js`, `dompurify`).
- Schema source moved to `packages/shared/src/db/schema.ts`; `apps/api/drizzle.config.ts` references it via relative path.
- Types, `ApiMessageCode`, `business-role`, `locales` moved to `packages/shared/`.

---

### Database: Local SQLite (dev) + Turso (prod)

**What it is:** Development uses a plain SQLite file at `apps/api/data/local.db` (no external service needed). Production uses Turso, a distributed SQLite database built on libSQL (open-source SQLite fork).

**Why we chose it:**

1. **Zero-friction local dev** — No Turso CLI, no account, no env vars needed to start hacking. `npm run dev` just works.
2. **Same dialect everywhere** — Both dev and prod use libSQL/SQLite, so schema changes and queries work identically in both environments.
3. **Edge-native in prod** — Turso replicas run at the edge for low-latency reads globally.
4. **Generous free tier** — 9GB storage, 500M rows read, 25M rows written per month.
5. **No cold starts** — Unlike serverless databases, always warm.

**How the split works:**

`apps/api/src/db/index.ts` checks `NODE_ENV` and picks the database URL accordingly. Both paths use `@libsql/client` — local dev passes `file:<absolute-path>/data/local.db`, production passes the `TURSO_DATABASE_URL`. Same client, same dialect, zero code branching in queries.

The `apps/api/data/` directory is gitignored. Schema changes go through `apps/api/drizzle.config.ts` — `db:push` targets local, `db:push:prod` targets Turso.

**Alternatives considered:**

| Option | Rejected because |
|--------|------------------|
| PlanetScale | MySQL-based, no free tier anymore |
| Supabase | PostgreSQL overhead, free tier limits |
| Firebase | Proprietary, vendor lock-in, complex pricing |
| PocketBase | Self-hosted, requires paid hosting ($5+/month) |

---

### Database Schema (Drizzle + SQLite)

Schema defined in `packages/shared/src/db/schema.ts`. Both apps import row types from it; only `apps/api/` runs queries against it. All tables use `businessId` for multi-tenant isolation.

**Design principles:**

- **No audit timestamps** — `createdAt`/`updatedAt` only kept where functionally needed (displayed in UI or used in logic)
- **Users table is identity-only** — no business logic columns. All business context lives in business-scoped tables
- **Product settings inline** — `defaultCategoryId` and `sortPreference` live on the `businesses` table directly

**Core tables:**

| Table | Description |
|-------|-------------|
| `businesses` | Business entities (includes product settings + `nextOrderNumber` counter inline) |
| `users` | User accounts (id, email, name, avatar, language, `emailVerified`, `emailVerifiedAt`, `phoneNumber`, `phoneNumberVerified`, `createdAt`, `updatedAt`). Identity-only: no credential material on this row. |
| `session` | better-auth session rows (id, token, userId, expiresAt, ipAddress, userAgent, createdAt, updatedAt). Cookie is an opaque token referencing this row. |
| `account` | better-auth account rows — one row per linked sign-in method. For passwordless email sign-in the row pairs the user with `providerId='credential'` (no password column — auth is fully passwordless); for OAuth the row stores `providerId='google'` plus the access/refresh tokens. |
| `verification` | better-auth one-time tokens (email OTPs for sign-in, step-up, and dual-OTP email change). Self-expiring; expired rows pruned daily by `/api/cron/cleanup-unverified`. |
| `business_users` | Join table — users to businesses (role, status, `createdAt`) |
| `products` | Product catalog with pricing, stock, and barcode fields (incl. canonical `barcodeGtin`) |
| `product_categories` | Custom categories per business (name, sortOrder) |
| `providers` | Supplier information |
| `provider_notes` | Up to 5 notes per provider (enforced at the POST route) |
| `orders` | Purchase orders from suppliers |
| `order_items` | Line items for orders |
| `invite_codes` | Team member invitations (6-char codes, `expiresAt`) |
| `ownership_transfers` | Business ownership transfer records |

**Timestamps reference.** Most tables have no timestamps. Only these retain functional ones:

| Table | Timestamp | Purpose |
|-------|-----------|---------|
| `business_users` | `createdAt` | Displayed as "Member since" in team UI |
| `users` | `createdAt`, `updatedAt` | Required by better-auth's drizzleAdapter (consumed by the daily cleanup cron) |
| `users` | `emailVerifiedAt` (nullable) | Audit timestamp of email-OTP sign-in completion |
| `session` | `expiresAt`, `createdAt`, `updatedAt` | better-auth session lifecycle |
| `verification` | `expiresAt` | Functional — invalidates expired OTPs / reset tokens |
| `invite_codes` | `expiresAt` | Functional — determines if code is valid |
| `ownership_transfers` | `expiresAt` | Lifecycle cutoff |
| `provider_notes` | `createdAt`, `updatedAt` | Displayed in the notes list |
| `orders` | `date`, `receivedDate`, `estimatedArrival` | User-facing dates |

**Indexes of note:**

- `business_users (userId, businessId)` composite — the hottest query in the app (every business-scoped request hits `requireBusinessAccess`)
- `order_items (productId)` — powers the product-delete blocking-order check
- `users.email` (case-insensitive expression index on `LOWER(email)`) — used by `invite/validate` and `transfer/initiate`

**Schema changes.** Edit `packages/shared/src/db/schema.ts`, then from `apps/api/`:

- `npm run db:push` — pushes to local dev SQLite (`apps/api/data/local.db`)
- `npm run db:push:prod` — pushes to Turso production

`apps/api/drizzle.config.ts` references the shared schema via relative path (`../../packages/shared/src/db/schema.ts`).

**Hand-written SQL migrations.** The auth surface is migrated via versioned SQL files in `packages/shared/migrations/` (timestamp-prefixed). Files currently on disk, in apply order:

1. `2026-05-13-01-auth-schema.sql` — creates `session`, `account`, `verification`, and the new columns on `users`. (Legacy revisions of this migration also created a `two_factor` table; that table is dropped by `2026-05-14-01-passwordless-cleanup.sql`.)
2. `2026-05-14-01-passwordless-cleanup.sql` — drops the `two_factor` table and the `account.password` column. Apply once before flipping prod over to the passwordless build.
3. `2026-05-15-01-drop-rate-limit-table.sql` — drops the better-auth `rate_limit` table (counters moved to Upstash Redis via `secondaryStorage`). Idempotent — uses `DROP TABLE IF EXISTS`.

Deleted migrations (do not look for these — they were either applied and obsoleted or superseded): `2026-05-13-02-auth-backfill.sql` (one-off bcrypt-era backfill; obsolete under passwordless), `2026-05-13-03-drop-legacy-auth-columns.sql` (bundled into the passwordless-cleanup migration), `2026-05-13-04-rate-limit-table.sql` and `2026-05-13-05-rate-limit-id-column.sql` (both created/recreated the `rate_limit` table that is now dropped — superseded by `2026-05-15-01`).

Runner: `apps/api/scripts/run-auth-backfill.ts`, invoked via `npm run auth:migrate -- <filename>` (dev) or `npm run auth:migrate:prod -- <filename>` (export `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` inline). The runner tolerates `no such column` errors on `ALTER TABLE ... DROP COLUMN` statements so re-running a passwordless-cleanup-style migration is safe.

---

### ORM: Drizzle

**What it is:** A TypeScript-first ORM with excellent type safety and SQL-like syntax.

**Why we chose it:**

1. **Type safety** — Full TypeScript inference from schema to queries
2. **Edge compatible** — Works in Vercel Edge Runtime
3. **SQL-like** — Familiar syntax, no magic, easy to debug
4. **Lightweight** — ~7KB bundle, minimal overhead
5. **Turso support** — First-class libSQL/Turso integration

**Schema location:** `packages/shared/src/db/schema.ts` — defined once, used by `apps/api/` for queries and by `apps/web/` for inferred row types.

**Alternatives considered:**

| Option | Rejected because |
|--------|------------------|
| Prisma | Heavy bundle, complex migrations, edge limitations |
| Kysely | Less type inference, manual schema types |
| Raw SQL | No type safety, repetitive boilerplate |

---

### Auth: better-auth (DB sessions, passwordless email-OTP, Google OAuth)

> **Passwordless by design.** There is no credential password storage. Authentication is fully passwordless: email OTP via better-auth's `emailOTP` plugin in `sign-in` mode, plus Google OAuth. The legacy `account.password` column and `two_factor` table were dropped in migration `2026-05-14-01-passwordless-cleanup.sql`. Destructive actions (delete account, change email, transfer business ownership) are gated by a fresh email-OTP step-up at the route level.



**What it is:** [`better-auth`](https://www.better-auth.com) 1.6.11 with the `@better-auth/drizzle-adapter` plugged into the same Turso/SQLite database the rest of the app uses. Self-hosted, MIT-licensed, no external auth service.

**Config file:** `apps/api/src/lib/auth.ts` — the single source of truth for the email-OTP plugin, OAuth providers, account-deletion plumbing, the cookie-cache poisoning defense, and rate-limit rules.

**Why we chose it:**

1. **Zero cost** — no per-user pricing, runs on the same Lambdas as the rest of the API.
2. **Plugin coverage matches our passwordless design** — `emailOTP` in `sign-in` mode handles new and returning users in one call, Google OAuth ships as a first-class social provider, session listing/revocation and account deletion are baked in. No need to hand-roll any of these flows.
3. **Drizzle-native** — the adapter reads/writes the same Drizzle schema we already use; no shadow tables or external store.
4. **Plugin model** — `emailOTP` and any future plugins register cleanly without monkey-patching the core.

**Database-backed sessions (no JWT).** Sessions are rows in the `session` table; the cookie is an opaque token, not a signed JWT.

- Cookie name: `kasero.session_token` (dev) / `__Secure-kasero.session_token` (prod). `useSecureCookies: process.env.NODE_ENV === 'production'`.
- `expiresIn: 7 days`, `updateAge: 1 day` (the session row's `expiresAt` is bumped on activity).
- `session.cookieCache: { enabled: true, maxAge: 5 * 60 }` — 5-minute in-memory cookie cache that avoids hitting the DB on every authenticated request.

**Cross-account cookie-cache poisoning defense.** better-auth's `POST /email-otp/verify-email` looks up the user by `body.email` (not by the active session) and, on success, rewrites the CALLER's cookie cache with `emailVerified: true` — even when the caller's session belongs to a different user. To stop session A from minting "verified" status by verifying mailbox B, `apps/api/src/lib/auth.ts` registers a `hooks.before` middleware that rejects `/email-otp/verify-email` whenever an active session exists whose email doesn't match the body. The matching-email and unauthenticated-signup paths both still work.

**No passwords.** `apps/api/src/lib/password-hash.ts` and the legacy `emailAndPassword` callbacks have been removed. The `account` table no longer carries a `password` column, and bcrypt / scrypt are no longer in the dependency tree. The only credential factor is the 6-digit email OTP.

**Email OTP sign-in (passwordless).** The `emailOTP` plugin runs in `sign-in` mode: a single `authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' })` followed by `authClient.signIn.emailOtp({ email, otp })` serves both new and returning users. On first successful verify the plugin auto-creates a `users` row with no name; the SPA's register wizard then collects the display name via `authClient.updateUser({ name })`. OTPs are 6 digits with a 10-minute TTL, delivered through Resend (`apps/api/src/lib/email.ts`). The `sendVerificationOTP` callback looks up `users.language` so the email body uses the user's preferred locale (server-side bundle in `apps/api/src/lib/i18n-server.ts`).

**Step-up OTP for destructive actions.** Logged-in users still have to prove fresh mailbox control before the account is mutated irreversibly. The pattern is the same for every destructive route: send an OTP via `/api/auth/email-otp/send-verification-otp`, then re-submit the value alongside the destructive request body. See `backend-patterns.md` for the dedicated section.

**Google OAuth.** Conditionally registered when both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set. `account.accountLinking.trustedProviders: ['google']` auto-links a Google sign-in to an existing email account when the verified email matches — so a user who signed up via OTP can later sign in with Google (or vice-versa) without forking into a second `users` row. The client calls `authClient.signIn.social({ provider: 'google', callbackURL })`.

**Apple Sign In.** Conditionally registered when `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and `APPLE_PRIVATE_KEY` are all set. Uses `apps/api/src/lib/apple-client-secret.ts` to mint better-auth's required string `clientSecret` (a JWT) at module load via `jose`; cold starts re-mint, no human rotation. Apple is in `account.accountLinking.trustedProviders` so a verified Apple email auto-links to an existing email-OTP or Google account. The client calls `authClient.signIn.social({ provider: 'apple', callbackURL })`.

**Apple Developer Portal — one-time setup.** Required before flipping the env vars on:

1. Enroll at `developer.apple.com` ($99/year, ~24-48h review).
2. **App ID** — Identifiers -> "+" -> "App IDs" -> "App". Bundle ID: `app.kasero.ios` (or your chosen reverse-DNS for the future iOS app). Enable the **Sign In with Apple** capability.
3. **Services ID** — Identifiers -> "+" -> "Services IDs". Identifier: `app.kasero.web`. Enable **Sign In with Apple** -> Configure: Primary App ID = the App ID above; Domains = `kasero.app`; Return URLs = `https://kasero.app/api/auth/callback/apple`. (Production only — Apple caps return URLs at 10 per Services ID and we don't register preview/local URLs.)
4. **Key** — Keys -> "+". Enable **Sign In with Apple**, configure with the App ID above. Download the `.p8` file (one-time download). Note the **Key ID**.
5. **Team ID** — top-right of the developer portal.

Map these into Vercel Production env vars (do **not** add to Preview):

| Apple value | Env var |
|---|---|
| Services ID identifier (e.g. `app.kasero.web`) | `APPLE_CLIENT_ID` |
| Team ID | `APPLE_TEAM_ID` |
| Key ID | `APPLE_KEY_ID` |
| `.p8` file contents (multi-line PEM) | `APPLE_PRIVATE_KEY` |
| iOS Bundle ID | `APPLE_APP_BUNDLE_IDENTIFIER` (only when native iOS ships) |

`APPLE_PRIVATE_KEY` is multi-line. Vercel preserves newlines when pasted via the dashboard.

**OAuth round-trips don't complete in local dev.** Both providers reject our dev URLs (`localhost`, Tailscale tunnels) because only the production `kasero.app` callbacks are whitelisted upstream:

- **Google** — only `https://kasero.app/api/auth/callback/google` is registered as an Authorized redirect URI on the OAuth 2.0 Client. Any other URL fails with `redirect_uri_mismatch` on Google's side.
- **Apple** — Services ID return URLs cap at 10 per ID and disallow non-standard ports, `.ts.net` private DNS, and `localhost`. Only `kasero.app` is registered; any other URL fails with `invalid_redirect_uri`.

Use email-OTP as the local sign-in path while iterating — it works fully against the dev SQLite + a real email-sender. To exercise OAuth, deploy to production (`kasero.app`) or to a stable preview whose URL you've whitelisted with each provider.

Leave the four `APPLE_*` and two `GOOGLE_*` env vars unset in `apps/api/.env.local` — the conditional registration in `auth.ts` skips each provider entirely, and the social buttons no-op harmlessly on click. (Setting them locally won't make sign-in work upstream, and a partially-pasted `.p8` previously took down email-OTP and Google routes alongside Apple. `auth.ts` now soft-fails the Apple block in non-prod — see commit `e3ffd41c` — but the cleanest dev config is still "unset".)

**Rate limiting (auth surface).** `rateLimit.storage: 'secondary-storage'` — cross-instance counters live in Upstash Redis via a `secondaryStorage` adapter defined at the top of `apps/api/src/lib/auth.ts` (a ~25-line wrapper around `@upstash/redis` gated on `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`). Keys are prefixed with `kasero:ba:` to keep them distinct from the `@upstash/ratelimit` SDK's `kasero:` prefix used by `apps/api/src/lib/rate-limit.ts`. In dev without Upstash creds, `secondaryStorage` is `undefined` and better-auth silently falls back to in-memory rate-limiting (acceptable locally). Sessions and `verification` rows intentionally stay in Turso — they're not moved to secondary storage because of open better-auth bugs around secondary-storage handling of those models (#8893 / #4721 / #1368), and our change-email route queries `verification` directly via Drizzle. Custom per-path rules:

| Path | Limit | Window |
|------|-------|--------|
| `/email-otp/send-verification-otp` | 1 | 1 min |
| `/email-otp/verify-email` | 5 | 1 min |
| `/sign-in/email-otp` | 5 | 1 min |

The rest of the app (business mutations, AI, HEIC, transfer/decline, etc.) still goes through `apps/api/src/lib/rate-limit.ts` with the Upstash-or-memory backend. The two code paths share one Upstash database via the same env vars but use different key prefixes — they don't collide.

**Server-side session lookup.** `apps/api/src/lib/api-middleware.ts` exposes `withAuth(handler, options?)`. The wrapper:

1. Runs the same-origin CSRF check (`enforceSameOrigin`).
2. Enforces a 256 KB default body cap (override via `{ maxBodyBytes }`).
3. Calls `auth.api.getSession({ headers: request.headers })`; 401 on no session.
4. By default rejects unverified emails with 403 `EMAIL_NOT_VERIFIED`. Pre-verification routes opt out via `{ allowUnverified: true }`.
5. On non-GET/HEAD methods, applies per-user (`RateLimits.userMutation`, 30/min) and per-IP (`RateLimits.ipMutation`, 600/min) mutation caps. Routes that need custom limits opt out via `{ rateLimit: false }` and call `applyRateLimit` themselves.

Handler signature: `(request, user: AuthedUser) => Promise<NextResponse>` where `AuthedUser = { userId, email, emailVerified, name, language }`. The field name is `userId` (not `id`) so call sites in `business-auth` and elsewhere don't need to know which auth surface produced the value. `withBusinessAuth` layers on `requireBusinessAccess(businessId)` (`apps/api/src/lib/business-auth.ts`), which calls the same `auth.api.getSession` and applies the same emailVerified gate.

**Edge middleware** (`apps/api/src/middleware.ts`) does a cookie-PRESENCE-only check via regex (matches both `kasero.session_token` and `__Secure-kasero.session_token`) and redirects to `/?redirect=<path>` when missing. Edge runtime can't reach the database, so full session validity is always enforced server-side. Public paths: `/` (the unified EntryPage), `/register` (the 3-step OTP wizard), `/join`.

**Account deletion.** `POST /api/account/delete` is wrapped in `withAuth` and lives outside `/api/auth/*` so it doesn't collide with better-auth's `[...all]` catch-all. The handler requires a fresh email-OTP step-up (`confirmEmail` + `otp` in the request body — see `backend-patterns.md`'s OTP step-up section), then pre-checks the user isn't still an active owner of any business (single-active-owner invariant — returns 409 `USER_DELETE_OWNS_BUSINESSES` if so) and delegates to `auth.api.deleteUser`. Sessions, `account` rows, and `business_users` membership rows cascade-delete via FK on `users.id`. The default better-auth freshness gate (`session.freshAge`) is disabled in `auth.ts`; the OTP we just verified is the sole freshness proof for this destructive action.

**Daily cleanup cron.** `POST /api/cron/cleanup-unverified` (scheduled in `apps/api/vercel.json`, daily at 03:00 UTC) does TWO independent cleanups on every invocation:

1. **Unverified users.** Deletes `users` matching ALL of: `emailVerified = false` AND `createdAt < now - 7 days` AND no active `business_users` membership. Sessions and account rows cascade-delete via FK on `users.id`.
2. **Expired verification rows.** Deletes any `verification` row where `expiresAt < now - 1h`. The 1h buffer past the 10-minute OTP TTL avoids edge-case races with verify attempts arriving at the last second. better-auth never deletes expired OTPs on its own, so without this they accumulate forever.

Authorized via `Authorization: Bearer ${CRON_SECRET}` compared with `timingSafeEqual` (length-precheck first). Response shape: `{ deletedCount, verificationsDeleted }`. Safe to re-run — no-op when there are no candidates.

**Client.** `apps/web/src/lib/auth-client.ts` is the better-auth React client (`emailOTPClient` + `inferAdditionalFields` plugins). `apps/web/src/contexts/auth-context.tsx` wraps `authClient.useSession()` and exposes `sendOtp`, `verifyOtp`, `setName`, `linkGoogle`, `logout`, `refreshUser`, `changeLanguage`. `verifyOtp` returns an `isNewUser` flag so the UI can route the brand-new user (empty `users.name`) through one extra step. The unified `EntryPage` at `/` collects the email and sends the OTP; the registration wizard at `apps/web/src/components/auth/register-steps/` is the 3-step OTP flow: email → verify → name → hub. Returning users skip the name step and land on the hub straight from verify.

---

### Rate Limiting: Upstash Redis (prod) + in-memory fallback (dev)

**What it is:** Two distinct code paths share a single Upstash Redis database via the same `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` env vars:

1. **App-level limits** (`apps/api/src/lib/rate-limit.ts`) — async `checkRateLimit(identifier, config)` backed by the `@upstash/ratelimit` SDK's `Ratelimit.slidingWindow` (one instance cached per `(limit, windowSeconds)` pair). Keys use prefix `kasero:`. Covers business mutations, AI, HEIC, transfer/decline, public route enumeration defenses, etc. Fail-open: if Upstash throws (network blip), the request is allowed through and a warning is logged. Two AI-specific configs opt into `failClosed: true` to protect billable spend during an outage.
2. **Auth-surface limits** (`apps/api/src/lib/auth.ts`) — better-auth's `rateLimit` config running with `storage: 'secondary-storage'`. A ~25-line `secondaryStorage` adapter wraps `@upstash/redis` directly (no SDK middle layer; better-auth manages its own counter shapes and TTLs). Keys use prefix `kasero:ba:` to stay distinct. Covers `/email-otp/send-verification-otp`, `/email-otp/verify-email`, `/sign-in/email-otp` (rules in `auth.ts`).

**Why:** The in-memory limiter is per-Lambda — at Vercel scale it lets a user multiply their budget by however many Lambdas they hit. Upstash gives us a shared Redis so counters are global.

**Dev fallback:** Without Upstash creds, BOTH paths degrade to in-memory: path (1) uses an in-process `Map`, path (2) is better-auth's built-in in-memory limiter (kicks in when `secondaryStorage` is `undefined`). Fine for local dev, NOT appropriate for a multi-Lambda prod deploy.

**Free-tier headroom.** Upstash's free tier ships 500K commands/month. Kasero issues roughly 3–4 Redis commands per authenticated mutation, so the shared instance has comfortable headroom for the app's scale.

**Callers:** `applyRateLimit(id, config)` in `apps/api/src/lib/api-middleware.ts` wraps `checkRateLimit` and returns a `NextResponse` with `Retry-After` on 429. `withBusinessAuth` automatically applies `RateLimits.businessMutation` to every non-GET/HEAD method; other routes call `applyRateLimit` inline. The auth-surface path is purely internal to better-auth — no Kasero code calls it directly.

---

### Realtime: SSE over Upstash Redis (ioredis) + in-memory dev backend

**What it is:** Server-Sent Events (SSE) delivered via a single GET endpoint (`/api/realtime`). The server subscribes to Upstash Redis pub/sub channels using `ioredis`; when a mutation route publishes an event, all connected clients on that channel receive it immediately. Security-critical events (session revoke, business delete, ownership transfer) are also appended to a per-user Redis Stream before publishing so they survive reconnects.

**Why Upstash + ioredis for this (not the REST SDK):** pub/sub and Redis Streams require a persistent TCP connection with blocking reads — the `@upstash/redis` HTTP REST client cannot do this. `ioredis` holds one subscriber connection per server instance. The `UPSTASH_REDIS_URL` env var (`rediss://...`) is the TCP/TLS endpoint exposed by Upstash alongside their REST URL.

**In-memory dev backend:** when `UPSTASH_REDIS_URL` is absent (all local dev), `apps/api/src/lib/realtime/redis.ts` returns an in-process `EventEmitter`-based backend. No Redis account or CLI needed locally. Never set `UPSTASH_REDIS_URL` in `.env.local` — local publishes should stay local.

**`ioredis` in `apps/api/package.json`:** listed as a runtime dependency. Rate-limiting uses `@upstash/redis` (REST); realtime uses `ioredis` (TCP). Both point at the same Upstash database via different env vars and different client libraries.

See `.claude/docs/realtime-system.md` for the full guide.

**Future considerations (from the "Real-time Updates" item below):** the realtime system is now implemented. The "Vercel KV / Pusher / SSE" options listed in the Future Considerations section are historical — SSE over Upstash Redis is the chosen and deployed solution.

---

### Icons: Lucide React

**What it is:** Fork of Feather Icons with more icons and active development.

**Why we chose it:**

1. **Tree-shakeable** - Only bundle used icons
2. **Consistent style** - Clean, minimal aesthetic
3. **Large library** - 1000+ icons
4. **React-native** - First-class React components

Custom SVG icons live at `apps/web/src/components/icons/`.

---

### Barcodes: html5-qrcode + bwip-js

**What they are:** Two complementary libraries. `html5-qrcode` decodes barcodes from an image or camera stream. `bwip-js` renders barcodes as SVG/canvas from a value + format.

**Why we chose them:**

1. **Zero cost** - Both MIT licensed, no API keys, no service dependencies
2. **Client-side** - Decode and render both run in the browser; no server round-trip for rendering, and decode can work on a camera-captured image without uploading
3. **Format coverage** - Between the two, we support UPC-A/E, EAN-8/13, Code 128, Code 39, Code 93, Codabar, and ITF
4. **Lazy-imported** — `bwip-js` (~70 KB) is dynamically imported inside the functions that render barcodes, not in the initial chunk

**Where they live:**
- Decode pipeline: `apps/web/src/hooks/useBarcodeScan.tsx`
- Render pipeline: `apps/web/src/lib/barcode-render.ts` + `apps/web/src/components/products/BarcodeDisplay.tsx`
- Internal CODE_128 generator: `packages/shared/src/barcodes.ts`

---

### Hosting: Vercel

**What it is:** Serverless hosting platform with native monorepo support.

**Why we chose it:**

1. **Free tier** — Generous for small projects.
2. **Zero config for the framework itself** — Vercel auto-detects Next.js once Root Directory points at `apps/api/`.
3. **Edge network** — Global CDN included.
4. **Preview deployments** — Every PR gets a URL.
5. **Single-deploy SPA + API** — The Vite SPA is folded into `apps/api/public/` at build time; one Vercel project serves both.

**Vercel project settings (one-time, in dashboard):**
- **Root Directory**: `apps/api`
- **Include source files outside of the Root Directory in the Build Step**: enabled — this lets the API's prebuild hook reach `apps/web/` when Vercel checks out the repo.
- **Framework Preset**: Next.js (auto-detected).
- Install / Build commands: leave on defaults — `apps/api/vercel.json` overrides install in code.

**`apps/api/vercel.json`:**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "installCommand": "cd ../.. && npm ci"
}
```

The `cd ../.. && npm ci` is load-bearing. Vercel's monorepo install in a Root-Directory-scoped Next.js project only installs the slice of the workspace tree that's reachable from `apps/api`'s `dependencies` (~483 packages observed) instead of the full tree (~828 locally). Without the override, `apps/web/node_modules/` is empty when the prebuild step runs `npm run build --workspace=@kasero/web`, and `tsc -b && vite build` fails with hundreds of `TS2307: Cannot find module '@ionic/react'` / `'react-intl'` / etc. errors. Running `npm ci` from the repo root pulls every workspace's deps in one pass.

**Build pipeline:**
1. Vercel `cd ../.. && npm ci` (per `apps/api/vercel.json`).
2. Vercel returns to `apps/api/` and runs `npm run build`.
3. The `prebuild` script (`apps/api/scripts/prepare-spa.mjs`) builds the Vite SPA via `npm run build --workspace=@kasero/web` if `apps/web/dist/` is missing, then copies the dist into `apps/api/public/` (preserving any non-SPA content already there, e.g. dev `media/` uploads).
4. `next build` produces the Lambda bundle plus the static `public/` tree.

**Headers:** Live in `apps/api/next.config.js` `headers()` (HSTS, CSP, X-Frame-Options, Permissions-Policy, COOP/COEP, etc.) — applied to every route, API and SPA alike. There's no top-level `vercel.json`.

**Cache busting:** When pushing changes that affect dependency installation (lockfile, workspaces, new platform binaries), force a clean build: Vercel dashboard → **Deployments** tab → three-dot menu → **Redeploy** → uncheck **"Use existing Build Cache"**. There is no separate "Clear Build Cache" button. Project-wide alternative: env var `VERCEL_FORCE_NO_BUILD_CACHE=1`.

**Limits (free tier):**
- 100GB bandwidth/month
- 6000 minutes build time/month
- Serverless function timeout: 10s

---

## Multi-Tenant Architecture

The database supports multiple businesses (tenants) with a many-to-many relationship between users and businesses.

**Core Relationship:**
```
User (1) ──── (Many) BusinessUsers ──── (Many) Businesses
```

- One user can own/manage multiple businesses
- One business can have multiple team members with different roles
- The `businessUsers` table stores role (owner/partner/employee) and status per membership

```typescript
// Every query filters by businessId
const products = await db.query.products.findMany({
  where: eq(products.businessId, businessId)
})

// User access validated via businessUsers table
const membership = await db.query.businessUsers.findFirst({
  where: and(
    eq(businessUsers.userId, userId),
    eq(businessUsers.businessId, businessId)
  )
})
```

**Benefits:**
- Single database, lower cost
- Shared infrastructure
- Users can manage multiple businesses
- Role-based access per business

**Data isolation:**
- All queries include businessId filter
- API routes validate user membership via businessUsers table
- Role-based permissions (owner > partner > employee)
- No cross-tenant data access possible

---

## Migration history (high-level)

The app has been through three architectural eras:

1. **PocketBase + Firebase Auth** — early days, $5+/month, Phone SMS OTP costs.
2. **Monolithic Next.js + custom Framer Motion layered nav** — moved to Vercel free tier; introduced the LayerStack / RouteOverlay pattern that produced persistent iOS Safari rendering bugs.
3. **Monorepo with Vite + Ionic SPA + Next.js API-only (current)** — replaced the custom layer system with Ionic's hardened stack-navigation primitives; split into per-app workspaces; same Drizzle/Turso data layer underneath with auth re-platformed onto better-auth (DB sessions, fully passwordless email-OTP sign-in, Google OAuth).

The motivation for the most recent split is documented in detail in the design spec at `.claude/docs/plans/2026-05-06-vite-ionic-monorepo-design.md`.

---

## Development Setup

### Prerequisites
- Node.js 20+
- npm
- Turso CLI is only needed for production database operations (`db:push:prod`). Local dev requires no external services.

### Environment Variables

Both apps have their own `.env.local`. Both are gitignored.

```bash
# apps/api/.env.local
AUTH_SECRET=your-secret-key-min-32-chars     # required — better-auth secret;
                                              # signs session cookies and verification rows
BETTER_AUTH_URL=http://localhost:8000         # optional; default in dev
BETTER_AUTH_TRUSTED_ORIGINS=                  # optional — extra origins better-auth's
                                              # CSRF check should accept beyond
                                              # BETTER_AUTH_URL (comma-separated).
                                              # http://localhost:3000 and :8000 are
                                              # always trusted in code. Used for
                                              # Tailscale MagicDNS hostnames in dev
                                              # when testing on a phone; unused in
                                              # prod (same-origin via Vercel).
API_PORT=8000                                 # default; override if needed

# Required only for production
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your-token

# Required for email delivery (OTP send + dual-OTP email-change)
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=Kasero <noreply@your-domain>

# Optional (Google OAuth — Google sign-in only registers when BOTH are set)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Required in production (daily unverified-account cleanup cron)
CRON_SECRET=long-random-string

# Optional (AI features)
OPENAI_API_KEY=sk-...
FAL_KEY=...

# Optional (distributed rate limiting for non-auth routes)
UPSTASH_REDIS_REST_URL=https://your-instance.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token

# Vercel-only (realtime SSE pub/sub + streams via ioredis)
# NOT in .env.local — local dev uses the in-memory backend automatically.
# UPSTASH_REDIS_URL=rediss://...  (set in Vercel Production + Preview env vars)

# Optional (dev-only — required by `npm run i18n:translate`)
ANTHROPIC_API_KEY=sk-ant-...
```

```bash
# apps/web/.env.local
VITE_WEB_PORT=3000                              # optional; default 3000
VITE_API_PROXY_TARGET=https://localhost:8000    # optional; matches API_PORT
```

Local dev uses `apps/api/data/local.db` automatically — just run `npm run dev` after setting `AUTH_SECRET`.

### Commands (from repo root)

| Command | Description |
|---------|-------------|
| `npm run dev` | Both servers in parallel (`dev:api` + `dev:web`) |
| `npm run dev:api` | API only |
| `npm run dev:web` | Web only |
| `npm run build` | Production build for both apps |
| `npm run lint` | Lint every workspace |
| `npm run test` | Test every workspace |

### Per-app scripts of note

- `apps/api/`: `db:push`, `db:push:prod`, `db:studio`, `start`, `start:local` (HTTPS preview for SW + PWA install testing on a phone via Tailscale), `i18n:translate`, `splash:generate`, `test:run`, `auth:migrate -- <filename>` (dev runner for `packages/shared/migrations/*.sql`), `auth:migrate:prod -- <filename>` (same against Turso — export `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` inline).
- `apps/web/`: `preview`, `test:run`.

---

## Future Considerations

### File Storage

**Product Icons:** Base64 data URLs stored in the database (local SQLite in dev, Turso in prod).
- AI-generated emoji icons (~50-100 KB each)
- No external storage service needed
- Icons included in database row

**Order Receipts:** Cloudflare R2 (S3-compatible) is on the roadmap for receipt images. 10 GB free tier; URLs would be stored in `orders.receipt`. Not yet implemented.

The Turso free tier (500M row reads, 25M writes, 9GB storage) supports ~1,000-2,000 businesses in production.

### Offline write queue
Today we have **read-only** offline support via the Workbox service worker — cached GET responses keep the app browsable, and mutations attempted while offline surface a translated `OFFLINE_MUTATION_BLOCKED` envelope error. For **offline writes** (queue mutations locally and replay on reconnect):
- IndexedDB-backed mutation queue with replay-on-online (custom)
- Turso embedded SQLite replicas with bidirectional sync (heavy refactor)
- Workbox Background Sync API (browser-native, but limited cross-browser support)

Conflict resolution is the hard part — none of these solve "two devices edited the same row" automatically. Defer until there's real user demand.

### Real-time Updates

Implemented: SSE over Upstash Redis pub/sub + Streams. See `.claude/docs/realtime-system.md`.

### Native iOS/Android (deferred)
Capacitor would let us wrap the SPA into a native shell using the same Ionic codebase. Not in scope for this migration, but the move to Ionic deliberately keeps that path open.

### State migration to Zustand/Jotai (deferred)
The 13 Context providers work and the migration is independent of the Vite + Ionic move. Deferred.

---

## References

- [Vite Documentation](https://vite.dev)
- [Ionic React Documentation](https://ionicframework.com/docs/react)
- [react-router v5 Documentation](https://v5.reactrouter.com)
- [react-intl Documentation](https://formatjs.github.io/docs/react-intl)
- [vite-plugin-pwa Documentation](https://vite-pwa-org.netlify.app)
- [Workbox Documentation](https://developer.chrome.com/docs/workbox)
- [Turso Documentation](https://docs.turso.tech)
- [Drizzle ORM Documentation](https://orm.drizzle.team)
- [better-auth Documentation](https://www.better-auth.com/docs)
- [Resend Documentation](https://resend.com/docs)
- [Next.js Documentation](https://nextjs.org/docs)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
