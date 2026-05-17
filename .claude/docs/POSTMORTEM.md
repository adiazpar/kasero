# Kasero — Postmortem

**Date:** 2026-05-16
**Author:** Alex Diaz
**Status:** Closed. Kasero is now a portfolio piece. No further work is planned beyond optional open-source release and possible side-project extraction (see "What comes next").

---

## What this document is

This is a closure document for Kasero — a multi-business cash-POS + inventory + supplier-CRM app built over ~3.5 months between February and May 2026. It exists to record three things honestly:

1. What was built, when, and why it diverged from its original intent.
2. The research process used to evaluate whether the codebase had a viable path to a paid SaaS business, and what that research found.
3. What is preserved from the project as portfolio value, and what the next step is.

This is not a list of bugs. It's not a list of features. It's a record of a strategic decision and the reasoning behind it. Future me, anyone reading this as a portfolio reference, and any other founder considering a similar category should be able to extract value from it.

---

## Origin

The trigger for Kasero was a personal observation, not a market study. While visiting Lima, Peru, I spent time at **La Feria de Barranco** — a recurring weekend artisan fair where ~50–90 independent vendors sell handmade goods (jewelry, ceramics, textiles, leather, art prints). The vendors I watched were running their stalls on a mix of paper notebooks, a smartphone calculator, and Yape for digital payments. The idea was simple: build a mobile-first, offline-capable POS + inventory tool shaped for that kind of small in-person vendor.

That intent — *"a tool for the kind of person running a stall at a recurring artisan fair"* — was the starting point. It was never written down anywhere in the codebase.

## What got built

Kasero is a TypeScript monorepo: a Vite + React + Ionic SPA frontend, a Next.js API backend running in API-only mode, and a shared package holding the Drizzle schema, types, locale registry, and validation helpers. In production it ships as a single Vercel deployment that serves both `/api/*` and the SPA shell from one origin. In development the API runs on port 8000 and Vite on 3000 with `/api/*` proxied.

The relevant build timeline:

| Date | Milestone |
|---|---|
| 2026-02-10 | Initial project setup. PocketBase + PIN auth + minimal UI. |
| 2026-02-21 | Products CRUD with image support — first commerce feature. |
| 2026-02-22 | Product categories. |
| 2026-03-07 | "Pedidos" (orders) tab added to products page. |
| 2026-03-08 | Providers feature, order improvements, stock adjustment. |
| 2026-03-17 | AI pipeline optimization (snap-to-add product identification was already in place by this point). |
| 2026-03-28 | Migration to multi-business architecture. |
| 2026-04-05 | Barcode scanning, GTIN cascade, removal of legacy category column. |
| 2026-04-06 | Product modal Details/Barcode tabs, full barcode print workflow with KSR-prefix generation. |
| 2026-04 | Switched away from PocketBase. Migrated to Drizzle + Turso/libSQL. Internationalization expanded to en-US / es / ja. |
| 2026-05-08 | Single-origin Vercel deploy refactor (SPA folded into Next.js `public/`). |
| 2026-05-12 | AI price prefill, identify-pipeline hardening, home Sales/Products/Manage tile consolidation. |
| 2026-05-13 to 2026-05-14 | Auth overhauled to passwordless (email OTP + Google + Apple OAuth) via better-auth. 2FA, password modules removed. |
| 2026-05-16 | Final polish: layout, hub rhythm, modal toolbar consistency. Project entered strategic review. |

By the end, the codebase contained:

