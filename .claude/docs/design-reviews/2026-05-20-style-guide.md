# Kasero Style Guide — Per-Screen Mobbin References
Generated: 2026-05-20 from real screenshots at iPhone 393×852 viewport.

## How to read this

For each screen group:
- Kasero screenshot path
- What works
- What's cramping/friction (specific — measurements, contrast, typography)
- Mobbin reference URL + app + why this one
- The exact change: file paths, CSS tokens, component swaps. Use the brand tokens from `apps/web/src/styles/base.css` — never hardcode.

## Brand foundation (do not lose)

From `apps/web/src/styles/base.css`:
- Display serif `--font-display: 'Fraunces'` with `font-variation-settings: "SOFT" 40` and italic accent words ("Your **roster**", "Take **payment**", "Paid **in full**"). H1 = `--text-4xl` 36px / weight 400 / line-height 1.05, letterspacing `-0.028em`.
- Body sans `--font-body: 'Geist'` with OpenType `ss01,ss02,cv11`.
- Tabular numerics `--font-mono: 'JetBrains Mono'` for labels (`SETTINGS`, `TENDERED`), codes, money, dates.
- Paper canvas `--color-paper #F6EFDF`; surface `--color-surface #FFFCF5` (the cream-on-cream stack). Ink ramp `#1B1815 → #514B40 → #8B8475 → #B8B0A0`. Hair lines `--color-hair #DCD2BB`.
- Terracotta brand `#B5471F`, used filled for primary CTAs, low-alpha for accent borders via `--glow-*`. State colors are warm: moss success, saffron warning, oxblood error. No bright lime, no pure red.
- Receipt aesthetic: dotted leaders (`border: 1px dashed var(--color-hair)`), dotted top/bottom rules on receipt rows, mono labels in ALL CAPS letter-tracked.

Anything new must keep: serif headings with italic accent, mono micro-labels, paper-on-paper layering, dotted leaders for receipt rows, and terracotta only as the brand spot. Avoid any flat-white surface — it instantly looks like a different app.

---

## Screen-by-screen

### 1. Welcome / OAuth — `screens/kasero-entry.png`
**Mobbin: https://mobbin.com/screens/18a79b23-649c-4968-b3fa-713adcdb2602 — Yazio**
- Works: serif "Welcome to *Kasero*" with italic accent is exactly the brand voice. Cream canvas, no overdesigned hero.
- Friction: the **Continue** button is rendered in the disabled tint (`opacity ~0.4` peach), which fights the "primary action" reading even when enabled. The email input has no visible border on cream — it disappears. Tight ~12px gap stacks email/Continue/divider/Google/Apple into a single dense block.
- Why this reference: Yazio uses three equal-weight stacked buttons with comfortable 16px vertical gaps on a calm cream canvas — and never grays out the primary until the user actually types something invalid. Very close to what Kasero is reaching for.
- Concrete change in `apps/web/src/components/auth/` (Welcome screen):
  - Keep the email input but give it `background: var(--color-surface); border: 1px solid var(--color-hair); border-radius: var(--radius-xl); padding: 14px 16px`.
  - Continue button: filled `background: var(--color-brand); color: var(--color-text-inverse)` at full opacity from the start (validate on submit; show inline error rather than greying out).
  - Stack gaps: `gap: var(--space-3)` between input and Continue, `var(--space-4)` between Continue and divider, `var(--space-3)` between OAuth buttons.
  - Drop the "or" divider — replace with `var(--space-4)` whitespace; the OAuth section's mono label `OR CONTINUE WITH` (`--text-xs`, `letter-spacing: 0.08em`, `var(--color-text-tertiary)`) is enough.

