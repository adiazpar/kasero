# Kasero — Launch Checklist (everything left is yours)

Date: 2026-07-06. This consolidates the former `2026-07-02-app-store-launch-plan.md` and `2026-07-02-owner-action-guide.md` into the one list of remaining owner actions. All engineering work is committed on `main` and verified (tests, builds, prod DB migration, simulator smoke test). Full strategy/research rationale lives in git history of the two deleted docs if ever needed.

**Positioning one-liner (use everywhere):** "Run all your businesses from one app — free inventory, barcode, team roles, and AI product capture, with your data never held hostage." Pillars in priority order: multi-business hub, AI snap-to-add not paywalled, the free-forever data promise ("Your sales history and exports are never taken away"), no payment processing (your money never touches us).

---

## 1. Secrets and env (do first; update Bitwarden notes in the same sitting)

- [ ] `PRO_PROMO_CODES` (api env + Vercel): format `CODE:months,CODE2:months` (e.g. `LAUNCHCREW:12`). Marketing/beta grants only — never sell codes outside the stores (Apple 3.1.1). Unset = redemption returns invalid-code.
- [ ] `VITE_API_ORIGIN` + `VITE_PUBLIC_WEB_ORIGIN` (web env): required for native builds; leave empty for web. The simulator smoke test showed the expected blank auth canvas until this is set.
- [ ] `APP_REVIEW_EMAIL` + `APP_REVIEW_OTP` (api env): static-OTP reviewer account; inert unless both set.
- [ ] `APPLE_APP_BUNDLE_IDENTIFIER=com.kasero.app` (api env): enables native Sign in with Apple token verification.
- [ ] Later, for IAP verification: `APPLE_IAP_KEY_ID/_ISSUER_ID/_PRIVATE_KEY/_BUNDLE_ID`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON/_PACKAGE_NAME` (see §5).

## 2. Accounts

- [ ] Apple Developer Program ($99/yr) — organization account if possible (eases EU DSA trader verification).
- [ ] Google Play Console ($25 one-time) — organization account exempts the 12-tester/14-day closed-test rule; personal accounts must run a closed test with 12+ testers opted in for 14 continuous days before production (start that clock immediately if personal).
- [ ] After Apple enrollment: App Store Small Business Program (15% rate).

## 3. Native builds

- [ ] iOS: open `apps/web/ios/App/App.xcodeproj`, set your signing Team (bundle id `com.kasero.app` and the `kasero` URL scheme are already wired; branded icons/splash are in; the project builds and runs on the iPhone 17 Pro simulator as of 2026-07-06). Then `npm run build --workspace=@kasero/web && npx cap sync ios` with `VITE_API_ORIGIN` set, archive, upload to App Store Connect / TestFlight.
- [ ] Android: generate a release keystore, wire it into `android/app/build.gradle` signing config, build a signed AAB.
- [ ] Universal Links / App Links (recommended before scale; removes the custom-scheme interception class — PKCE binding covers the interim): replace `TEAMID` in `apps/api/public/.well-known/apple-app-site-association` (both `appIDs` and `webcredentials`) and `REPLACE_WITH_RELEASE_KEYSTORE_SHA256` in `assetlinks.json` (from Play Console → App signing if using Play App Signing).
- Note: rerun `npx @capacitor/assets generate` from `apps/web` only if the logo masters in `apps/web/assets/` change.

## 4. Store listings and compliance (before first submission)

- [ ] Apple age-rating questionnaire (blocking).
- [ ] Play financial-features declaration → "no financial features" (blocking; sale-recording without payment processing is outside the finance policy).
- [ ] Privacy labels, both stores: email+name (Contact Info), product/receipt photos sent to AI service (User Content, third-party processing via fal.ai + OpenAI), analytics if any. Privacy policy URL: `https://<domain>/legal/privacy.html`. Play data-safety form also needs the public deletion URL: `https://<domain>/legal/delete-account.html`.
- [ ] Seed the reviewer demo account in prod: create the `APP_REVIEW_EMAIL` user, sign in once with the static OTP, add demo products/barcodes/sales/analytics + a second team member. Put email + code in App Review notes and list native capabilities (camera barcode scan, AI capture, offline, haptics) against the 4.2 web-clip flag.
- [ ] Screenshots at 6.9" (1320×2868), one differentiator per shot, first two decide conversion: multi-business hub, AI snap-to-add, then POS speed, barcode, offline. Localize captions per storefront.
- [ ] Listing copy (en-US skeleton): Name "Kasero — POS & Inventory"; subtitle "All your businesses, one app"; promo text "Record sales in seconds, scan barcodes, snap a photo to add products with AI, and switch between all your businesses — free, offline-ready, in 11 languages." Keyword themes: pos, point of sale, inventory, barcode scanner, small business, sales tracker; localize *culturally* per storefront (tienda/negocio es, tindahan/benta fil, quản lý bán hàng vi, レジ/帳簿 ja).
- [ ] Rollout waves by storefront country selection (reversible, no code): (1) US + Philippines + Mexico/Colombia/Peru; (2) Brazil, Vietnam, rest of LatAm, CA/AU/UK; (3) EU (needs DSA trader verification — or geo-exclude until then), JP/KR later. Skip markets without language coverage.
- [ ] Landing-page placeholders: store badge URLs in both `welcome/` pages post-approval (`data-todo` attributes mark them) + the commented `apple-itunes-app` Smart App Banner meta (needs numeric app id); confirm `support@kasero.app` mailbox exists; counsel review of privacy.html; verify canonical domain is really `kasero.app` (fix in both welcome pages if not).

