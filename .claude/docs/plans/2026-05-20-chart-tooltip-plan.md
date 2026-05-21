# Chart tap-to-tooltip — Daily revenue card

Date: 2026-05-20
Topic: P0-2 deferred follow-up — bar tap reveals exact `S/ x.xx` for the day.

## Decision

Use a self-contained inline `<div>` overlay positioned inside the active column,
instead of `IonPopover`. Reasons:

- IonPopover anchors to an event/element and renders into the modal layer —
  overkill for a 7-bar chart inside a flex row, and would inherit Ionic chrome
  we'd have to override to match the receipt aesthetic.
- An absolutely-positioned overlay above the bar track gives us full control
  over the cream surface + hairline + mono numerals look already used across the
  sales-tab reports.
- No backdrop element is needed: a global `pointerdown` listener (registered
  while open) handles tap-outside dismissal. Re-tapping the same bar dismisses;
  tapping a different bar switches.

## Implementation

`apps/web/src/components/sales/reports/DailyRevenueCard.tsx`

- Replace the inert `<div>` column wrapper with a `<button type="button">`
  spanning the full column width — this satisfies the 40px tap-target rule even
  though the visible bar is ~32px.
- Track `activeIdx: number | null` in component state. Bar click toggles.
- When open: render an absolutely-positioned `.daily-revenue-tooltip` inside the
  active column, anchored at the top of the bar-track, centered horizontally,
  with a small caret. Contents: day label (uppercased weekday + day-of-month) +
  `formatCurrency(entry.total)` in mono terracotta.
- A `useEffect` while `activeIdx !== null` registers a `pointerdown` listener on
  `document` that closes the tooltip if the event target is outside the chart
  row ref. Also closes on `Escape`.
- The active column's button gets a tonal pressed state via
  `--color-paper-deep` (cream) on the column hit area.

`apps/web/src/styles/sales-tab.css`

- Replace the existing `.daily-revenue-col` (`div`) selectors with rules that
  also apply to the new `button` element, plus:
  - `.daily-revenue-col` becomes a `button`: reset native chrome
    (`background: transparent; border: 0; padding: 0;`), pointer cursor,
    `-webkit-tap-highlight-color: transparent`, focus ring via
    `outline: 2px solid var(--color-brand)` on `:focus-visible`.
  - Tonal `:active` and `--active` modifier states use `--color-paper-deep` on
    the column background (via a thin radius), keeping the bar itself untouched.
- Add `.daily-revenue-tooltip` block: cream `--color-surface`, 1px hairline
  `--color-border`, `--radius-md`, padding, JetBrains Mono for the value in
  `--color-brand`, small day label in `--color-text-tertiary` mono uppercase.
  Position: `absolute; bottom: calc(100% + 6px); left: 50%;
  transform: translateX(-50%);` with a `::after` caret. `pointer-events: none`
  so taps fall through to the column button beneath; dismissal happens via the
  document-level listener.

## i18n

Two new keys (the rest is already-formatted numerals):

- `sales.reports.daily_revenue_tooltip_label` — aria-label for each bar button,
  e.g. `"Show revenue for {day}"`.
- No new keys are needed for the tooltip content itself: weekday + day-of-month
  come from `Intl.DateTimeFormat`, and the value comes from `formatCurrency`.

Added to every registered locale file (`en-US`, `es`, `fr`, `it`, `pt`, `de`,
`ja`, `ko`, `zh`, `vi`, `fil`) with real translations. Then regen
`messageIds.d.ts` via `npm run i18n:types --workspace=apps/web`.

## Verification

`cd apps/web && npx tsc --noEmit`.
