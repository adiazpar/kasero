# Kasero — Owner Action Guide (what you need to do on your end)

Date: 2026-07-02. This is your checklist for everything that requires **your** hands — accounts, secrets, Apple/Google tooling, device builds, and the go-to-market. All code changes from this session are on the `main` working tree, **not committed** (see §0). Sibling docs: `2026-07-02-app-store-launch-plan.md` (strategy/positioning/monetization) and `.claude/docs/capacitor-native.md` (native architecture reference).

---

## 0. First: review and commit the work

162 files changed on `main`, uncommitted. Nothing is pushed. Before anything else:

1. Skim the diff (`git status`, `git diff`). The work splits into: backend perf, frontend perf, UI polish, new features (void/discount/tax/receipt), Capacitor native, App Review compliance, and review-fix follow-ups.
2. It is a large single working tree — I'd suggest committing in themed chunks (perf, features, native, compliance) rather than one commit, so history is reviewable. You use `git add .`; per your preference I did not stage or commit anything.
3. Current verification state (all green as of this writing): **API 350 tests, web 180 tests, 0 lint errors** (3 pre-existing warnings in untouched realtime/products files), **both apps build**.

---

## 1. Database migration (required before deploy — DO THIS or the new features 500)

New columns were added to `packages/shared/src/db/schema.ts`:
- `businesses`: `tax_rate` (real, default 0), `tax_mode` (`none|inclusive|exclusive`, default `none`)
- `sales`: `status` (`completed|voided`, default `completed`), `voided_at`, `voided_by`, `discount_amount` (default 0), `tax_rate`, `tax_amount`, `tax_mode`

All are additive `ADD COLUMN` with defaults — safe, no backfill. Run:

```bash
cd apps/api
npm run db:push          # local dev SQLite (already applied in this session)
npm run db:push:prod     # Turso production — REQUIRED before the prod deploy
```

`db:push:prod` needs `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` in `apps/api/.env.local`.

---

## 2. Environment variables

### New this session

