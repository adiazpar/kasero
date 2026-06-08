# Kasero Explainer — Design Spec

**Date:** 2026-06-08
**Deliverable:** A single, self-contained HTML file explaining how Kasero works, for a live presentation.
**Build tool:** `frontend-design` skill (explicit user request).
**Output path:** `/Users/adiaz/irvin/kasero-overview.html` (repo root, opens with no server). Gitignore-optional.

## Audience

The viewer is from **Upaok** (upaok.com) — a global software-development network that vets senior
engineers and ships "production-grade software" for startups. So the viewer is **technical and
evaluates engineering quality for a living**. The piece must read as a credibility artifact: a
real product, engineered to production-grade standards. Upaok's own values — *"distributed teams,
transparent process, production-grade software"* — map directly onto how Kasero is built, and the
close should land that quietly.

## Direction (from user)

- **1C, lean technical** — product story up top, then a "how it's built" section deep enough for an engineer.
- **2C** — balanced product + architecture.
- **3A** — sleek single-page **scrollytelling**, animated section reveals, real architecture diagram, Kasero brand palette.
- **Include real code examples** (pulled verbatim from the codebase, not invented).
- **Explain *why* each thing is designed the way it is — the real-world impact**, not just what it is.

## Core motif: Decision → Why → Impact

This is the spine of the whole piece and the thing the Upaok reviewer is actually evaluating: engineering
**judgment**, not a feature list. Every architecture/engineering point is presented as a small triad:

- **Decision** — what was built (one line, often with a verbatim code snippet).
- **Why** — the constraint or failure mode that forced it.
- **Real-world impact** — what it buys a real user / operator / the team.

Render these as a consistent visual unit (a labeled 3-part card or a left-rail "Why" pull-quote beside
each code block) so the rationale is impossible to miss. Worked examples to seed the copy:

- *Single-origin deploy* → **Why:** two origins means CORS, third-party-cookie breakage, and two deploy
  targets to keep in sync. → **Impact:** one Vercel deployment, cookies "just work," no CORS config, fewer moving parts to break in front of a customer.
- *Money is a business property (`useBusinessFormat`)* → **Why:** a vendor in Lima must see `S/ 9.99`, one
  in Texas `$9.99`; language (a person) and currency/format (a business) are different axes. → **Impact:**
  correct money everywhere with zero per-component locale logic; never a `$` hardcoded into a Peruvian receipt.
- *Realtime fails open for hints, closed for security* → **Why:** a dropped "list changed" nudge is
  cosmetic; a dropped `session.revoked` after an ownership transfer is a security hole. → **Impact:** the
  former never breaks a request; the latter returns 503 and forces a retry rather than silently leaving a stale session live.