- **Multi-business workspace** — a single user can own/partner-in/work-at multiple businesses, each fully isolated.
- **Products / inventory** — SKUs with name, price, costPrice, stock, low-stock threshold, category, base64 icon, optional barcode.
- **AI snap-to-add pipeline** — photograph a product, GPT-4o-mini returns structured `{name, category, retailPrice}` JSON with locale-aware pricing.
- **Categories** — per-business, reorderable.
- **Cash-drawer sales sessions** — bespoke open/ring/close flow with starting cash, counted cash, denormalized variance, and a partial unique index enforcing one-open-session-per-business.
- **Sales (POS)** — cart, product picker with barcode scanner, payment-method labels (cash / card / other — no processor integration), atomic stock decrement on sale commit.
- **Providers (suppliers)** — CRUD plus per-provider notes (capped at 5), reliability scoring over the last 6 placed orders, monthly spend chart, typical-items analysis.
- **Purchase orders** — multi-step wizard, line items with received-quantity variance tracking, R2 receipt upload, atomic stock bump on receive.
- **Team roles** — owner / partner / employee with 6-character invite codes and QR-code onboarding.
- **Ownership transfer** — atomic demote-and-promote with email-code handoff.
- **Account** — profile, change email (dual-OTP), language preference, theme, active sessions, account deletion (with OTP step-up).
- **Passwordless auth** — email OTP + Google + Apple OAuth via better-auth.
- **i18n** — react-intl with three registered locales (en-US, es, ja) plus a 27-locale registry.
- **PWA** — Workbox service worker, `useOnlineStatus`, revalidate-on-focus, offline envelope handling.
- **Image handling** — HEIC→JPEG conversion route, base64 product icons stored inline, R2 for order receipts.

This is real, internationalized, offline-capable, type-safe, monorepo software with non-trivial correctness work (CAS session-close, GTIN check-digit cascade, partial unique indexes). It is not a toy.

## How the original intent drifted

The drift was rapid and unexamined. The original observation was about a fair-stand vendor — a maker selling at a recurring weekend market. Within four weeks of project start:

- **2026-03-07**: orders (purchase orders to suppliers) were added.
- **2026-03-08**: providers (named suppliers) were added.
- **2026-04-05**: full barcode generation + printing flow was added — a feature that fits packaged-goods retail, not handmade artisan goods.
- **2026-04**: business types added (`food`, `services`, `wholesale`, `manufacturing`) — none of which describe a fair vendor.

By April, the product had quietly become an **inventory-aware POS for a packaged-goods micro-retailer who restocks from named suppliers** — a *bodega / kiosko / convenience store / specialty grocer* shape. That persona shares almost nothing with a Feria de Barranco artisan: artisans handcraft unique SKUs (no GTIN, no reorder), have no recurring suppliers in the same sense (raw-material vendors, not finished-product distributors), don't run shifts with cash-drawer reconciliation, and don't issue receipts that need to attach to provider orders.

Nobody made a conscious decision to pivot. Features were added because they felt useful for "small business" without anchoring on which small business. The provider-order-receive flow alone grew to roughly 13,000 lines of code (14 step files for the order wizard, dedicated `provider_notes` table, `ReliabilityBar`, `computeReliability`, `computeMonthlySpend`, `computeTypicalItems`, R2 receipt uploads).

This is the most important lesson in this project: **a codebase that doesn't know who its user is will accrete features that constrain a different user than the one you started with**. The provider/order machinery silently re-shaped Kasero from "artisan fair POS" into "convenience-store back-office," and nobody noticed for two months.

## The identity crisis

By mid-May, with auth fully refactored to passwordless and the UI polished to release quality, the strategic question surfaced honestly for the first time: **who is this app actually for?**

It was clear from feature-level inspection that the answer was no longer "Feria de Barranco artisan." But what *was* it? The cash-drawer sessions, named-supplier book, barcode infrastructure, and AI snap-to-add suggested a packaged-goods retailer. The multi-business workspace suggested a small-portfolio operator. The es / ja / en-US locales suggested a multi-region ambition. None of it converged on a specific paying customer.

This document records what was done about that.

## The research process

Five sequential research passes were run, each pressure-testing the prior conclusion before committing. The discipline applied was: form a hypothesis from evidence, then deliberately try to kill it before acting on it. The summary of each pass:

### Pass 1 — Codebase ICP audit

An agent reverse-engineered the implicit target user purely from source code (schema, route handlers, modal flows), with explicit instructions to ignore prior strategic framing in CLAUDE.md and docs. Verdict: the code implies a **cash-handling, in-person, packaged-or-priced-goods micro-retailer** — bodega / kiosko / panadería / convenience-store shape, 1–5 humans, single location, named supplier book, smartphone-first. Three sharpest pieces of evidence:

