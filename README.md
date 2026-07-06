# Kasero

A multi-business management system for small businesses. Built for speed, simplicity, and offline capability.

## Features

- **Multi-Business** - Manage multiple businesses from one account
- **Product Catalog** - AI snap-to-add (photo to product), AI-generated icons, categories, stock tracking, barcode scanning and generation
- **Sales Register** - Open/close sessions with cash reconciliation, cart discounts, per-business tax, sale voiding with stock restoration, shareable receipts
- **Expenses** - Expense tracking with AI receipt capture (photograph a receipt to prefill the entry)
- **Kasero Pulse** - AI digest of weekly sales/expenses/stock, written in the user's language with amounts in the business locale
- **Kasero Pro** - Per-business subscription (higher AI quota, Pulse); promo-code redemption live, store billing adapter awaiting App Store / Play products
- **Team Management** - Invite partners/employees with role-based access, ownership transfer
- **Realtime** - Multi-device sync over SSE (sales, products, team, plan changes)
- **Passwordless Auth** - Email one-time-code plus Google and Apple sign-in (better-auth, database-backed sessions)
- **PWA + Native** - Works offline, installable on mobile; Capacitor iOS/Android apps with bearer auth (`apps/web/ios`, `apps/web/android`)
- **i18n** - 11 languages (de, en-US, es, fil, fr, it, ja, ko, pt, vi, zh) driven by a single locale registry; self-hosted fonts

## Tech Stack

| Component | Technology |
|-----------|------------|
| **Frontend (apps/web/)** | Vite 8, React 19, TypeScript, Ionic React 8, react-router v5 |
| **Backend (apps/api/)** | Next.js 16 (API-only), Drizzle ORM, better-auth (email-OTP + Google/Apple OAuth) |
| **Shared (packages/shared/)** | Drizzle schema, types, ApiMessageCode, locale registry |
| **Styling** | Tailwind CSS v4 + brand CSS variables + Ionic theme bridge |
| **Database** | Local SQLite (dev) + Turso/libSQL (prod) |
| **i18n** | `react-intl` with ICU MessageFormat |
| **PWA** | `vite-plugin-pwa` (Workbox `injectManifest`) |
| **Icons** | Lucide React + custom SVGs |
| **Barcodes** | `html5-qrcode` (decode) + `bwip-js` (render) |
| **Rate limiting** | `@upstash/ratelimit` (prod) + in-memory fallback (dev) |
| **Realtime** | SSE over Upstash Redis pub/sub + Streams (`ioredis`); in-memory backend in dev |
| **Hosting** | Vercel (single deployment; SPA folded into `apps/api/public/` at build time) |

Single-origin in production: the Vite SPA is built and copied into `apps/api/public/` by `apps/api/scripts/prepare-spa.mjs` (the API's `prebuild` hook). One Next.js deployment serves both `/api/*` and the SPA shell.

## Quick Start

```bash
npm install
# Set AUTH_SECRET in apps/api/.env.local (min 32 chars)
npm run dev
```

| Service | URL |
|---------|-----|
| Web (Vite) | https://localhost:3000 |
| API (Next.js) | https://localhost:8000 |

In dev, Vite proxies `/api/*` to the API server, so the SPA calls the API same-origin.

## Scripts (run from repo root)

| Command | Description |
|---------|-------------|
| `npm run dev` | Start both servers in parallel (`dev:api` + `dev:web`) |
| `npm run dev:api` | API only |
| `npm run dev:web` | Web only |
| `npm run build` | Build all workspaces (`@kasero/shared` → `@kasero/web` → `@kasero/api`) |
| `npm run lint` | Lint every workspace |
| `npm run test` | Test every workspace |

Per-app scripts of note (run inside the workspace, or via `npm run <script> --workspace=apps/<app>`):

- `apps/api/`: `db:push`, `db:push:prod`, `db:studio`, `start`, `start:local` (HTTPS preview of prod build), `i18n:translate`, `splash:generate`, `test:run`
- `apps/web/`: `preview` (plain), `test:run`

## Environment Variables

Each app has its own `.env.local` (both gitignored). See `apps/api/.env.example` and `apps/web/.env.example` for the full templates.

Required:
- `AUTH_SECRET` (in `apps/api/.env.local`) — better-auth session signing secret, min 32 chars

Production only:
- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`

Optional:
- `OPENAI_API_KEY`, `FAL_KEY` — AI features (snap-to-add, receipt capture, Pulse)
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — distributed rate limiting in prod
- `PRO_PROMO_CODES` — Kasero Pro promo grants, `CODE:months` comma-separated
- `ANTHROPIC_API_KEY` — used by `npm run i18n:translate --workspace=apps/api` (dev-only)

Local dev uses `apps/api/data/local.db` automatically — no Turso CLI or account needed.

## Project Structure

```
kasero/
├── apps/
│   ├── api/        # Next.js (API-only); 63 routes; serves SPA + marketing/compliance pages from public/ in prod
│   └── web/        # Vite SPA (Ionic React Router shell) + Capacitor iOS/Android projects
└── packages/
    └── shared/     # Drizzle schema, types, ApiMessageCode, locale registry,
                    # business-role helpers, barcode utilities, sales helpers
```

For deep documentation (architecture, i18n system, modal/tab/barcode systems, performance patterns, deployment), see `.claude/docs/`.

## License

Private - All rights reserved.
