# P0-5 Home Tab Compaction — Plan

## Problem
Home stacks 7+ blocks; the three full-width nav tiles (Sales/Products/Manage) duplicate the bottom tab bar.

## Target structure
1. `HomeHero` (greeting)
2. `RevenueCard` (hero — unchanged)
3. **NEW** 2-col mini-row: left = session CTA (only true action), right = products + providers counts stacked
4. `WeekTrendCard` (unchanged)
5. `AlertsSection` (already early-returns null when empty — confirmed in current code)

Net: 5 anchors vs 7+ previously; nav duplication removed.

## Changes

### `apps/web/src/components/tab-shell/views/HomeView.tsx`
- Remove imports/usages of `SalesTile`, `ProductsTile`, `ManageTile`.
- Drop the `GroupLabel "home.section_today"` between hero and mini-row (mini-row needs no label — visually self-explanatory).
- Drop the `GroupLabel "home.section_this_week"` above the trend card to further compact.
- Replace `<div className="home-tiles">` with inline `<div className="home-mini-row">` containing:
  - `<button className="home-mini home-mini--cta" onClick={handleSalesClick}>` showing either "No session / Tap to start" or "Open · {amount}".
  - `<div className="home-mini home-mini--stats">` with two clickable rows: products count → /products; providers count → /manage.

### `apps/web/src/styles/home-tab.css`
- Replace `.home-tiles` rules with `.home-mini-row` (2-col grid, 12px gap) and `.home-mini`, `.home-mini--cta`, `.home-mini--stats`, `.home-mini__row` styles.
- CTA cell uses `--color-brand` background when closed; surface + brand text when open.
- Stats cell uses mono uppercase micro-rows with hairline separator.
- Cell min-height ~120px.

### i18n
New keys (en-US plus es and ja translated):
- `home.mini_cta_closed_title` = "No session"
- `home.mini_cta_closed_sub` = "Tap to start"
- `home.mini_cta_open_title` = "Session open"
- `home.mini_cta_open_amount` = "{amount}"
- `home.mini_stats_products` = "{count, plural, one {# product} other {# products}}"
- `home.mini_stats_providers` = "{count, plural, =0 {No providers} one {# provider} other {# providers}}"

Run `npm run i18n:types --workspace=apps/web` after editing locale JSONs.

## What is NOT deleted
Files `SalesTile.tsx`, `ProductsTile.tsx`, `ManageTile.tsx` left on disk (not referenced) — out of scope to delete in this fix; can be removed in a follow-up sweep.

## Verification
Playwright is disconnected; will attempt once, document if it fails. User to confirm visually.