1. `salesSessions` exists with `startingCash` + `countedCash` + denormalized variance, plus a partial unique index enforcing one open session per business. Bespoke cash-drawer reconciliation only exists if a real human counts a real drawer at end-of-shift.
2. `paymentMethod` enum is `'cash' | 'card' | 'other'` with no processor integration. Card is a label, not a transaction. Cash is the design center.
3. The provider/order flow assumes a paper-process culture — receipt uploads that are never OCR'd, `provider_notes` capped at 5 free-text rows, `ReliabilityBar` over last-6 orders, 6-month spend chart. The user has the supplier's WhatsApp number, not an API key.

Everything the schema cannot represent — customer records, tax fields, appointments, online channels, multi-location stock, tiered pricing, employee scheduling — was also catalogued, because that list is what the app structurally *excludes*.

### Pass 2 — LatAm bodega profitability evaluation

Given the implicit ICP, an agent evaluated whether the cash-handling micro-retailer segment is profitable to serve as a paid SaaS customer, using payment-rail data (Yape, Pix, Nequi, Mercado Pago), distributor case studies (Bimbo, Coca-Cola FEMSA, AB InBev BEES), government statistics (INEGI, DANE, INE, IBGE), development-bank reports, competitor app store reviews, and B2B-marketplace failure post-mortems.

Verdict: **the LatAm bodega segment does not monetize as paid SaaS for a US-based solo founder.** The evidence converged from eight countries and a decade of attempts:

- Treinta has 7 million SMB users at ~$0.49/month ARPU. The dominant player is subsidizing the user base while attempting to monetize through dataphones and payment commissions, has not raised since 2022, and is structurally unprofitable at current unit economics.
- Every merchant-bookkeeping/inventory app that tried to monetize standalone has shut down or pivoted to lending — Khatabook, OkCredit, Dukaan, BukuWarung.
- The mobile-money rails (Yape, Pix, Nequi, Mercado Pago) already digitized this segment for payment acceptance. The merchant feels digitized before any inventory app reaches them.
- The only profitable paths are mandatory-compliance SaaS (Bsale, Conta Azul) in countries with enforced e-invoicing for micro-merchants, transaction-fee-plus-financial-services attached to a free app (Treinta), or distributor co-distribution (BEES) — none viable for a US-based solo founder with no funding.

### Pass 3 — Adjacent US market scan + pressure test

Given pass 2's negative result, an agent surveyed adjacent US markets where the existing capabilities could serve a different ICP with moderate rework: food trucks, side-hustler makers (Etsy + craft fairs + farmers markets), market-organizer B2B2C wedge, coffee shops, smoke / liquor shops, service businesses, cannabis, booster clubs / volunteer concessions, RenFairs, multi-vendor markets. Initial recommendation: pivot to US food trucks + US side-hustler makers + a market-organizer B2B2C wedge (sell to Smorgasburg / Renegade-style organizers once and onboard 50–500 vendors per deal).

A second agent then ran a pressure test on that recommendation. **Three of the five loadbearing claims did not survive:**

- "Multi-business workspace is a moat for makers" → false. Craftybase owns the maker inventory category at $19–59/mo with 95% satisfaction; the maker pain is recipe-cost and Schedule C, not multi-business. Most makers run one brand.
- "Market-organizer B2B2C wedge is open" → false. GoTab and Tabski already own the multi-vendor food-hall POS space with single-checkout, automated rent splits, percentage payouts. Smorgasburg mandates Square. Christkindlmarkts require BYO-POS.
- "Food trucks are 3–5 month pivot cost" → optimistic. Food trucks require EMV + Tap-to-Pay, and Kasero is an Ionic-React PWA — Stripe Terminal needs a Capacitor native bridge for Tap-to-Pay-on-iPhone, plus PCI work. Realistic timeline 4–6+ months to be at parity with what Square gives away free.

Surviving from this pass: the **convention vendor / artist-alley** segment surfaced as a strong-shape match (multi-event with shared inventory pool, cash + card, multi-day events with shift handoffs, offline-first matters because con halls have terrible Wi-Fi, public English-speaking communities for remote acquisition).

### Pass 4 — Artist-alley devil's advocate

The artist-alley recommendation was then pressure-tested in the same adversarial mode. Verdict: **conditional, leaning no.** Four killers:

