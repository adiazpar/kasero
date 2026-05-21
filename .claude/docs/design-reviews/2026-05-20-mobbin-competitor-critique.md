# Kasero UX/UI Critique vs. Direct Competitors
Date: 2026-05-20
Method: Code review of `apps/web/src` + Mobbin visual references (iOS)

## TL;DR

- **The POS surface is the biggest cramping offender.** `SalesView` stacks a heavyweight `SalesStatsCard` (eyebrow + headline + sub-metrics) above a 2-column `ProductPicker` grid AND a persistent `CartSheet` FAB inside a single `IonContent`. Competitor POS/cart flows (Wolt, Shake Shack, Instacart) push KPI/header into a collapsible scroll region and reserve the visible canvas for product tiles + a single floating CTA. Kasero's tiles end up ~140-160px tall in a 2-col grid on a 390px viewport — readable, but with no breathing room between the stats card and the search/scan row.
- **Modals are doing far too much.** The product flow alone has 15 step components under `components/products/steps/` (NameStep, PriceStep, AiBarcodeStep, AnalyzingStep, ReviewStep, SuggestedCategoryStepWrapper, etc.) inside one `IonNav`-driven modal. Shopify and Stripe Dashboard solve the same problems with full-page pushes and a single-screen-per-decision rhythm. Kasero compresses a wizard into a sheet, which is why "Review" steps blew up enough to require a `ProductFormProvider`-inside-modal workaround.
- **The Home dashboard does too many jobs per pixel.** `HomeView` renders a hero, `RevenueCard`, three feature tiles (`SalesTile`/`ProductsTile`/`ManageTile`), `WeekTrendCard`, and `AlertsSection` in one scroll. Stripe Dashboard and Revolut Business both lead with one dominant KPI block + a horizontally swipeable secondary row, then defer the rest behind "Reports" / "Edit overview" entry points.
- **Manage tab is the cleanest surface and can be left mostly alone.** `IonList inset` + `FeatureCard` already match Shopify / Notion settings patterns. Focus redesign budget on Home + Sales (POS) + Products (catalog + add/edit modal).
- **The Mercantile brand identity (Fraunces hero, mono eyebrows, terracotta accents, cream paper) is a real differentiator.** Keep it. The cramping is layout density and modal architecture, not the visual language.

## What Kasero does well

- Brand system is genuinely distinctive. The Fraunces + Geist + JetBrains Mono trio with terracotta-on-cream is more memorable than any direct competitor I reviewed. None of Shopify/Square/Shopify POS/Stripe have an identity that survives a screenshot crop.
- Token discipline is excellent — `base.css` exposes a complete semantic scale (`--color-text-secondary`, `--space-*`, `--radius-*`) and `ionic-theme.css` properly bridges to `--ion-*`. The redesign can change layout without breaking the visual language.
- The modal compound primitive (`Modal.Step` + `Modal.Footer`) and the `TabContainer` sub-tab primitive are the right shape. The issue isn't the primitives, it's how many steps are packed into them.
- POS "session open vs closed" two-state shell (terracotta left rule in `.sales-stats-card--open::before`) is a smart, on-brand affordance you won't find on Square.
- Realtime architecture, optimistic UI, offline envelope, and i18n are all serious. None of this is wasted on the redesign.

## Cramped / friction findings (per flow)

### 1. Auth + onboarding + business creation

**What Kasero does now.** `AuthWizardPage` drives `wizard-steps/{EmailStep, NameStep, VerifyStep}` with a custom `WizardNavContext`. `CreateBusinessModal` is a separate `IonModal` with its own multi-step `steps/` subdirectory. Each step is a dense form inside a modal sheet.

