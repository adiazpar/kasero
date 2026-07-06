# Kasero — Monetization + UI Overhaul Implementation Plan

Date: 2026-07-06. Scope: execute the launch plans with monetization at launch (owner directive overrides the strategy doc's launch-free recommendation), two distinctive AI Pro features, a cleaner/smaller typography system, and an app-wide motion pass. Companion docs: `2026-07-02-app-store-launch-plan.md`, `2026-07-02-owner-action-guide.md`.

## 1. Monetization: Kasero Pro (per business)

Per the launch plan §2 the tier is **per business** (not per store/location), regionally priced later via store-side pricing. The public free-forever promise is preserved: nothing currently free is removed; the only meter is AI volume, which has real marginal cost.

### Data model (`packages/shared/src/db/schema.ts`, `businesses` table — additive)

- `plan` text enum `['free','pro']` notNull default `'free'`
- `plan_expires_at` integer timestamp, nullable (null on free; on pro null = non-expiring grant)
- `plan_source` text enum `['none','apple','google','promo']` notNull default `'none'`

### Shared entitlements (`packages/shared/src/entitlements.ts`, new)

- `isPro(plan, planExpiresAt, now?)` — pro AND (no expiry or expiry in future).
- `PRO_PRICING = { monthlyUsd: 7.99, annualUsd: 79.99 }` — display-only reference; store products are the billing source of truth.
- Entitlement descriptor consumed by both apps (AI daily quota: free 100 → pro 400; pulse: pro unlimited-within-quota, free 1 sample/month).

### API

- `GET /api/businesses/[businessId]/subscription` — any member; returns `{plan, expiresAt, source}`.
- `POST /api/businesses/[businessId]/subscription/redeem` — owner-only, body `{code}` validated against env `PRO_PROMO_CODES` (`CODE:months` comma-separated; e.g. `LAUNCHCREW:12`). Promo codes are marketing/beta grants, never sold outside the stores (Apple 3.1.1). Hard rate limit (5/hour/user, fail-closed on brute force). Extends `plan_expires_at` if already pro. Publishes `business.updated` with `fields: ['plan']`, invalidates the server access cache.
- `POST /api/businesses/[businessId]/subscription/verify-purchase` — owner-only; `{platform: 'apple'|'google', receipt}`. Adapter seam (`apps/api/src/lib/billing/apple.ts`, `google.ts`): returns 503 `SUBSCRIPTION_NOT_CONFIGURED` until the owner wires App Store Server API / Play Developer API credentials. Never trust an unverified receipt.
- `BusinessAccess` gains `plan` + `planExpiresAt` (rides the existing 60s access cache; invalidate on change).
- New `ApiMessageCode`s under a SUBSCRIPTION header: `SUBSCRIPTION_REDEEM_SUCCESS`, `SUBSCRIPTION_INVALID_CODE`, `SUBSCRIPTION_NOT_CONFIGURED`, `SUBSCRIPTION_OWNER_ONLY`, `PRO_REQUIRED`, `PULSE_FREE_LIMIT_REACHED`, `AI_RECEIPT_FAILED`.

### Web

- `business-context` exposes `isPro`; sessionStorage per-business cache key for subscription state.
- Manage tab: new `section_subscription` row (plan status) opening `ProUpgradeModal` (ModalShell, EditTaxModal pattern): Pro pillars, price display via `PRO_PRICING` + `useBusinessFormat`, native purchase button that renders a "coming to the App Store" state while the store adapter is unconfigured, promo-code redemption (working end-to-end), and a manage state when already Pro.
- `apps/web/src/lib/billing/` adapter: `Capacitor.isNativePlatform()` → store adapter (stub, documented wiring steps for RevenueCat or StoreKit2 plugin) vs web (redeem-code + "get it in the app" messaging; web billing out of scope at launch per plan §2).
- Reusable `ProGate` teaser components for feature surfaces (Pulse card).

### Never-list (from the strategy doc, enforced in code review)

No ads, no per-employee pricing, no removal of currently-free features, no export gating. Grandfathering: promo grants set explicit expiry; store subs manage their own.

## 2. Pro feature A — AI receipt snap → expense

- `POST /api/ai/parse-receipt` (withBusinessAuth on businessId in body? No — mirror existing AI routes: `withAuth` + explicit businessId param and access check, so the entitlement tier is resolvable). gpt-4o-mini vision, raw fetch pattern from `identify-product/route.ts`, `decodeAndSniffAiImage`, `enforceMaxContentLength` 2MB, three-layer rate limits with pro-tier daily bucket (`ai-daily-pro:` prefix, separate `RateLimits.aiDailyPro` — do not reuse the `ai-daily:` key with a different window config).
- Returns `{amount, date, merchant, note, categoryName}` (hand-validated like `IdentifyResult`). Client fuzzy-matches `categoryName` against existing expense categories; unmatched → null.
- UI: photo/scan entry point in `AddExpenseModal` (the header comment already reserves this as v2), reusing `useImageCompression`; result prefills amount/date/note/category with an editable review state — never auto-saves.
- Metered free feature (not hard-gated): it feeds the anti-paywall story; Pro raises the quota.

## 3. Pro feature B — Kasero Pulse (localized AI business digest)

- `POST /api/businesses/[businessId]/pulse` — gathers existing aggregates server-side (`sales/aggregate` query builders, `computeStats`, expenses summary, low-stock products), feeds structured JSON to gpt-4o-mini (text), responds `{headline, sections[], watchouts[]}` written in the **user's UI language** (`users.language`) with amounts pre-formatted server-side using the business locale/currency (never let the model do math or formatting).
- Gate: Pro → within AI quota; Free → 1 sample per calendar month (month-stamped rate-limit key, limit 1), then `PULSE_FREE_LIMIT_REACHED` drives the paywall teaser.
- UI: Pulse card on the Home view (teaser when free, generate button when entitled), full digest in a ModalShell with the report-entrance animation language. This is the flagship "why Pro exists" surface and the 11-locale structural advantage from plan §2b.

## 4. Typography — cleaner and smaller

Direction: **reserve the serif for brand moments; UI chrome goes clean sans, one step smaller.** All via tokens in `base.css` + `ionic-theme.css` bridges; no component-level px.

- Scale: base 16→15, sm 14→13, xs 12→11.5 (keep ≥11 for a11y), lg 18→17, xl 20→19, 2xl 24→22, 3xl 30→27, 4xl 36→32. Body line-height 1.6→1.5.
- h1/h2 keep Fraunces (hero/brand). h3/h4 move to `--font-body` weight 600/650 (cleaner UI headings). IonTitle toolbar → `--font-body`, 600, 17px (native-feeling toolbars).
- Self-host fonts (Fraunces, Geist, JetBrains Mono variable woff2 via fontsource packages), drop the Google Fonts `<link>`: tightens CSP (`font-src`/`style-src` no longer need Google origins), fixes offline/native cold-start. Update CSP in `next.config.js` accordingly (removal only).
- New tokens: `--leading-tight/-normal`, `--tracking-tight/-normal` for consistency.

## 5. Motion — native-feel pass

- Global `@media (prefers-reduced-motion: reduce)` gate in `base.css` killing keyframes/transitions (currently only 4 individual opt-outs exist).
- New tokens: `--ease-spring: cubic-bezier(0.175, 0.885, 0.32, 1.1)`, `--press-scale: 0.97`.
- Press states: shared `.pressable` treatment (scale + opacity, `--duration-instant`) applied to POS tiles, hub business cards, stat tiles, list rows via existing CSS files.
- List entrance stagger utility (CSS `animation-delay` via `nth-child`, capped at 8) for products/expenses/sales lists.
- Stat count-up hook (`useCountUp`, rAF, reduced-motion aware) on Home revenue tile.
- Tab bar: active-icon spring pop; keep `shellBackTransition` as is (already tuned).

## 6. Launch-plan execution items in this session

- Landing + compliance pages under `apps/api/public/` (welcome, privacy, delete-account, AASA, assetlinks) — in progress via agent.
- Branded native icons/splash from `icon-source.png`/`kasero-logo.png` masters via sharp + `@capacitor/assets`; iOS simulator build smoke via `DEVELOPER_DIR=/Applications/Xcode.app`.
- Prod DB push evaluated at the end (additive columns only: prior session's tax/void columns + this session's plan columns).
- POSTMORTEM.md restored with a "Reopened" chapter (the 2026-05-16 closure was reversed by the June–July revival; record why and what changed); kasero-overview.html updated; owner action guide updated with new env vars (`PRO_PROMO_CODES`) and store-side monetization steps (IAP products, Small Business Program).

## 7. Execution order

1. Monetization core (schema → shared → API → web paywall) — delegated, detailed spec.
2. Typography + motion (styles-only, no overlap with 1) — done directly.
3. Receipt AI, then Pulse (sequential: both touch locale JSONs + api-messages).
4. Native assets + iOS build smoke.
5. Full verification (530+ tests, lint, build, Playwright walkthrough), docs, themed commits.

i18n discipline for every step: keys land in `en-US.json` + real translations in all 10 other locales, `npm run i18n:types`, envelope codes mirrored to `apiMessages.*`.