1. **Conventory** ([conventory.com](https://www.conventory.com)) already exists, ships the exact pitch — "Artist Alley Inventory and Sales Tracker… tracks your real sales at the booth, calculates profit per convention, keeps your inventory accurate across every event, works offline" — and was actively producing SEO content in April 2026 with a 30-day free trial.
2. Schema mismatch: every business-relevant table is hard-scoped to `businessId` with NOT NULL FKs. There is no events / locations concept anywhere. The "1–2 month pivot cost" estimate is actually 3–5 months once you account for an `events` table, `event_inventory_snapshots`, event-id on sales, per-event reconcile flows, per-event P&L rollups, multi-state sales-tax categorization, and vendor-mode onboarding.
3. WTP at $15–25/mo is squeezed from both sides: Square Free now covers unlimited items, real-time inventory, low-stock alerts, multi-location sync, and CSV import. Craftybase Pro at $24/mo owns COGS / Schedule C. The realistic alternative for most artist-alley vendors isn't "Square + Craftybase + spreadsheet" — it's "Square Free + Notes app."
4. Inventory is maybe pain #6 for artist-alley vendors. The actual top complaints are booth fees ($500+ tables), travel costs, counterfeit/AI-art booths (#occupyartistalley), multi-state sales tax post-Wayfair, and juried-lottery rejection. Software can't fix the top 5.

### Pass 5 — Standalone product extraction

Given that no ICP pivot survives scrutiny, the framing was flipped: instead of asking "what segment does this app serve?", ask "what's the smallest, most defensible product I could pull out of this codebase and sell to someone in 8 weeks?" Two parallel agents evaluated extraction candidates (AI snap-to-add API, supplier reliability analytics, cash-drawer variance reconciliation as a Square plugin, barcode-as-a-service, multi-business org primitive, offline PWA scaffolding, white-label distributor POS, open-source vertical POS starter, locale-aware components, and a catalog-onboarding bundle).

Verdict: **no obviously viable standalone product extraction exists.** The best candidate — cash-drawer variance reconciliation as a Square App Marketplace plugin with per-employee shortage attribution — grades B−, with a realistic ceiling of $5–15k MRR after 18 months, requires throwing away Kasero's data layer and rebuilding on Square Orders / Transactions / Team APIs (10-week project), and is a side income rather than a company. Every other candidate was killed for one of three reasons: no moat (commodity wrappers around primitives anyone can call), no TAM at standalone scale (features, not products), or the wrong sales motion for a solo founder (12–18 month enterprise BD cycles).

The AI snap-to-add API specifically was evaluated as a standalone B2B product and rejected: the wrapper is a thin opinionated layer over GPT-4o-mini and fal.ai BiRefNet; the entire differentiation (prompt, abstention rules, locale-aware pricing, JSON schema) is replicable in an afternoon; buy-vs-build math is $5–15 direct OpenAI vs $500 through Kasero for 50,000 images; and the model vendors (GPT-5.2, Claude 4.7) plus bundled platform features (Shopify Magic, Tinker, Lightspeed AI OCR launched March 2026) erode the value proposition continuously. No successful precedent exists for "image-to-product-JSON API as self-serve SaaS" on Product Hunt, AppSumo, or indie hacker forums. Every survivor in adjacent categories (Ximilar, ProductAI, Bria, Pebblely) abandoned the bare-API pitch for either enterprise contracts or workflow products.

## The meta-pattern

Five passes, five honest convergent answers. The signal isn't "we picked wrong segments." The signal is:

> **The general-purpose small-merchant POS category is structurally hostile to a US-based solo founder with no funding.** Every niche either belongs to Square (broad, free, good enough) or to a specialist who got there first (Conventory, atVenu, Craftybase, GoTab, Bsale, Treinta). The shape of Kasero — generic cash POS + inventory + multi-business + supplier-CRM — does not have a defensible wedge in this category, against this profile of founder, in this market.

The first scan inferred a "bodega-shaped operator" from the codebase. That was correct about what got built. But each segment we considered had the same problem: Kasero is a sturdy generic, and the market punishes generics relative to specialists.

This is not a failure of execution. It is a structural feature of the small-merchant SaaS market in 2026.

## What's preserved

The codebase has standalone technical value independent of its commercial outcome:

- A working, internationalized, offline-capable, multi-business POS architecture in a TypeScript monorepo with shared schema across web + API + shared packages.
- Non-trivial correctness work: CAS-based session-close that doubles as a write-lock against concurrent sale POSTs, GTIN check-digit cascade with KSR-prefix fallback and canonical GTIN-14 form, partial unique indexes enforcing one-open-session-per-business and one-owner-per-business.
- Locale + currency-aware formatting via `useBusinessFormat()` over a 27-locale registry.
- Three layers of rate limiting on the AI pipeline with a global daily-spend kill-switch.
- Atomic stock decrement on sale commit and atomic stock bump on order receive.
- Passwordless authentication (email OTP + Google + Apple OAuth) with dual-OTP for sensitive operations.
- Single-origin Vercel deployment with the SPA folded into the API's `public/` directory at build time.

The methodology used to evaluate it is also preserved — see the companion document at `~/market-research-methodology/`, which extracts the principles, anti-patterns, and reusable agent prompts from this process into a project-agnostic foundation for future work.

## What Kasero is now

A portfolio piece. The product is feature-complete relative to its current scope, the codebase is in a clean state, and no further commercial development is planned. Two paths remain on the table for what to do with it next, neither of which redirect the strategic conclusion:

1. **Side project — cash-drawer variance reconciliation as a Square App Marketplace plugin.** Extract the session-close logic and per-employee shortage attribution from `apps/api/src/app/api/businesses/[businessId]/sales-sessions/close/route.ts` and rebuild on top of Square Orders / Transactions / Team APIs. 10-week project. Ceiling around $5–15k MRR. Decision criterion: 50 paying installs by week 16 or walk.

2. **Open-source release.** Publish Kasero as a vertical-POS starter on GitHub. Use it as a portfolio centerpiece and as the lead-generation backbone for an Ionic-React + Drizzle + offline-first PWA + i18n consulting practice. The technical depth supports $150–250/hr consulting; one engagement returns more than the Square plugin will in its first year.

Both paths are recoverable from the current state. Neither requires changing the strategic conclusion that Kasero, as a paid-SaaS product in the small-merchant POS category, does not have a viable path forward for a US-based solo founder.

## Lessons

A short list of things this project taught, ordered by how much I'd act on them next time:

1. **Anchor on an ICP before writing the second feature.** The first feature can be exploratory. Everything after that should be filtered through "does this serve the same user who needed the first feature?" Kasero's drift from artisan-fair POS to bodega-shaped back-office happened in four weeks of unexamined feature accretion. Once a codebase shape exists, it constrains the ICP whether you want it to or not.

2. **The general-purpose small-merchant POS category is a bad bet for a US-based solo founder.** Square is free and broad; every niche has a specialist who got there first; the AI differentiation evaporates with each model release; the compliance moats are owned by local players. If I find myself in this category again, the first question should be "what specific structural advantage do I have here that incumbents lack?" — and if the answer isn't immediate and credible, walk.

3. **Pressure-test conclusions before committing.** Three recommendations in this conversation looked promising at first scan and fell apart under adversarial review — Conventory existing, the schema mismatch, GoTab owning the market-organizer wedge, multi-business not being a moat for makers. Each pressure-test cost a few hours of agent work and would have saved months of misdirected building. The cost of being wrong about ICP is months; the cost of one more research pass is hours.

4. **Negative knowledge is real knowledge.** Five disqualified options is not nothing — it's a sharper sense of where not to spend time and a working method for finding that out fast. The skill of running this kind of research is more valuable than any specific product hypothesis it kills.

5. **Founder-market fit is geographic, not just thematic.** Building for Peruvian artisan fairs while living in the US looked viable on capability fit and failed instantly on acquisition fit. Personal observation is a romance, not a wedge.

6. **A codebase is the integration of its pieces, not the sum of them.** Pulling parts out as standalone products fails because the value was in how they cohered. The AI snap-to-add is a feature; the cash-drawer reconciliation is a feature; the multi-business workspace is a feature. None of them is a product on its own. That was worth learning the hard way once.

---

*Closed 2026-05-16.*