**What competitors do.** Chime (https://mobbin.com/screens/0ce2d86a-ae4a-4dbd-b04f-1197d195502b) and Stake (https://mobbin.com/screens/e9bc6163-0f6f-492c-8a4d-cb3d5892ecae) use full-page pushes with a single decision per screen, big top-aligned headline, a progress indicator at the top, and one CTA pinned to the keyboard. Shopify "Create a store" (https://mobbin.com/screens/1a525604-fae3-453e-9838-af1b5d3f2497) takes the same approach — one input, one button, no chrome.

**Friction pattern.** The Kasero wizard is rendered inside a constrained modal sheet, which means the keyboard collapses the form into ~60% of the viewport. The "one question per page" rhythm is correct, but the sheet container undercuts it. Progress feedback is also weak — there's no visible "step 2 of 3" indicator like Chime's three-circle row or Duolingo's progress bar (https://mobbin.com/screens/fd400ad7-c96a-4895-938c-0963a5b3168a).

**Recommended change.** Promote the auth wizard from a modal to a full `IonPage`-per-step flow under `/auth/(email|name|verify)`. Use IonRouterOutlet's native push animation. Add a top progress strip: a 4px bar using `var(--color-brand)` over `var(--color-hair)`, with `transition: width var(--duration-slow) var(--ease-out-expo)`. For `CreateBusinessModal`, keep it as a modal but cap to 3 steps max (name + locale + logo); push optional steps to a post-create "Finish setup" deferred prompt on the Home tab.

### 2. Home / dashboard

**What Kasero does now.** `HomeView` (`apps/web/src/components/tab-shell/views/HomeView.tsx:173-221`) renders 7 vertical blocks: `HomeHero`, `RevenueCard`, GroupLabel, `home-tiles` (3 feature tiles), GroupLabel, `WeekTrendCard`, `AlertsSection`. On a 390px viewport this is roughly two screens of scroll before you see alerts. Tiles in `.home-tiles` are full-width stacked cards each containing icon + title + 2-3 sub-stats.

**What competitors do.** Stripe Dashboard Home (https://mobbin.com/screens/e345975a-5113-4ffd-8b71-1abc1481379e) leads with a single "Today" stat block (Gross Volume / Payments / Customers as three columns inside one card) then a horizontally swipeable timeframe pill row (1W/4W/1Y/MTD/QTD/YTD/ALL) and a single dominant chart. Revolut Business (https://mobbin.com/screens/4cbc7fb1-eaaa-4067-9e4b-d42b9cb4a7bf) uses one stat per card stacked, but each card is half-height with a tight chart. Shopify Analytics (https://mobbin.com/screens/e927b412-dbe2-4a78-a81a-85b24fdb22f2) tiles four KPI cards in a 2x2 grid.

**Friction pattern.** Stacking three large feature tiles (Sales / Products / Manage) reproduces the bottom tab bar in card form — they're navigation, not data. Mixed with KPI cards (RevenueCard, WeekTrendCard) and AlertsSection, the user can't separate "what's the state of my business right now" from "where do I go next."

**Recommended change.** Collapse `SalesTile`/`ProductsTile`/`ManageTile` into a single compact "Today's session" strip or remove entirely (the bottom tabs already cover navigation). Promote `RevenueCard` to the hero position with `--text-hero` for the headline number. Move `WeekTrendCard` directly below as a half-height variant. Push `AlertsSection` rows into a "Needs attention" badge on the relevant tab icons instead of duplicating them on Home. Net: Home becomes 3 blocks (hero + week + alerts) instead of 7.

### 3. POS / cart / checkout

**What Kasero does now.** `SalesView` open-session layout (`apps/web/src/components/tab-shell/views/SalesView.tsx:65-77`) stacks `SalesStatsCard` (with eyebrow + sub-metrics) above `pos-workspace__grid` (search row + scan button + 2-col `product-grid`) with a `CartSheet` FAB. From `sales-tab.css:288-318` product tiles are 1.5px-bordered cream cards with name + mono price + qty stepper, 12px gap, 16px outer padding.

**What competitors do.** Wolt's POS-like grocery picker (https://mobbin.com/screens/72946448-8085-46cc-a66a-bb9b6a3bd3a5) puts the product grid edge-to-edge with NO header card, and a single full-width "View order" pill at the bottom. Instacart cart (https://mobbin.com/screens/3518e803-7e34-4b29-b9e5-0d4a9bbc0707) follows the same rhythm — minimum chrome, big tap targets (~150px tiles), and one persistent green "Go to Checkout" pill. Shake Shack (https://mobbin.com/screens/171583d8-23b9-4f5d-a416-c7bd0da29a7a) uses category icons in a horizontal scroller above the grid, total chip + "Check Out" pill at the bottom.

**Friction pattern.** Kasero spends roughly 180px of vertical real estate on the stats card before the user reaches the search bar — and that's during the moment they're actively trying to ring up a sale. The stats card belongs on the closed-session reports view, not above the live register. Also, the qty stepper rendering inside the tile (when in cart) competes for the same 50% width as the product name and the price — three competing focal points per ~165px tile.

**Recommended change.**
- When session is open, hide `SalesStatsCard` behind a pull-down or replace it with a 32px slim "Open since 9:14am · 8 sales · $214" strip using mono 11px text and `var(--color-paper-deep)` background.
- Move qty +/- out of the tile body. On tap-add, show the count as a small chip overlay on the top-right of the tile (matches Wolt's blue "1" badge pattern). Long-press or swipe to adjust. Keeps the tile readable.
- Pin the cart pill to the bottom as a full-width terracotta pill (like Wolt's blue) instead of a circular FAB — easier to thumb-tap, communicates the total inline. Use `var(--color-brand)` background + `var(--color-text-inverse)` text + mono price.
- Increase `product-tile` min-height to ~155px and bump tile gap from `--space-3` (12px) to `--space-4` (16px) on the outer grid. The 2-col grid will still fit 4 visible rows.

### 4. Product catalog + inventory

**What Kasero does now.** `ProductsView` has segmented sub-tabs (Products / Orders), then per-tab: search, filter pills, sort sheet, then `ProductsTab` list. The Add/Edit modal is the 15-step beast described above. From `products-tab.css` (935 lines) the row treatment is icon + name + price + mono "n left" chip + swipe-row actions.

**What competitors do.** Shopify Products (https://mobbin.com/screens/691c0f9f-55e7-48ba-ab93-9966e7049916) uses a single segmented control (All/Active/Draft/Archived), one filter pill row, then a minimal list — each row is image + name + "X available · Y variants" in one secondary line. Shopify Inventory (https://mobbin.com/screens/df4e7da6-1b64-4b4d-aaf3-cfc357147e72) reduces further: variant name + numeric input. Shopify Products empty state (https://mobbin.com/screens/e686eca8-26d8-4082-a0ea-9327a3af11a9) leads with "Out of stock products" as a horizontal card scroller.

**Friction pattern.** The biggest issue is the add/edit modal, not the list. Stuffing 15 steps into one IonNav-backed `IonModal` causes the form-context propagation bug documented in the code (`apps/web/src/components/tab-shell/views/ProductsView.tsx:876-882`). That's not a bug to fix — it's a smell that the wizard is too long. Add-product should be a 3-screen push flow: (1) photo or scan (AI runs in background), (2) name/price/category review, (3) success.

The list itself is fine but dense — the row has icon, name, price, stock chip, swipe affordance, and category-color stripe (depending on variant). On a 390px viewport that's ~5 visual elements per row at 64px height.

**Recommended change.**
- Split `AddProductModal` from a 15-step IonNav into a top-level `/products/new` IonPage flow with 3 pushed sub-routes. Reuse the same step components — they're well-factored — but render them as `IonPage` not modal pushes. This also kills the form-provider-inside-modal workaround.
- For the list, drop the inline "n left" chip and surface low-stock as a single leading 3px terracotta rule (`box-shadow: inset 3px 0 0 var(--color-warning)`) — same vocabulary as the open-session stats card. Frees ~60px per row.
- Add a horizontal "Out of stock" card scroller above the main list (Shopify pattern) — turns the "filter to low stock" deep-link into an always-visible quick-glance section.

### 5. Settings / team / account (Manage)

**What Kasero does now.** `ManageView` uses `page-hero` + `manage-hero` identity card + `IonList inset lines="full"` for grouped settings rows + `FeatureCard` 2-col grid for Team/Providers shortcuts + danger-zone `IonList` at bottom. Each row is icon + label + optional `IonNote` end value. This is solid.

**What competitors do.** Notion Members (https://mobbin.com/screens/ab08565d-4d0b-4723-a297-607cf6d55513), Linear (https://mobbin.com/screens/901ee719-dec0-4359-929f-60eaba17709a), GroupMe (https://mobbin.com/screens/25aca6d0-843c-40ff-8280-24f760c5a485) all use the same "section header + inset list + member row with avatar + role on the right" pattern. Kasero's `TeamMemberListItem.tsx` already does this.

**Friction pattern.** Honestly minimal. The Manage tab is the most polished surface in the app. One small thing: the `manage-banner` for pending/incoming transfers is a full-width inline card with icon + body + chevron — it competes visually with the identity card right above it. On a transfer-pending render it stacks 3 hero-weight blocks before the first settings group.

**Recommended change.** Demote `manage-banner` to a slim 40px-tall strip directly under the page hero — saffron-tinted background (`var(--color-warning-subtle)`), one line of text, no chevron (whole strip is the tap target). Saves ~80px and matches the Stripe Dashboard incident-banner pattern. Otherwise leave Manage alone.

### 6. Barcode scanner + AI snap-to-add

**What Kasero does now.** `LiveBarcodeScanner.tsx` + `useBarcodeScan` hook. AI flow: `AiPhotoStep` → `AnalyzingStep` (loading) → `SuggestedCategoryStep` → `ReviewStep` inside `AddProductModal`.

**What competitors do.** alias (https://mobbin.com/screens/0867a5a8-d909-439a-92c6-391eaeb3c27c) and MyDyson (https://mobbin.com/screens/b82c0b71-ea01-47ab-80fe-051adf9e0bee) both use a viewfinder with corner brackets on a dimmed background, centered hint text, and a bottom action area that smoothly transitions to a result card after scan. Yuka (https://mobbin.com/screens/0809f49a-2a01-465a-b7bb-4d9af26c0ae3) shows "Unknown product · Fill in the information" as a clean bottom sheet on no-match. Mercari "Camera" (https://mobbin.com/screens/1ab4a9ea-87b1-4756-984d-0b1d9d29219c) has a tabbed bottom row: Album / Camera / Barcode — one camera surface, three input modes.

**Friction pattern.** The biggest miss is that scan and AI-photo are separate entry points in Kasero (scan button in the search row, AI button inside the add modal). Mercari proves a single camera surface with mode tabs is faster and more intuitive — and it removes a decision ("do I scan or photograph this?") from the user.

**Recommended change.** Unify into a single camera page: full-screen camera with corner brackets, a 3-tab bottom strip (Barcode · Photo · Manual), and a transient result card that animates up from the bottom on success. On barcode match → open existing product. On photo → run the AI pipeline with a `--color-brand`-tinted progress chip overlaid on the captured frame instead of a separate `AnalyzingStep` screen. On no-match → animate to manual entry pre-filled. Eliminates 3-4 steps from the current flow.

## Cross-cutting patterns to adopt

1. **Bottom-pinned primary action pill.** Every competitor POS/cart/checkout (Wolt, Instacart, Shake Shack, Snoonu, Shopify) uses a full-width pill pinned to the bottom safe area. Kasero uses circular FABs in several places (CartSheet, scan button). Convert primary action affordances to full-width pills with mono price/count baked in.

2. **Skeleton states on data loads.** `HomeView` uses `isLoading={!salesLoaded}` props but renders empty `null` or `0` values during load. Shopify and Stripe both show shimmering placeholders sized to the final content, which prevents the "0 → real number" flash that makes the UI feel laggy.

3. **One question per pushed page > many steps per modal.** Auth wizard, create-business, add-product all benefit from this. The `superpowers:writing-plans` patterns in this repo already favor decomposition; apply the same to user flows.

4. **Horizontally swipeable secondary sections.** Stripe's timeframe pill row, Shake Shack's category circles, Shopify's "Out of stock products" scroller — they all defer secondary content into a horizontal scroller to keep vertical surface focused. Kasero's `home-tiles` and `manage-workspace` would benefit.

5. **Demoted toolbar metadata.** Stripe Home (https://mobbin.com/screens/b5a04277-caef-4207-a575-56658db36b01) puts the merchant identity into a tiny circle button in the toolbar, not a full identity card on every screen. `BusinessHeader` and `manage-hero` duplicate identity info — pick one.

6. **Tap-target minimums.** Most rows in `IonList` inherit Ionic defaults (~44px). For artisans handling phones one-handed, push to 56-64px (`--touch-target-min` is already defined as 56px but I don't see it consumed). Apply via `--min-height` on `ion-item`.

## Brand preservation notes

The Modern Mercantile identity is the moat. The redesign should preserve:

- **Type system as-is.** `--font-display: Fraunces` for hero numbers and step titles. `--font-mono: JetBrains Mono` for prices, codes, eyebrow labels — keep the uppercase tracked `0.10em` letter-spacing for eyebrows (it's distinctive and reads like a printed receipt).
- **Terracotta restraint.** `--color-brand` (#B5471F) stays reserved for state moments — open session, primary CTA pill, scan affordance, focus rings. Don't widen it to button rims or hover states across the board.
- **Cream paper canvas.** `--color-paper` (#F6EFDF) is unusual and recognizable. Keep `--color-bg-base` mapped to it. The redesign can simplify, but should NOT switch to a neutral white/gray Shopify-style canvas.
- **Italic Fraunces accents.** The `<em>` pattern in page heroes (`manage.page_title_emphasis`) is a signature move. Worth carrying into the new POS register-state eyebrow and the new dashboard hero number sub-line.
- **Hairline borders + soft paper shadows.** `--shadow-md` (1px hairline + warm-khaki drop) is the right elevation language. Avoid migrating to high-contrast Shopify-style hard shadows.

## Suggested next steps (prioritized)

1. **POS surface redesign.** Replace the open-session `SalesStatsCard` with a 32px slim strip, move cart FAB to full-width bottom pill, increase tile breathing room. This is the highest-traffic surface and the one the owner is touching daily — biggest morale + speed win.
2. **Add-product flow extraction.** Lift the 15-step modal into a `/products/new` route push flow. Kills the form-provider workaround as a side benefit, and matches the way the user actually thinks about adding a product (photo → confirm → done).
3. **Home dashboard collapse.** Cut from 7 blocks to 3 (hero stat / week trend / alerts). Promote `RevenueCard` to use `--text-hero`. Remove the three feature tiles — the bottom tabs already cover navigation.
4. **Unified camera surface.** Merge scan + AI photo into one camera page with mode tabs.
5. **Skeleton loading states** added to RevenueCard, WeekTrendCard, ProductPicker — small effort, big perceived-perf win.
6. Leave **Manage**, **Team**, and the **modal compound primitive** alone. They're the cleanest parts of the system.
