# Kasero App Store Launch Plan

Date: 2026-07-02. Scope: ship Kasero to the Apple App Store and Google Play as a Capacitor-wrapped native app, positioned to win against free-tier POS incumbents. Competitive facts verified July 2026 (sources in the research appendix at bottom).

## 1. Positioning

**One-liner: "Run all your businesses from one app — free inventory, barcode, team roles, and AI product capture, with your data never held hostage."**

Four pillars, in priority order:

1. **Multi-business switching (unique).** Across ~15 surveyed competitors, none of the direct POS players (Loyverse, Kyte, Square, Zettle, Treinta) support multiple businesses under one account — all force logout/login or separate accounts. Kasero's hub is the subtitle-level differentiator.
2. **AI snap-to-add, not paywalled.** The only direct analogs are Kyte "Magic" (paywalled at $39.99/mo PRIME) and Treinta (added mid-2026, behind subscription). Shipping photo-to-product free or on a low tier is the strongest listing hook. The window is closing — Treinta moved in June 2026.
3. **The anti-paywall data promise.** The category's #1 user grievance is paywalling formerly-free features: Loyverse now caps free history at 31 days and blocks export entirely without a $5/mo add-on (no grandfathering — users describe it as data hostage-taking); Kyte paywalls inventory itself; Loyverse charges $25/store/mo for employee roles. Public commitment: **"Your sales history and exports are never taken away."** Kasero ships inventory + barcode + team roles free — undercutting every incumbent's paywall line.
4. **"Your money never touches us."** Square/SumUp/PayPal reviews are dominated by frozen-funds horror stories (120–180 day holds). Kasero records sales without processing payments — frame as trust, not absence.

Secondary wedges: realtime multi-device sync quality (Kyte's own docs warn two simultaneous devices "may cause data sync errors"); 11-locale coverage (only Treinta overlaps the es/pt/fil/vi set; Kyte is EN/ES/PT only, regional leaders are monolingual); offline-first (table stakes — do right, don't headline).