- *Fail-closed rate limiting* → **Why:** if Upstash is unreachable, silently dropping brute-force protection
  is worse than erroring. → **Impact:** auth stays protected even during an infra outage (503, doesn't quietly disable the guard).
- *Atomic ownership transfer invariants* → **Why:** two users racing a transfer could create a double-owner
  or hand a business to a just-disabled account. → **Impact:** in-transaction `.returning()` row checks make the illegal states unrepresentable — correctness under concurrency, not hope.
- *Apple client-secret minted at module load* → **Why:** Apple's OAuth secret is a JWT that expires in
  ≤6 months. → **Impact:** no human gets paged to rotate a secret twice a year; it regenerates on boot.
- *libsql dual entry (`@libsql/client/web` in prod)* → **Why:** Vercel's bundler can't ship the native
  `.node` driver. → **Impact:** prod builds cleanly on Vercel while dev keeps fast local `file:` SQLite.

## Constraints

- **One self-contained `.html` file.** Inline CSS + JS. No external network calls, no CDN, no build
  step — must open by double-click anywhere, including offline during the presentation.
- System fonts only (or a single inline-embedded font). No Google Fonts (also honors the project's CSP discipline).
- No emojis (project rule). Use SVG glyphs / CSS for any iconography.
- Accurate to ground truth (verified against source, not stale docs — see below).

## Brand palette (from `apps/web/src/styles/base.css` — use verbatim)

Earthy, warm, artisanal — fits the food-vendor/artisan customer base and reads as distinctive, not generic-AI.

- Brand (terracotta/rust): `#B5471F`  · hover `#98381A` · tint `#C9613A` · subtle `#F7E5DA`
- Paper backgrounds: `#F6EFDF` / `#F2EAD6` / `#ECE2C9` · surface `#FFFCF5`
- Ink (text): `#1B1815` / `#514B40` / `#8B8475`
- Accents: saffron `#C8881C` · moss `#4F6B36` · oxblood `#8B2D2D` · indigo `#2C334D`
- Hairlines: `#DCD2BB` / `#E6DCC4`
- (A dark variant exists; the explainer ships the light "paper" theme for legibility on a projector.)

## Verified ground truth (use these — several public docs are stale)

- **Monorepo (npm workspaces), 3 packages** (versions verified against installed `package.json`):
  - `apps/web/` — **Vite 8** + **React 19.2** + TypeScript + **Ionic React 8.8** SPA, `@ionic/react-router` (react-router v5), stack-based mobile navigation.
  - `apps/api/` — **Next.js 16 in API-only mode**, **54 route handlers**, Drizzle ORM (0.45), Zod v4.
  - `packages/shared/` — Drizzle schema, types, Zod schemas, `ApiMessageCode`, locale registry, role/barcode/sales helpers. Consumed by both apps via TS project references.
- **Single-origin deployment trick:** `apps/api/scripts/prepare-spa.mjs` copies the built SPA into
  `apps/api/public/`, so one Vercel/Next.js deployment serves both `/api/*` and the SPA shell —
  no CORS, cookies work natively. Dev: API on 8000, Vite on 3000, `/api/*` proxied.
- **Database:** local SQLite (`apps/api/data/local.db`) in dev, **Turso/libSQL** in prod.
- **Auth:** **better-auth** (`apps/api/src/lib/auth.ts`) — DB sessions (Turso, 7-day), **passwordless
  email-OTP + Google + Apple OAuth**, daily unverified-account cleanup cron. Truly passwordless — the
  password column was dropped in a 2026-05-14 migration. (README/CLAUDE.md "JWT/password" notes are STALE.)
  Hardening worth showing: a custom `before` hook blocks cross-account OTP cookie-cache poisoning, and
  `freshAge:0` swaps better-auth's calendar-age freshness check for route-level fresh-OTP step-up — each
  with a code comment citing the exact upstream file/line it works around.
- **i18n:** `react-intl` + ICU MessageFormat, **11 locales shipped** from a single registry
  (`packages/shared/src/locales.ts`): de, en-US, es, fil, fr, it, ja, ko, pt, vi, zh. Every UI string
  AND every API response is translatable; typed message IDs via `messageIds.d.ts`.
- **Locale-aware formatting:** each business carries `locale` + `currency`; `useBusinessFormat()`
  renders `formatCurrency` / `formatDate` / `formatTime` per business (e.g. `$9.99` vs `S/ 9.99`).
- **Realtime:** SSE over Upstash Redis pub/sub + Streams (`ioredis`); in-memory backend in dev.
  Non-critical publishes **fail open** (log + continue); security-critical events
  (`session.revoked`, `business.deleted`, `ownership.transferred`) use `publishCriticalToUser`,
  which **fails closed** (503 `REALTIME_PUBLISH_UNAVAILABLE`).
- **Offline/PWA:** `vite-plugin-pwa` Workbox (`injectManifest`), installable, works offline.
- **Optimistic UI (corrected — the "navigate before API" framing is STALE/aspirational, not shipped):**
  modals **await** the mutation, then advance to a dedicated success step (with a Lottie animation, fully
  i18n'd). The genuinely optimistic move is **fire-and-forget background cache refresh** — e.g. cart
  checkout does `void products.refetch()` (`ChargeButton.tsx:82`) and moves on without awaiting the refetch.
  Frame section 5's "optimistic" example around that real behavior, NOT navigate-before-API.
- **Styling:** Tailwind v4 + brand CSS variables + Ionic theme bridge (`ionic-theme.css`).

### Production hardening (verified — high-signal for a senior reviewer; each is a Decision→Why→Impact triad)

- **Same-origin CSRF guard before auth** — `enforceSameOrigin()` (`api-middleware.ts`) compares
  Origin/Referer against `X-Forwarded-Host` and runs *before* the auth lookup, so a cross-site request
  can't even probe response timing. Defense-in-depth on top of SameSite cookies.
- **Fail-closed rate limiting** — `applyRateLimit` returns 503 `RATE_LIMITER_UNAVAILABLE` if Upstash is
  unreachable instead of silently disabling brute-force protection. Auth OTP buckets are strict (send-OTP 1/min).
- **Body-size guard before buffering** — `enforceMaxContentLength` (256 KB default, 411 if no
  Content-Length) with a documented iOS-Safari/PWA DELETE exemption — real production scar tissue.
- **Atomic ownership transfer** — two in-transaction invariants (refuse if owner already demoted → no
  double-owner; refuse if recipient disabled mid-flow) using `.returning()` to detect 0-row updates
  without a follow-up SELECT (`transfer/accept/route.ts`).
- **Atomic critical realtime publish** — a single Redis `MULTI/EXEC` (XADD + PEXPIRE + PUBLISH), stream
  capped at 100, 90-day TTL, in `publishCriticalToUser` (`realtime/publisher.ts`).
- **libsql dual entry** — `@libsql/client/web` in prod (no native `.node` binary to bundle on Vercel),
  native client kept in dev for `file:` URLs (`db/index.ts`).
- **Apple client-secret minted at module load** (`auth.ts`) — regenerates the short-lived Apple OAuth JWT on boot.

## Graphify-derived structural facts (credibility metrics + the "spine")

From the knowledge graph built this session (`graphify-out/`):
- **490 code files → 7,968 nodes, 11,219 edges, 153 modules (communities).**
- **God nodes** (most-connected = load-bearing): `useBusinessFormat()` (deg 69), `useBusiness()` (59),
  `useApiMessage()` (58), `useAuth()` (56), `errorResponse()` (52), `ApiMessageCode` (51), `db` (49),
  `successResponse()` (43), `ModalShell()` (40), `validationError()` (38).
- Largest module clusters: the 11 per-locale message catalogs, the React Context layer
  (business/products/sales/expense-categories/sales-sessions), the modal + product-form stack,
  the API-route cluster (transfer/accept/ownership), and the auth/animation guard layer.

## Product feature set (for the product-story section)

Multi-business · Product catalog (AI-generated icons, categories, stock, barcode scan + generate) ·
Inventory + supplier orders · Sales register (open/close sessions, ring up sales, daily aggregates) ·
Expenses + categories · Team management (invite partners/employees, role-based access) ·
Ownership transfer · Installable offline PWA.

## Page structure (scrollytelling, top → bottom)

1. **Hero** — "Kasero". One line: multi-business management for small businesses — built for speed,
   simplicity, and offline. Quiet sub-line signaling production-grade engineering. Brand terracotta
   on warm paper; tasteful entrance animation; scroll cue.
2. **What it is** — the customer (food vendors, artisans, retailers) and the product tour as a set of
   feature cards with SVG glyphs. Product-first, balanced.
3. **The shape of the system** — architecture overview + an inline SVG **diagram**: `apps/web` (Ionic
   SPA) ↔ `apps/api` (Next.js API-only) ↔ `packages/shared`, plus the single-origin fold-in trick and
   the SQLite→Turso data layer. Animated on scroll.
4. **The spine** — the Graphify god-node backbone as a **ranked horizontal-bar chart** (degree = bar
   length: `useBusinessFormat` 69 → `validationError` 38), framed as "the most-connected nodes in the real
   dependency graph — the load-bearing beams; touch one and the whole app feels it." (Ranked bars, not a
   fake force-graph — the real graph viz lives separately at `graphify-out/graph.html`.)
   **Code example:** the API envelope (`errorResponse` / `successResponse` / `ApiMessageCode`), with a Why/Impact triad.
5. **Production-grade engineering** — the disciplines that map to Upaok's values, each with a verbatim
   **code example**:
   - *One string, eleven languages* — `intl.formatMessage` + the translatable API envelope; 11-locale registry.
   - *Money is a business property* — `useBusinessFormat()` (`$9.99` vs `S/ 9.99`).
   - *Offline-first, optimistic* — navigate-before-API modal success pattern; Workbox SW.
   - *Realtime that fails the right way* — fail-open hints vs `publishCriticalToUser` fail-closed.
   - *Typed end to end* — TS strict + Zod schema shared across both apps.
6. **By the numbers** — animated counters: 3 workspaces · 54 API routes · 11 locales · 490 code files ·
   ~8k graph nodes · 153 modules. (All Graphify/source-verified.)
7. **Close** — one or two lines tying build quality to how the author works; echoes Upaok's
   "transparent process, production-grade software" without naming them awkwardly.

## Interaction / motion

- IntersectionObserver-driven reveal on each section (fade + rise), `prefers-reduced-motion` respected.
- Sticky thin progress bar in brand terracotta.
- Count-up animation for the "by the numbers" stats on first view.
- Code blocks use **pre-tokenized `<span>` classes** authored by hand (no runtime highlighter lib, no regex
  highlighter to maintain) — lower risk, crisp control over the palette.
- Everything degrades to a readable static document if JS is disabled.

## Code examples to embed (pull VERBATIM from these verified sources during build)

1. **API envelope + Zod** — `apps/api/src/app/api/businesses/[businessId]/categories/route.ts`
   (schema L11–13, `safeParse`→`validationError` L44–49, `successResponse` L78). Cleanest compact full route.
2. **`useApiMessage` error handling** — `apps/web/src/hooks/useUpdateBusiness.ts:50–57`
   (`err instanceof ApiError && err.envelope ? translateApiMessage(err.envelope) : ''`).
3. **`useBusinessFormat` usage** — `apps/web/src/components/expenses/ExpenseTotalsStrip.tsx:14–27`
   (`formatCurrency` inside a `formatMessage`).
4. **Optimistic background refetch (real, not navigate-before-API)** — `apps/web/.../cart/.../ChargeButton.tsx`
   around L71–91 (`void products.refetch()` fire-and-forget then advance to success step).
5. **Realtime fail-open vs fail-closed** — `apps/api/src/app/api/transfer/accept/route.ts:196–220`
   (both `publishCriticalToUser` → 503 and a non-critical `publishToUser` in ONE route — the single best snippet in the repo).

Optional 6th (if room, very high signal): **same-origin CSRF guard** or **fail-closed rate limit** from `api-middleware.ts`.

Keep each snippet short (8–16 lines), real, and lightly trimmed with `// …` where needed. **Verify line
numbers at build time** (the file may have shifted) — re-read each source before embedding.

## Out of scope (YAGNI)

- No live data, no API calls, no interactivity beyond scroll/reveal.
- Not the Graphify graph viz itself (that's a separate artifact at `graphify-out/graph.html`).
- No multi-file site, no framework, no bundler.
