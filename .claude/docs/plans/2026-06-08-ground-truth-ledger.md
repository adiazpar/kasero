# Kasero — Ground-Truth Ledger (2026-06-08)

Verified against ACTUAL SOURCE this session (the prose docs drifted; source wins). Doc-fix agents:
treat this as the corrections list, but **re-verify any specific number/name against source before editing**,
and **do not "fix" something that is already correct**. Some `JWT` mentions are legitimate (Apple OAuth
client-secret is a signed JWT) — do not turn those into "better-auth".

## How to verify quickly
- Structural lookups: `export PATH="$HOME/.local/bin:$PATH"; graphify query "<question>"` or `graphify explain "<node>"` (graph at `graphify-out/`).
- Exact claims (versions, file contents, counts): read the real source file. Examples below cite the file.

## Corrected facts (the known drift)

| Topic | STALE (in some docs) | CURRENT TRUTH | Source of truth |
|---|---|---|---|
| Auth | "email/password", "jose JWT", "bcryptjs", "JWT" | **better-auth**: passwordless **email-OTP + Google + Apple OAuth**, **DB sessions** (Turso, 7-day). Password column dropped in 2026-05-14 migration. | `apps/api/src/lib/auth.ts` |
| i18n locales | "English, Spanish, Japanese" (3) | **11 locales**: de, en-US, es, fil, fr, it, ja, ko, pt, vi, zh — from one registry | `apps/web/src/i18n/messages/`, `packages/shared/src/locales.ts` |
| Vite | "Vite 6" | **Vite 8** (8.0.10) | `apps/web/package.json` |
| Next.js | "Next.js 15" | **Next.js 16** (16.2.6) | `apps/api/package.json` |
| React | (ok) "React 19" | React **19.2.6** | `apps/web/package.json` |
| Ionic React | "Ionic React 8" | Ionic React **8.8.5** (fine to say "8") | `apps/web/package.json` |
| API routes | "55 routes" | **54** route.ts handlers | `find apps/api/src/app/api -name route.ts | wc -l` |
| Other versions | — | react-router 5.3.4, Tailwind ^4, Drizzle 0.45.1, @libsql/client 0.17.2, ioredis 5.10.1, zod ^4, better-auth 1.6.11 | the two `package.json`s |

## Correct as-is (do NOT change)
- Monorepo (npm workspaces): `apps/web` (Ionic React SPA), `apps/api` (Next.js API-only), `packages/shared`. TS project references.
- Single-origin: `apps/api/scripts/prepare-spa.mjs` copies built SPA → `apps/api/public/`. Dev: API 8000, Vite 3000, `/api/*` proxied.
- DB: local SQLite (`apps/api/data/local.db`) dev, Turso/libSQL prod. `@libsql/client/web` in prod to avoid bundling native `.node` (`apps/api/src/db/index.ts`).
- Realtime: SSE over Upstash Redis pub/sub + Streams (ioredis), in-memory dev backend. Non-critical = fail-open; `publishCriticalToUser` = fail-closed → 503 `REALTIME_PUBLISH_UNAVAILABLE` for `session.revoked` / `business.deleted` / `ownership.transferred`. (`apps/api/src/lib/realtime/publisher.ts`)
- API envelope: `errorResponse` / `successResponse` / `validationError` + `ApiMessageCode` in `apps/api/src/lib/api-middleware.ts`. Also `enforceSameOrigin` (CSRF), `applyRateLimit` (fail-closed 503 `RATE_LIMITER_UNAVAILABLE`), `enforceMaxContentLength` (256KB).
- Apple: client secret minted at module load (`auth.ts`) — that JWT is REAL and correct.

## Stale code comments to fix (examples — grep for more)
- `apps/api/src/app/api/transfer/accept/route.ts` ~L92: "The JWT already carries the user's email" — no JWT auth anymore; reword to reflect better-auth session.
- Grep code comments for `JWT`, `jose`, `password`, `bcrypt` and judge each (Apple client-secret JWT is legitimate; auth-session JWT references are stale).

## Files in scope for the sweep
README.md · .claude/CLAUDE.md · .claude/docs/{tech-stack, backend-patterns, apple-sign-in-setup, i18n-system, realtime-system, realtime-implementation-reference, modal-system, tab-system, barcode-system, performance-patterns, ai-product-pipeline, POSTMORTEM}.md · stale source comments.
**Out of scope:** memory files (feedback-only, no project facts); the root `CLAUDE.md` (graphify's own directive); `graphify-out/`.