## 5. Monetization go-live (store side)

- [ ] Create subscription products (suggested `pro_monthly` $7.99, `pro_annual` $79.99; set regional prices ~half US for LatAm/SEA storefronts).
- [ ] Wire receipt verification: TODO(owner) steps in `apps/api/src/lib/billing/apple.ts` and `google.ts` (App Store Server API JWT / Play Developer API). The route answers 503 by design until wired; never grants from unverified receipts.
- [ ] Wire the native purchase flow in `apps/web/src/lib/billing/index.ts` (RevenueCat = low-effort path; StoreKit 2 + Play Billing = no-dependency path). Until then the paywall shows "coming to the stores" and promo redemption works.
- Never-list (positioning is load-bearing): no ads, no per-employee pricing, never remove anything currently free, never gate raw exports. Grandfather generously if tiers ever change.

## 6. Submission sequence

1. TestFlight internal → external beta (first build needs ~1-day Beta App Review). Play closed testing (see §2 clock).
2. Dogfood on real devices; watch for WebView-specific issues. One live pass each: full-screen modal bottom edge, share-receipt toast/clipboard fallback, void flow (stamp, stock restore, revenue drop), and a native login with `VITE_API_ORIGIN` set.
3. Submit iOS (budget a week incl. one rejection cycle; likely flags all mitigated: 4.2 webbiness, 4.8 Sign in with Apple — **never remove it while Google login exists**, 5.1.1(v) deletion, 2.1 demo account). Play production after closed test, staged rollout 5–20%.
4. Before finalizing store copy, re-verify: Treinta's current barcode support/free tier (affects claims), fal.ai disclosure wording in privacy labels.

## 7. Post-launch

- [ ] Ratings prompts gated to success moments (closed session with revenue), never on launch. Respond to every review in the reviewer's language. Watch sync-bug reports — the category's #1 rating killer; target 4.7+.
- [ ] ASO iteration: check store search-suggest per locale monthly; iterate the iOS 100-char keyword field per storefront.
- [ ] Product decisions still open: low-stock default threshold (10 may be aggressive), multi-location timing (the Pro anchor — additive `locations` table, never the per-location-environment refactor), final regional price points.