### 2. OTP verify — `screens/kasero-verify.png`
**Mobbin: https://mobbin.com/screens/0b09b847-8314-4e70-ba69-8b02a6f4792e — Pi**
- Works: only the first box has terracotta focus ring, six big boxes on cream is correct.
- Friction: the six boxes float in the middle of the screen with no "Continue" / "Resend in 30s" pattern. "Send a new code" link is too prominent and instantly tappable — a user who hasn't typed will see the link as the next action.
- Why this reference: Pi uses the exact same warm-cream + serif aesthetic, with full-width disabled-state Continue under the boxes and a secondary "I didn't get a text" link that recedes. Same identity, better hierarchy.
- Concrete change in the verify component:
  - Add a sticky-bottom `<Modal.Footer>`-style Continue button (auto-submit on 6th digit, but show button so users know what's next).
  - Move "Send a new code" below the button as `color: var(--color-text-tertiary); font-size: var(--text-sm)` with a 30-second countdown: `Send a new code in 0:30`. After countdown, swap to active terracotta link.
  - Box size: bump from current ~52px square to `width: 48px; height: 56px; border-radius: var(--radius-lg)`, gap `var(--space-2)` — matches OS autofill better.

### 3. Hub (after login) — `screens/01-after-login.png`
**Mobbin: https://mobbin.com/screens/124b3f42-67ef-4915-8ccf-c459d449b6b2 — Expensify**
- Works: "Good *afternoon*, Alejandro" greeting is on-brand. `OWNED · 01` mono mini-cap is the right pattern.
- Friction: two giant "Create a business" / "Join a business" tiles for what is, for most users, a one-time action take up the visual weight that should belong to the owned-businesses list. Search bar is shown for one business.
- Why this reference: Expensify presents the user's actual workspaces first with a tight "+ New workspace" CTA above; secondary actions live in a low-prominence action sheet.
- Concrete change in `apps/web/src/components/hub/`:
  - Promote the OWNED list to the top; collapse "Create" and "Join" into a single mono-label row: `+ NEW · JOIN WITH CODE`. Tapping reveals the existing two cards as a `<ActionSheet>`.
  - Hide the search input until `businesses.length >= 4`.
  - Owned business row: keep the mark badge but reduce padding to `var(--space-3) var(--space-4)`; the current ~88px tall row for "1 member" is excessive.

### 4. Home dashboard — `screens/02-home-tab.png`
**Mobbin: https://mobbin.com/screens/88ed6be5-32ab-47bb-b4ae-f8a1f4147395 — Me+**
- Works: revenue hero in `--text-hero` Fraunces italic is the strongest single moment in the app.
- Friction: 7 stacked blocks (greeting + REVENUE card + 3 nav cards + THIS WEEK card + ...). The 3 nav cards (SALES/PRODUCTS/MANAGE) duplicate the bottom tab bar and create double navigation. Each card is a tall ~90px block doing both KPI + nav.
- Why this reference: Me+ uses one calm hero, a 2-up tile row that mixes one big and two small tiles, then a single grouped list — three layers max.
- Concrete change in `apps/web/src/components/home/`:
  - Keep `RevenueCard` as the hero.
  - Replace `SalesTile + ProductsTile + ManageTile` (3 full-width cards) with a single 2-column mini-tile row: left = "No session — Tap to start" (the only one that's actionable); right = a 2-row stack of small mono lines `0 PRODUCTS` / `1 MEMBER`. Use `grid-template-columns: 1fr 1fr; gap: var(--space-3)`.
  - Then `WeekTrendCard`. Stop there. No `AlertsSection` unless there's a real alert.
  - Result: 1 greeting + 1 hero + 1 row + 1 trend = 4 vertical blocks instead of 7+.

### 5. Sales tab (no session) — `screens/03-sales-tab.png`
**Mobbin: https://mobbin.com/screens/0a8129b2-2107-431d-b2d6-544d72eb2610 — Monzo**
- Works: the stats card (TRANSACTIONS / AVG TICKET / VS YESTERDAY) is the cleanest tri-stat row in the app. `Open session` filled terracotta CTA is unmistakable.
- Friction: **the Daily revenue chart is broken.** Seven `S/ 0…` labels overlap horizontally (each truncated to "S/ 0…" because each gets ~46px of width). There are no bars, no Y-axis, no value labels — just text noise above day-of-week ticks. A new user sees garbled output.
- Why this reference: Monzo's Trends chart is the canonical "one big spent number + one bar chart with Y-axis labels on the right + clear day buckets on the X" pattern. Bars are inset with rounded tops, no overlapping labels.
- Concrete change in `apps/web/src/components/sales/reports/` (or wherever `LAST 7 DAYS` lives):
  - Remove the row of `S/ 0.xx` value labels above the bars entirely. Replace with **Y-axis labels** on the right edge (`MAX`, `AVG`, 0) in `--font-mono` `--text-xs` `--color-text-tertiary`.
  - Bars: render as inset blocks with `background: var(--color-brand); border-radius: var(--radius-sm) var(--radius-sm) 0 0; min-height: 2px` (so a zero-day still shows a hairline).
  - Highlight today's bar with `--color-brand`, prior days with `--color-brand-tint` at 60% opacity.
  - Tooltip-on-tap (already supported by Ionic `IonModal`) shows the exact `S/ x.xx` for that day.

### 6. Open session modal — `screens/04-open-session-flow.png`
**Mobbin: https://mobbin.com/screens/8df8ec5b-6ecf-4c0f-bc61-f52be547e054 — Acorns**
- Works: enormous Fraunces `S/ 0.00` display with italic cents, mono `STARTING CASH` label. The keypad is large-touch-target. "Open the *till*" voice is perfect.
- Friction: the keypad keys have no border and no fill — they're just numbers on cream. On a real device with mixed reflections this becomes a tap-guess. Bottom Open session CTA is good but `background: var(--color-ink)` black competes with the brand terracotta everywhere else.
- Why this reference: Acorns uses a large display number, comfortable keypad with implicit hit targets and bottom-anchored brand-color CTA. The pattern Kasero is reaching for, just with rendered keys.
- Concrete change in `apps/web/src/components/sales/OpenSessionModal.tsx`:
  - Wrap each key in a subtle pill: `background: var(--color-bg-muted); border: 1px solid var(--color-hair-soft); border-radius: var(--radius-xl); height: 56px` and `:active { background: var(--color-paper-deep) }`.
  - Switch CTA to `background: var(--color-brand); color: var(--color-text-inverse)`. Black is currently used inconsistently — reserve it for the cart Confirm (a different semantic).

### 7. POS empty catalog (session open) — `screens/06-pos-empty-catalog.png`
**Mobbin: https://mobbin.com/screens/b4f376ad-bc87-455e-9980-24586a3e2d71 — Woolworths**
- Works: the session-state hero card with terracotta left border and `Close session` brand-filled CTA is excellent. Sticky `VIEW CART · 0 · S/ 0.00` mono bar at bottom is the right pattern.
- Friction: when there are no products, the "No products yet — Add products in Manage to start ringing up sales." empty state sits cold in the middle. The CTA "Add products" should be a button right there, not a navigate-elsewhere instruction.
- Why this reference: Woolworths gives an empty cart a friendly illustration, one sentence, and a single primary button to the next action. Kasero already has the illustration + sentence — it's missing the in-place button.
- Concrete change in `apps/web/src/components/sales/ProductPicker.tsx`:
  - In the empty branch, add a primary button below the body text: `<IonButton>Add your first product</IonButton>` that pushes to `/products/add` directly (use `useIonRouter().push()`).

### 8. Products empty — `screens/07-products-empty.png`
**Mobbin: https://mobbin.com/screens/5a4f7fe6-4078-48fa-8d66-d3def79cb231 — Klook**
- Works: friendly tag icon, "*No products yet*" italic serif, single terracotta CTA — this is already a Mobbin-quality empty state. Klook's pattern is essentially identical.
- Friction: the `PRODUCTS / ORDERS` segmented tab at top is rendered (with a tab background drop shadow) even though the user has zero products — Orders is meaningless here.
- Concrete change in `apps/web/src/components/products/ProductsTab.tsx`:
  - Hide the segmented `TabContainer` until either `products.length > 0` or `orders.length > 0`. Render only the empty state until then. Same rule for Sales tab's "no products" branch.

### 9. POS with one product (orphaned tile) — `screens/22-pos-with-product.png` and `screens/28-pos-in-stock.png`
**Mobbin: https://mobbin.com/screens/5c42d6ab-3ff3-4f4a-8553-ba6bec88caf6 — Blue Bottle Coffee**
- Works: tile shows icon + name + mono price + stock state.
- Friction: this is the **#1 visual bug**. A single product renders as one ~178px-wide tile in the left column with empty paper on the right — the user reads it as a "broken" or "loading" half row. The qty stepper `[− 1 +]` lives inside the tile body, eating ~40px of vertical space and competing with the price line.
- Why this reference: Blue Bottle uses **full-width rows** for cart items with a left thumbnail, name + price stacked, and the qty stepper anchored to the right edge — never crammed inside a square tile. A row layout scales to 1, 2, 5, 50 items with no orphan ever.
- Concrete change in `apps/web/src/components/sales/ProductPicker.tsx`:
  - Switch the product list from `grid-template-columns: repeat(2, 1fr)` to a single-column row layout: `display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-radius: var(--radius-xl); background: var(--color-surface); border: 1px solid var(--color-hair)`.
  - Move the qty stepper **out of the tile body** — render it only in the *selected* state, anchored right at `position: absolute; right: var(--space-4)`. Inactive tiles show just `+ ADD` (mono caps, `--color-brand`) on the right.
  - Tap anywhere on the row → adds 1 / opens stepper. The current 2-col tile pattern is wrong for a catalog that will routinely have 3–8 items.
  - If the user grows past ~20 products, switch to a 2-col grid via a `useMemo` threshold — but rows are correct for the small-business norm.

### 10. Products list (populated) — `screens/21-products-populated.png`
**Mobbin: https://mobbin.com/screens/e686eca8-26d8-4082-a0ea-9327a3af11a9 — Shopify**
- Works: `1 PRODUCT · SETTINGS` mono header, `+ ADD` pill in terracotta, item row with icon + serif name + UNCATEGORIZED mono label + serif price.
- Friction: **`0 UNITS` red badge on a brand-new product is alarming.** The user just created the product 3 seconds ago — flashing an error-tinted badge teaches them "creation = problem." Also `S/ 5.00` and `0 UNITS` are stacked tight at the right, reading as two competing labels.
- Why this reference: Shopify's product list uses a quiet `Draft · 1 available` line in a single secondary-text row — stock is contextual, not alarmist. Only goes red when stock has actually been set and decremented below threshold.
- Concrete change in `apps/web/src/components/products/ProductsTab.tsx`:
  - Replace `0 UNITS` red pill with a stock-state token:
    - `stock === null` → render `UNTRACKED` in `var(--color-text-tertiary)` mono.
    - `stock > 0` → `IN STOCK · {n}` in `var(--color-success)` mono.
    - `stock === 0` AND product has had at least one sale → `OUT OF STOCK` in `var(--color-warning)` (saffron), not oxblood.
    - `stock === 0` AND product has never sold → `READY · SET STOCK` in mono `var(--color-text-tertiary)`, tap → opens the adjust-stock step directly.
  - Stack right-side metadata as `flex-direction: column; align-items: flex-end; gap: var(--space-1)` with price on top, stock label below in mono `--text-xs`.

### 11. Cart drawer — `screens/31-cart-modal.png`
**Mobbin: https://mobbin.com/screens/5c42d6ab-3ff3-4f4a-8553-ba6bec88caf6 — Blue Bottle Coffee** (same ref, deeper use)
- Works: `RECEIPT IN PROGRESS` mono kicker, "Your *cart*" italic title, line item with mono math `S/ 5.00 × 1 = S/ 5.00`, paper-deep Subtotal panel. Genuinely the most distinctive cart UI I've seen for a POS. Keep all of this.
- Friction: only one — the Confirm CTA is black (`background: var(--color-ink)`) while every other primary action in the app is terracotta. This creates a momentary "is this a different action?" pause.
- Concrete change in `apps/web/src/components/sales/cart-modal/`:
  - Confirm button: change `background` to `var(--color-brand)`. Keep label "Confirm" in `--font-body` weight 500. Inline total on the button: `Confirm · S/ 5.00` in mono to mirror the bottom-bar pattern elsewhere.

### 12. Payment — `screens/32-payment.png`
**Mobbin: https://mobbin.com/screens/d27881eb-7120-4287-bbc1-8d72a22982fb — Shopify** (POS-side checkout)
- Works: `TENDERING` kicker, "Take *payment*" italic, CASH/CARD/OTHER tri-segment with icons, EXACT / S/ 10.00 / S/ 20.00 chips, and the Total panel separated by a deep paper band. The **Charge · S/ 5.00** CTA at bottom is the right pattern.
- Friction: Charge CTA is rendered in disabled tint until tender ≥ total. Since `EXACT` is one tap, users perceive a stuck state and tap CASH again. Also the EXACT chip is the only one in terracotta-outline while denominations are neutral — visual hierarchy is unclear about which is recommended.
- Why this reference: Shopify POS shows the Charge CTA active immediately when method = card or when EXACT cash is the implied default. Friction = zero.
- Concrete change in `apps/web/src/components/sales/cart-modal/PaymentStep.tsx`:
  - Default `tendered = total` and method = `CASH` on step entry. Charge button is active from the first frame; tapping a denomination chip adds to tendered, EXACT resets it back to total. The current "type your tender then unlock" mental model is wrong for a small-vendor flow where 70%+ of sales are exact cash.
  - Move EXACT into the denominations row as a leading chip with the same neutral border; mark the suggested amount (current `tendered`) with `--color-brand` border to indicate selection, not affordance.

### 13. Payment success — `screens/33-payment-success.png`
**Mobbin: https://mobbin.com/screens/53f897fd-3521-48db-8f65-a5755960c229 — Everyday Rewards**
- Works: green checkmark, `SALE 0001 · COMPLETE` mono pill, "Paid *in full*" italic, METHOD/TENDERED/CHANGE/TOTAL dotted-leader receipt, terracotta DONE CTA. **This is the gold standard of the entire app.** Don't touch it.
- Mobbin shows the same checkmark + receipt-block pattern; Kasero's version is actually more refined (italic accent, mono number).

### 14. Add Product flow (Steps 1–4 + review) — `screens/13`, `14`, `15`, `16`, `17`, `18`, `19`
**Mobbin: https://mobbin.com/screens/4439d48a-0f3c-443c-8249-fd951894e316 — Recime**
- Works: each step has the mono `STEP 1 OF 4` kicker + italic serif question ("What's the *name*?", "How much is *it*?"). Receipt-style Review step with PRICE/CATEGORY/STOCK/BARCODE dotted-leader rows is the second-best moment in the app after Payment Success.
- Friction: the 4-step modal stack is heavyweight for a path that, in the AI-assisted branch, is supposed to be "snap and done." Continue is rendered greyed-disabled until name is non-empty. The Step 1 icon picker shows 5 small icons in a horizontal scroll with `NO ICON` and `RESET` mono labels — feels engineered for the picker, not the user.
- Why this reference: Recime uses a thin terracotta progress bar at the very top + one large-typography prompt + a single Next CTA. No "X of Y" wordmark. The progress bar IS the step count.
- Concrete change in `apps/web/src/components/products/steps/` and `AddProductModal.tsx`:
  - Replace `STEP 1 OF 4` text with a 2px-tall progress bar at `top: 0; background: var(--color-brand); width: calc(step/total * 100%)` and a thinner `STEP 1 / 4` label only on hover or under-illustration.
  - Continue button: render full-color terracotta from the start; on tap when invalid, shake + inline error under the field. The current grey-until-valid pattern teaches the user "the button is broken."
  - Icon picker on Step 1: collapse to a single `<IconButton>Choose icon</IconButton>` that opens a bottom-sheet — the inline strip eats vertical space on every step-1 entry, even from users who don't care.

### 15. Manage tab — `screens/08-manage.png`
**Mobbin: https://mobbin.com/screens/ab08565d-4d0b-4723-a297-607cf6d55513 — Notion** (Members)
- Works: "Your *business*" header, business mark + `ES-PE · PEN` mono pill, grouped BUSINESS / WORKSPACE / DANGER ZONE sections with mono section labels and dotted leaders. **Tied with Account for best-in-class internal page.** This is the design language the rest of the app should adopt.
- Reference is parity-grade — Kasero is already at Notion-quality here. Sole nit: the Logo/Name/Location group renders three cards with their own borders; could become one card with internal hair dividers (`border-bottom: 1px solid var(--color-hair)` between rows) to reduce visual rectangle count from 3 to 1.

### 16. Account & Settings sheet + page — `screens/09-menu-open.png`, `screens/10-account-settings.png`
**Mobbin: https://mobbin.com/screens/e77e46d7-ce63-4071-9db4-ff9403b4b4e9 — Notion**
- Works: Account page is excellent — PROFILE / ACCOUNT / PREFERENCES / SUPPORT / DANGER ZONE grouping with mono caps + serif page title "Your *account*".
- Friction: the bottom-sheet menu (`09-menu-open.png`) truncates the user name "Alejandro Diaz Pare…" and email "alexdiaz0923@gmai…" at ~270px. Both should wrap or expand the sheet.
- Concrete change in the hamburger sheet component:
  - Avatar row: `flex-direction: column; align-items: flex-start; gap: var(--space-1)`. Name in `--font-display` `--text-lg`, email in `--font-mono` `--text-xs` `--color-text-tertiary` with `word-break: break-all` to never truncate an email.
  - Also: in the Account page itself, the "Change email" row shows the email truncated again on the right. Switch right-side value to a second line below the label (label on top, value below in mono) so 30-char emails always fit.

### 17. Team — `screens/12-team.png`
**Mobbin: https://mobbin.com/screens/ab08565d-4d0b-4723-a297-607cf6d55513 — Notion**
- Works: "Your *roster*", "quietly retire them" copy, `+ INVITE` terracotta pill, member row with mark + name + `OWNER · YOU` mono.
- Friction: "Just you so far. Tap *Invite* to bring someone on." sentence is below the Invite button — it reads as a footnote when it's actually the empty-state prompt. The button should be the answer to the sentence, not the other way around.
- Concrete change in the Team page:
  - When `members.length === 1` (just owner), render the prompt sentence first, then the `+ INVITE` button immediately under it, then the roster header.
  - Roster header (`1 PERSON`) can also collapse here — it's redundant info next to the single member row.

---

## Cross-cutting patterns to introduce

1. **Sticky CTAs are terracotta-filled, not black.** Audit and align: `OpenSessionModal` open-button, `cart-modal` Confirm, `AddProductModal` Add to catalog. All use `background: var(--color-brand); color: var(--color-text-inverse)`. Reserve `var(--color-ink)` only for the global header/back affordances. (Reference: every Mobbin POS app uses one brand color for primary action consistently.)

2. **One card per group, not card-per-row.** Where three related settings stack as three independent cards (Manage's BUSINESS group; Account's ACCOUNT / PREFERENCES groups), collapse to one outer card with internal `border-bottom: 1px solid var(--color-hair)` dividers. Cuts visible rectangles roughly in half and feels less "settings-app-y." Reference: Notion Members screen.

3. **Disabled primary buttons should not exist on entry.** Current pattern: render disabled CTA, validate on tap, transition to active. Better pattern: render active terracotta CTA, validate on tap, shake + inline error. Applies to Welcome (Continue), Add Product steps, Payment (Charge). Reference: Shopify, Recime.

4. **List rows beat tile grids for catalogs under ~20 items.** Single-column rows with right-anchored qty/action scale gracefully from 1 to 20 with zero orphan-tile risk. Switch to 2-col grid only above a threshold. (Reference: Blue Bottle cart.)

5. **Status badges are warm-warning, not red.** `0 UNITS` and similar should use saffron `var(--color-warning)` or moss `var(--color-success)`, never oxblood, until the user has explicitly opted into stock tracking and gone below threshold. Reference: Shopify's `Draft · 1 available` pattern.

---

## Prioritized fix list

### P0 (immediate visual impact)
1. **POS tile rows instead of orphan grid.** `apps/web/src/components/sales/ProductPicker.tsx` — switch to single-col flex rows, move qty stepper to right edge in active state. **M.**
2. **Fix the Daily revenue chart on Sales tab.** Remove truncated `S/ 0…` label row, add Y-axis labels + actual bars with min-height hairlines. Component under `apps/web/src/components/sales/reports/` or `SalesStatsCard.tsx`. **M.**
3. **Stop showing red `0 UNITS` on brand-new products.** `apps/web/src/components/products/ProductsTab.tsx` — implement the four stock-state tokens (UNTRACKED / IN STOCK / OUT / READY). **S.**
4. **Sticky CTA color audit.** Replace black backgrounds on Confirm / Open session / Add to catalog with `var(--color-brand)`. **XS** across `cart-modal/ChargeButton.tsx`, `OpenSessionModal.tsx`, `AddProductModal.tsx`.
5. **Home tab compaction.** Collapse 3 nav cards (Sales/Products/Manage) into one 2-col mini-row; remove `AlertsSection` when empty. `apps/web/src/components/home/`. **S.**

### P1 (next pass)
1. **Hub: promote owned list, demote create/join.** `apps/web/src/components/hub/` — one mono-row for actions, search hidden until N≥4. **S.**
2. **Truncation fix in Account sheet + Change email row.** Stack avatar info vertically, move row values below labels. **XS.**
3. **Empty-state buttons in place.** POS empty-catalog and Products-empty get an inline primary button (not "go to another tab"). **XS.**
4. **Payment default-to-EXACT.** `PaymentStep.tsx` — `tendered = total` and Charge active on entry. **S.**
5. **Welcome screen Continue button is never greyed.** `apps/web/src/components/auth/` — activate from frame 1; inline-error on submit failure. **XS.**

### P2 (polish)
1. Add Product progress bar (replace `STEP X OF 4` with a 2px terracotta bar). **S.**
2. OTP verify: sticky Continue + 30s resend countdown. **S.**
3. One-card-per-group on Manage and Account (internal hair dividers). **S.**
4. Open-session keypad: pillow each key with `var(--color-bg-muted)` + hair border. **XS.**
5. Cart Confirm shows mono total inline (`Confirm · S/ 5.00`). **XS.**
6. Hide segmented `PRODUCTS/ORDERS` tab until either tab has content. **XS.**