**Competitor to watch: Treinta** (10M+ installs, ~4.6–4.8 Play, exactly Kasero's LatAm/SEA locale targets). Openings: paywall resentment from its free-to-paid pivot, unskippable subscription screens, and apparently no barcode scanning (unverified — re-check before finalizing store copy).

**Quality bar:** loved free apps sit at 4.4–4.85 on Play (Loyverse 4.85). Rating-killers in this category: cross-device sync bugs, UI regressions, paywall surprise. Target 4.7+.

## 2. Pricing and monetization

**Launch fully free (no IAP)**: maximizes review simplicity (no 3.2/3.8 exposure), maximizes the anti-paywall positioning, and builds the rating base. Subscriptions arrive in a post-launch point release.

**Model: freemium subscription, single Pro tier.**

- **Pro ~$7–10/mo per business** (not per store/location — undercuts Loyverse's $55/store/mo add-on stack on structure, not just price), **regionally priced** (LatAm/SEA ≈ half US; reference: Kasir Pintar Pro ≈ $3.40/mo in ID, Kyte Fair Price ≈ 2x variance). Annual = 2 months free.
- **Pro contents:** multi-location (anchor feature — see below), advanced analytics (custom ranges, period comparisons), higher AI snap-to-add quota, larger team seat counts, priority support.
- **Free forever (the public promise):** sales history + export, core inventory, barcode scanning, basic team roles, metered monthly AI quota (AI volume gating is defensible — real marginal cost via fal.ai — and does not violate the promise).
- **Never:** ads, payment-processing rake, per-employee pricing (the most-resented Loyverse line item), or removing anything currently free (the Loyverse/Treinta mistake; Apple 4.3(b) 2026 also rewards continuous improvement). Grandfather generously when tiers arrive.
- **Mechanics:** native IAP (Apple requirement for digital services; enroll Small Business Program for 15% rate) + Play Billing; keep web billing out of scope at launch.

**Multi-location roadmap (the Pro anchor).** Do NOT do the heavy "each location = own environment" refactor pre-launch (sync bugs are the category's #1 rating killer; multi-business switching already covers most of the use case). Post-launch, land it additively: a `locations` table under business + optional `locationId` on transactional rows (sales, sessions, stock levels, adjustments), defaulting to an implicit main location. Products stay business-scoped (shared catalog); stock and transactions become location-scoped; location switching is a filter layer inside the business, not a separate environment. Backward compatible, no forced UI change, enables cross-location transfer + consolidated reporting later.

## 2b. Product roadmap seams: tax, exports, analytics, AI

**Tax (minimal now, never a tax engine).** Per-business tax rate(s) with inclusive/exclusive toggle (default by business locale: VAT countries inclusive, US exclusive), applied at checkout, snapshotted onto the sale (rate + amount at sale time — never recomputed from current settings), "tax collected" in summaries/exports. NOT at launch: filing, e-invoicing (MX CFDI, BR NF-e, PH BIR), jurisdiction engines — per-country modules only after traction, possibly via partners. Reconciliation: extend the existing session countedCash open/close into a close-time variance report (expected vs counted by payment method — Z-report equivalent); tax reconciliation = tax-collected-by-period export.

**Exports.** Basic CSV export (sales/expenses/inventory by date range, locale-formatted) free forever — it is the positioning promise and the Loyverse wound. Pro may add conveniences (scheduled email exports, accountant share links, QuickBooks/Xero-shaped mappings) but never gates raw data.

**Analytics.** Next tier: period comparisons (WoW/MoM/YoY), margin analytics from existing costPrice (profit by product — rare in competitor free tiers), stock run-rate projections. AI digest layers on top (below).

**AI reuse (ranked by pipeline-reuse x value; all quota-metered — the one monetization gate that never violates the free promise):**
1. Receipt photo → expense entry (identical shape to snap-to-add; highest value per engineering hour).
2. Handwritten inventory list photo → bulk product import (onboarding killer feature for the target demographic; no competitor has it).
3. Weekly AI digest in the user's locale (synthesis of sales/expenses/stock; 11-locale insight localization is nearly free with LLMs — structural advantage vs Kyte EN/ES/PT). Retention driver; natural Pro feature.
4. Natural-language Q&A over business data via bounded query templates (never free-form SQL). Later phase.
5. Reorder/pricing suggestions: statistics first (run-rate math), AI phrases the narrative.

## 2c. Regions vs languages: rollout model

Supported regions ≠ supported languages. Principles:

- **Data model stays region-agnostic.** `users.language` (UI) and `businesses.locale`/`currency` (formatting) already separate the concerns correctly. Do NOT gate business creation by region or add a region association — it would break multi-business flexibility and the rollout lever lives elsewhere.
- **Rollout = storefront selection.** App Store Connect / Play Console country lists are the slow-rollout mechanism: reversible per-country, zero code, and they scope compliance + support surface.
- **Waves:** (1) US + Philippines (fil locale is a differentiator; Loyverse has no Filipino) + Mexico/Colombia/Peru (es) — small enough to answer every review in-language; (2) Brazil (pt), Vietnam (vi), rest of LatAm, CA/AU/UK; (3) EU last-of-the-majors (DSA trader verification prerequisite), JP/KR when the rating base is strong. Skip markets without language coverage (e.g. Indonesia until a Bahasa locale ships).
- **Region-profile registry, not region entity.** The genuinely regional things — default tax mode (inclusive/exclusive) and local payment-method taxonomy (Pix BR, Yape/Plin PE, GCash PH; today's cash|card|other will feel foreign in target markets) — belong in a lightweight registry in packages/shared keyed off business locale, deriving defaults without lock-in. Additive, ship when tax/payment features land.
- Pro-tier regional pricing later is store-side per-storefront pricing; no data-model involvement.

## 3. Technical track (Capacitor)

Already scoped and in progress in this repo (see `.claude/docs/capacitor-native.md` once landed):

- **Capacitor 8** — required floor: Apple mandates Xcode 26 / iOS 26 SDK uploads since April 28, 2026; Play requires target API 36 by Aug 31, 2026. Cap 8 satisfies both.
- **Bundled SPA** (webDir), never remote `server.url` — the classic Apple 4.2 "web clip" rejection vector.
- Configurable API origin (`VITE_API_ORIGIN`) + bearer-token auth for native (better-auth bearer plugin), cookies unchanged on web.
- Server allowlist for `capacitor://localhost` / `https://localhost` origins (CSRF + CORS + better-auth trustedOrigins).
- Service worker disabled on native; native OAuth via system browser (ASWebAuthenticationSession) + deep-link callback; status bar/splash/keyboard plugins; localized camera purpose strings.

## 4. Apple App Review compliance checklist

| Guideline | Requirement | Kasero status / action |
|---|---|---|
| 4.2 Minimum functionality | Must not feel like a wrapped website | Ionic native-feel navigation, camera barcode scanning, AI photo capture, offline sync, haptics — comfortably above the bar with the SPA bundled locally. List native capabilities explicitly in App Review notes. If rejected repeatedly: book a "Meet with Apple" App Review consultation. |
| 4.8 Login services | With Google login present, must offer a service limiting data to name+email and allowing email privacy | **Sign in with Apple is load-bearing — never remove it while Google login exists.** Keep equal prominence. Handle `@privaterelay.appleid.com` emails in the user model. Email OTP alone does NOT satisfy 4.8. |
| 5.1.1(v) Account deletion | In-app, easy to find, full record deletion | Exists (DeleteAccountModal). **Action: implement Sign in with Apple token revocation via Apple's REST API in the deletion route.** Decide + document the owner-with-team-members deletion policy in review notes. |
| 5.1.1(ii) Purpose strings | Camera/photo strings, localized | "Kasero uses the camera to scan product barcodes and to photograph products so they can be added to your inventory." All 11 locales via InfoPlist.strings. |
| 2.1 Review access | Login-gated apps need a demo account | **Email OTP is a reviewer trap (they can't receive your emails). Action: seed a designated reviewer account that accepts a fixed static OTP code**, with demo products/barcodes/sales/analytics and a second team-member account. State the code in App Review notes. |
| Privacy | Nutrition labels + PrivacyInfo.xcprivacy | Declare: email+name (Contact Info), product photos sent to AI service (User Content, collected, third-party processing), analytics if any (Usage Data). Cap ≥6 ships privacy manifests; audit any extra plugins. |
| Age rating | New questionnaire (due Jan 31, 2026) | Answer before first submission. |
| EU DSA | Trader status verification | Required for EU distribution — verify in App Store Connect or geo-exclude EU initially. |
| 2.5.2 | No functionality-changing code download | Do not add any JS live-update mechanism (skip Capgo/CodePush-style OTA at launch). |

Assets: screenshots at 6.9" (1320×2868) baseline; add 13" iPad set only if shipping iPad. Privacy policy URL required.

## 5. Google Play checklist

- Target API 36 (Cap 8 default). Data safety form mirroring the Apple labels; **account deletion needs an in-app path AND a public web URL** entered in the form.
- **Financial features declaration is mandatory for every app** (blocking since Oct 2025) — declare "no financial features"; sale-recording without payment processing is explicitly outside the finance policy.
- **New personal dev accounts: closed test with ≥12 testers opted in continuously for 14 days before production access** (~2–3 weeks lead time; organization accounts exempt). Start this clock early.
- $25 one-time fee. Use Managed Publishing + staged rollout (5–20% initial).

## 6. Launch sequence

1. **Now:** land Capacitor integration + verification pass (in progress in this repo). Implement static-OTP reviewer account + Apple token revocation on delete.
2. **Week 1:** Apple Developer Program ($99/yr) + Play Console ($25) enrollment (org accounts if possible — exempts Play 12-tester rule and looks better for DSA). Xcode 26 signing, first `npx cap sync` + device build. App Store Connect + Play listings: name, subtitle ("All your businesses in one app"), keyword research per locale, 6.9" screenshots (POS grid, dashboard, AI snap-to-add, multi-business hub, barcode scan — one differentiator per shot), privacy labels, age rating, financial declaration.
3. **Week 2:** TestFlight internal (instant) → external beta (first build needs ~1-day Beta App Review). Play closed testing with 12+ testers (start the 14-day clock immediately). Seed reviewer demo account. Dogfood on real devices; fix WebView-specific issues.
4. **Week 3–4:** Submit iOS (expect 1–3 days; budget a week including one rejection cycle — most likely flags: 4.2 webbiness [mitigated], 4.8 [satisfied], 5.1.1(v) [verify live], 2.1 demo account [prepared]). Play production after the 14-day closed test completes; staged rollout.
5. **Post-launch:** ratings prompts (SKStoreReviewController via @capacitor/rating or in-house, gated to post-success moments like a closed session with revenue); respond to every review in-locale; watch for sync-bug reports (category's #1 rating killer); iterate on ASO per-locale.

## 7. Store listing copy skeleton (en-US)

- **Name:** Kasero — POS & Inventory
- **Subtitle (iOS, 30 chars):** All your businesses, one app
- **Promo text:** Record sales in seconds, scan barcodes, snap a photo to add products with AI, and switch between all your businesses — free, offline-ready, in 11 languages.
- **Keyword themes:** pos, point of sale, inventory, barcode scanner, small business, sales tracker, kiosk, tienda, negocio (localize per store country).
- Description bullets ordered by pillar: multi-business hub → AI snap-to-add → free inventory/barcode/team roles → works offline → your data is yours (export anytime, never paywalled) → no payment processing, no frozen funds.

## 8. Discoverability: ASO first, thin web SEO second

**ASO is the primary channel** — for utility apps in this category, store search is where installs come from, and per-locale ASO is the lever no small competitor does well:

- **Per-locale metadata as a first-class deliverable.** Kasero ships 11 locales; App Store Connect and Play both support fully localized listings (title, subtitle, keywords, screenshots, description). Localize *keywords culturally, not literally* — "tienda"/"negocio"/"punto de venta" (es), "tindahan"/"benta" (fil), "quản lý bán hàng" (vi), "帳簿"/"レジ" (ja). Treinta wins LatAm partly on localized listings; Kyte's mixed-language strings are a documented complaint — polish here is cheap differentiation.
- **Screenshot narrative per pillar** (one differentiator per shot, localized captions): multi-business hub → AI snap-to-add → POS speed → barcode scan → offline. First two screenshots decide conversion; put multi-business and AI capture there.
- **Ratings velocity**: prompt after success moments (closed session with revenue), never on launch; respond to reviews in the reviewer's language (both stores' algorithms reward engagement, and it's visible social proof).
- **Keyword iteration**: check store search-suggest for each locale monthly post-launch; iterate the 100-char iOS keyword field per country storefront.

**Web SEO: one landing page, not a content operation.**

- Build a small static marketing site at the public domain root (the SPA can move behind app.* or stay path-gated) with: per-locale pages (hreflang), the four positioning pillars, App Store / Play badges with product-page deep links, screenshots, FAQ (with FAQ schema), privacy policy + **the public account-deletion URL Google Play requires** — so this page does compliance double-duty.
- Purpose: (1) win brand-name searches before anyone else does, (2) give app-store algorithms the corroborating web presence they weight, (3) provide link targets for launch coverage/directories, (4) host `apple-app-site-association` + `assetlinks.json` for the Universal Links / App Links the invite deep-links need — again compliance double-duty.
- Add Apple Smart App Banner (`apple-itunes-app` meta) and Play install banners on the landing page.
- Skip for now: blog/content marketing, paid ASA/UAC. Revisit only after organic baseline is measured. If content is ever done, the winning queries are vertical how-tos in target locales ("cómo llevar el inventario de mi tienda"), not generic POS comparisons.

**Not applicable**: indexing the app itself. Keep the SPA `noindex`; all public-facing SEO surface lives on the landing page.

## 9. Open items to re-verify before submission

- Treinta barcode support and current free tier (affects store copy claims).
- Live Play API-36 wording; Apple review-time SLAs at submission time.
- Whether the AI pipeline's third-party processor (fal.ai) requires additional disclosure language in privacy labels.
- Demo-account static OTP implementation must be flag-gated so it can never match a real user (single designated email, server-side allowlist).

---

Appendix — research sources: loyverse.com/pricing, loyverse.town/topic/7400, mobiletransaction.org/loyverse-review, kyteapp.com/pricing, docs.kyteapp.com, play.google.com listings (Loyverse, Kyte, Treinta), squareup.com press (Oct 2025 packaging), help.sumup.com, developer.apple.com/app-store/review/guidelines (June 2026 rev), developer.apple.com/support/offering-account-deletion-in-your-app, developer.apple.com/news/upcoming-requirements (Xcode 26 floor; age rating), developer.apple.com/forums/thread/750911 + /806726, workos.com/blog/apple-app-store-authentication-sign-in-with-apple-2025, capacitorjs.com/docs/updating/8-0, support.google.com/googleplay/android-developer answers 11926878 (target API), 13327111 (deletion), 14151465 (12-tester rule), 13849271 (financial declaration), runway.team/appreviewtimes, treinta.co/planes-y-precios.
