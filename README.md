# Kasero

A multi-business management system for small businesses. Built for speed, simplicity, and offline capability.

## Features

- **Multi-Business** - Manage multiple businesses from one account
- **Product Catalog** - AI-powered product icons, categories, stock tracking, barcode scanning and generation
- **Inventory** - Track stock levels and supplier orders
- **Sales Register** - Open/close sales sessions, ring up sales, daily aggregates
- **Team Management** - Invite partners/employees with role-based access
- **Ownership Transfer** - Transfer business ownership to another user
- **Email Auth** - Simple email/password authentication
- **PWA** - Works offline, installable on mobile
- **i18n** - English, Spanish, Japanese (driven by a single locale registry)

## Tech Stack

| Component | Technology |
|-----------|------------|
| **Frontend (apps/web/)** | Vite 6, React 19, TypeScript, Ionic React 8, react-router v5 |
| **Backend (apps/api/)** | Next.js 15 (API-only), Drizzle ORM, jose JWT, bcryptjs |
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
- `AUTH_SECRET` (in `apps/api/.env.local`) — JWT signing secret, min 32 chars

Production only:
- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`

Optional:
- `OPENAI_API_KEY`, `FAL_KEY` — AI features
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — distributed rate limiting in prod
- `ANTHROPIC_API_KEY` — used by `npm run i18n:translate --workspace=apps/api` (dev-only)

Local dev uses `apps/api/data/local.db` automatically — no Turso CLI or account needed.

## Project Structure

```
kasero/
├── apps/
│   ├── api/        # Next.js (API-only); 55 routes; serves SPA from public/ in prod
│   └── web/        # Vite SPA (Ionic React Router shell)
└── packages/
    └── shared/     # Drizzle schema, types, ApiMessageCode, locale registry,
                    # business-role helpers, barcode utilities, sales helpers
```

For deep documentation (architecture, i18n system, modal/tab/barcode systems, performance patterns, deployment), see `.claude/docs/`.

## License

Private - All rights reserved.