| Var | Where | Purpose | Needed when |
|---|---|---|---|
| `VITE_API_ORIGIN` | `apps/web/.env.local` | Absolute API origin for the **native** app. Leave **empty** for web (same-origin). | Native builds only |
| `VITE_PUBLIC_WEB_ORIGIN` | `apps/web/.env.local` | Public web domain for share/invite QR links (native can't use `capacitor://`). | Native builds only |
| `APP_REVIEW_EMAIL` | `apps/api/.env.local` | Designated Apple-reviewer email that accepts a static OTP. **Inert unless both set.** | Before App Store review |
| `APP_REVIEW_OTP` | `apps/api/.env.local` | Static 6+ digit code for that one email. Never accepted for any other account. | Before App Store review |

- These are documented in the `.env.example` files (shape only). Per project convention, **the real values live in Bitwarden** — add `VITE_API_ORIGIN`, `VITE_PUBLIC_WEB_ORIGIN` to the web note and `APP_REVIEW_EMAIL`/`APP_REVIEW_OTP` to the api note so they don't drift.
- **Realtime/native token store reuses your existing Upstash** (`UPSTASH_REDIS_REST_URL` / `_TOKEN`) — no new infra. The PKCE `ott→challenge` and single-use SSE tickets are stored there with short TTLs (in-memory fallback in dev).

### Apple Sign-In (you already have the 4 `APPLE_*` vars for OAuth)
- Set `APPLE_APP_BUNDLE_IDENTIFIER=com.kasero.app` in `apps/api/.env.local` to enable **native** Sign in with Apple token verification. Keep the existing web `APPLE_*` values.

---

## 3. Native app builds (Capacitor) — the manual steps I couldn't do headlessly

The iOS + Android projects are scaffolded (`apps/web/ios`, `apps/web/android`), `capacitor.config.ts` is set (appId `com.kasero.app`, WebView host `kasero.localhost`, bundled `dist`), and `npx cap sync` succeeds. You need a Mac with the tooling:

### iOS
1. **Install Xcode 26** (App Store requires iOS 26 SDK builds since Apr 28, 2026; you currently have only Command Line Tools). 
2. `cd apps/web && npm run build:web && npx cap sync ios && npx cap open ios`.
3. In Xcode: set your **signing Team**, confirm the bundle id `com.kasero.app`, add the `kasero` URL scheme (already in the pbxproj — verify), and archive.
4. **Camera permission string is already wired** (`NSCameraUsageDescription` + localized `InfoPlist.strings` for all 11 locales).
5. First archive → upload to App Store Connect → TestFlight.

### Android
1. Android Studio: `npx cap open android`, let Gradle sync.
2. Generate a **release keystore**, wire it into `android/app/build.gradle` signing config.
3. Build a signed AAB for Play.

### Both
- **App icons + splash** currently ship Capacitor placeholders. Generate branded assets (there's an existing `scripts/generate-ios-splash.mjs`; for app icons use your 1024px master through `@capacitor/assets` or Xcode/Studio asset catalogs).
- After the WebView-host change (`kasero.localhost`), a **device rebuild** is required to pick it up (config is baked; `cap sync` already ran).
- **Deep links**: the `kasero://` custom scheme handles OAuth callback + invite links today. **Strategic follow-up (recommended before scale):** move to **Universal Links (iOS) / App Links (Android)** with verified domain association — this removes the custom-scheme interception class entirely. Host `apple-app-site-association` + `assetlinks.json` on your public domain (also serves the landing-page SEO in §6). PKCE binding is shipped as defense-in-depth in the meantime.

---

## 4. App Store / Play accounts & submission

Full detail in `2026-07-02-app-store-launch-plan.md` §4–6. Your action items:

1. **Enroll**: Apple Developer Program ($99/yr) + Google Play Console ($25 one-time). **Use organization accounts if you can** — exempts Play's 12-tester/14-day rule and eases EU DSA trader verification.
2. **Before first submission** (both are blocking):
   - Apple: answer the **new age-rating questionnaire** (due Jan 31, 2026).
   - Play: complete the **financial-features declaration** → "no financial features" (Kasero records sales, doesn't process payments).
3. **Seed the reviewer demo account**: create the `APP_REVIEW_EMAIL` user in prod, sign in once with the static OTP, and seed it with demo products/barcodes/sales/analytics + a second team member. Put the email + static code in App Review notes (email OTP is a reviewer trap otherwise — they can't receive your emails).
4. **Account deletion (5.1.1(v))**: already in-app (Delete Account) and Apple-token revocation on delete is now implemented. Play also needs a **public web deletion URL** (host it on the landing page, §6).
5. **Privacy disclosures** (both stores): email+name (Contact Info), **product photos sent to the AI service** (User Content, collected, third-party processing via fal.ai), analytics (Usage Data). Provide a privacy-policy URL.
6. **EU DSA trader verification** if distributing in the EU (or geo-exclude EU initially).
7. **Screenshots** at 6.9" (1320×2868), localized per store country, one differentiator per shot (multi-business hub, AI snap-to-add, POS speed, barcode, offline).

---

## 5. Product decisions I left for you (not bugs — judgment calls)

- **Low-stock threshold**: a product with stock 10 currently flags "Low stock." Confirm the intended threshold; it may be aggressive as a default. (Pre-existing behavior, not from this session.)
- **Monetization / multi-location**: the strategy doc recommends launching **free**, then a single **~$7–10/mo per-business Pro** tier anchored by multi-location (additive `locations` table, post-launch — do NOT do the heavy "each location = its own environment" refactor). Your call on timing and price points.
- **Regions vs languages**: roll out by **store-country selection** (reversible, no code), not by gating businesses. Suggested wave 1: US + Philippines + Mexico/Colombia/Peru. Detail in the strategy doc §2c.
- **Tax scope**: shipped a simple per-business rate + inclusive/exclusive mode snapshotted onto each sale. **Not** a filing/e-invoicing engine (MX CFDI, BR NF-e, PH BIR) — that's a post-traction, per-country module. Reconciliation today = the session open/close cash count + tax-collected in summaries.

---

## 6. Discoverability (do a little, not a lot)

- **ASO is primary**: localize store metadata + screenshots per locale (your 11-language coverage is a real edge; localize keywords *culturally*, not literally). Prompt for ratings after success moments, respond to reviews in-language.
- **One landing page** at your public domain: positioning pillars, store badges with deep links, FAQ (schema), **privacy policy + the Play account-deletion URL**, and the `apple-app-site-association` + `assetlinks.json` for Universal/App Links (§3). This does compliance + SEO double-duty. Skip a blog/paid acquisition until you've measured organic.
- Full plan in strategy doc §8.

---

## 7. Residual verification I recommend you do on a real device/browser

The automated suite (530 tests), a high-effort multi-agent code review (all confirmed findings fixed), and a partial live browser walkthrough (login, business create, tax settings, product add, discounted+taxed sale, all math correct in es-PE/PEN) all passed. Two things I could **not** finish in-browser because the browser-automation connection dropped mid-run — quick to check yourself:

1. **Modals stretch to the screen bottom** (your earlier observation). Fixed via `ion-modal { --width/--height:100% }` and verified coherent with sheet variants by code review — but eyeball one full-screen modal (e.g. Add Product) to confirm no dead gap.
2. **Share receipt** on the sale success step → confirm the toast/clipboard fallback fires.
3. Walk the **void flow** once (void a sale → VOIDED stamp, stock restored, today's revenue drops). Covered by unit tests, but worth one live pass.

---

## 8. What landed this session (summary)

- **Backend perf**: multi-item sale now 1 stock-update round trip (was N), products list uses `EXISTS` not full-history COUNT, conditional aggregates + `.returning()` + `Promise.all` across sales/expenses/inventory/list routes. Verified against a real libSQL instance.
- **Frontend perf**: entry chunk **1,939 kB → 117 kB** (94%↓) via route lazy-splitting + vendor `manualChunks`; framer-motion out of the boot path; POS tile memoization; per-row category Map lookup.
- **UI polish**: haptics on the POS loop, brand toasts replacing `alert()`, pull-to-refresh on 5 surfaces, skeletons, chart entrance animations, richer home stat tile.
- **New features**: void/refund with stock restoration + voided-exclusion across all aggregates, cart discount (amount/percent), simple per-business tax, shareable localized receipt.
- **Native**: Capacitor 8 iOS+Android, configurable API origin, bearer-token native auth with **PKCE-bound** OAuth + **single-use SSE tickets** (no credentials in URLs/logs), distinctive WebView host, SW gated off native.
- **Compliance**: static-OTP reviewer account, Apple token revocation on account deletion.
- **Review fixes**: duplicate-line oversell guard, client/server rounding unified in a shared `computeSubtotal`, locale-decimal input parsing, modal-reset-on-onClose, shared origin/stock-delta helpers, cart-reset race fixed, comped ($0) sales allowed, a 44px touch target, and the app-wide React `key` warning on rich-text i18n eliminated (42 sites).
