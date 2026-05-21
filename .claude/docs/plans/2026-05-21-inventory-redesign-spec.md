# Inventory sub-tab redesign — spec

**Date:** 2026-05-21
**Scope:** `apps/web/src/components/inventory/*` + `apps/web/src/styles/inventory-tab.css`
**Aesthetic:** Modern Mercantile (existing design system) — Fraunces italic display, Geist body, JetBrains Mono for figures, terracotta + paper/ink palette, hairline rules, stamp-style mono chips. No new tokens; everything routes through `base.css` variables.

---

## Problem

1. **Doubled padding.** `.products-page` already pads `20/16/24` and `.inventory-view` re-pads `16/16/(16+72)`. Inventory inherits then re-adds, creating the visible gutter the user flagged.
2. **Bland list.** The Inventory list is a generic bordered card with `name + "current_stock: N" + chevron` rows. None of the Mercantile vocabulary (eyebrows, Fraunces italic, stamp chips, hairline rules, terracotta accents) shows up — even though the surrounding system commits to it strongly.
3. **Modal is the weakest surface.** `AdjustStockModal` uses `pm-shell/pm-hero/pm-field` in their thinnest form: a plain title (no eyebrow, no italic emphasis on the product name), a tiny mono caption for current stock, a generic number input, a textarea, and a checkbox that pops a muted card. No drama, no quick-step delta entry, no resulting-stock preview, no thematic continuation from the list.

The Inventory tab's job — at a glance see what needs restocking, tap to adjust — should feel like a printed restock ledger, not a settings list.

---

## Direction (chosen: A from the inline options)

- **Drop the Products-style chrome** (no search, no scanner). The Inventory tab's intent is restock, not lookup; the Products sub-tab already owns lookup.
- **Add a thin status filter row** above the list: `All · Low · Out` as mono uppercase tracked pills (matches `.products-segment` family but rendered as a flowing row, not a 50/50 grid).
- **Add a one-line tally header** above the list (mono uppercase, tabular nums), e.g. `23 TRACKED · 4 LOW · 1 OUT`. Updates with active filter (`SHOWING 4 LOW`). This is the inventory ledger's "page header".
- **Rebuild the row** as a printed-ledger entry: drop the rounded card, swap chevrons for stamp-style status chips, surface stock as a Fraunces-italic large number with mono "ON HAND" eyebrow.
- **Redesign the AdjustStockModal** around the same vocabulary: Fraunces italic product name as the hero, current stock displayed as a Fraunces hero number with mono eyebrow, +/- stepper with quick-pick chips (-10 / -5 / -1 / +1 / +5 / +10), and a live "AFTER" preview that shows the resulting stock in Fraunces italic with the delta in terracotta. Expense sub-section becomes a clearly-divided "STAMP AS EXPENSE" section with hairline rule, not a muted card.

---

## Visual spec — Inventory view

### Container

Remove `.inventory-view` padding entirely. Let `.products-page` own the page gutter. Add only vertical `gap` between the header/filter/list groups.

```css
.inventory-view {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  /* Page-level bottom safe-area is handled by .products-page padding-bottom
   * and the IonTabBar's own offsetting; no need for the +72px here. */
}
```

### Tally header (`.inventory-tally`)

One line, mono uppercase tracked, tabular numerals, hairline rule beneath.

```
INVENTORY  ·  23 TRACKED  ·  4 LOW  ·  1 OUT
```

- Font: `var(--font-mono)`, `11px / 600 / letter-spacing: 0.16em`, uppercase.
- Numbers in `var(--color-text-primary)`; labels in `var(--color-text-tertiary)`.
- "LOW" tinted `var(--color-warning)` when count > 0; "OUT" tinted `var(--color-error)` when count > 0.
- Separators (`·`) in `var(--color-ink-4)`.
- Below: 1px `var(--color-hair)` rule, full-bleed inside the page padding.

### Status filter (`.inventory-filter`)

A horizontal scrollable row of three small pills, left-aligned. Family-matched to `.products-segment` but inline-sized rather than 50/50 grid.

```
[ ALL ] [ LOW ] [ OUT ]
```

- Pill: `var(--font-mono)`, `11px / 600 / 0.12em`, uppercase, padding `8px 14px`, `border-radius: var(--radius-full)`.
- Inactive: `background: transparent`, `color: var(--color-text-tertiary)`, `border: 1px solid var(--color-hair)`.
- Active: `background: var(--color-brand-subtle)`, `color: var(--color-brand)`, `border-color: var(--color-brand)`.
- Counts appended in the pill when non-empty for `LOW` / `OUT`: `LOW · 4`, `OUT · 1`. Both numbers use mono tabular-nums.
- Active filter persists in component-local state (no URL param needed — Inventory tab is consulted briefly, filter doesn't need to survive deep-link).

### Row (`.inventory-row`)

Drop the rounded card container. Replace with full-width rows separated by `1px var(--color-hair)` rules (last row no rule). This reads as a printed ledger entry.

```
┌────────────────────────────────────────────────────────┐
│ MERCH                            ON HAND               │
│ Cold brew bottle                 47                    │ <- name: Geist 16/500   stock: Fraunces italic 28/500
│                                  bottles               │ <- category eyebrow mono 10/600/0.14em  unit mono 10/600
│                                                  [LOW] │ <- chip right-aligned, only when state ≠ ok
└────────────────────────────────────────────────────────┘
```

Layout grid:

- Left column (flex 1, min-width 0): category eyebrow → product name → optional barcode mini-eyebrow.
- Right column (auto): mono `ON HAND` eyebrow stacked on Fraunces italic stock number, with optional `bottles` / `units` micro-label beneath (skip if no unit set).
- Below the right column (or absolute-positioned bottom-right): the status chip (only renders when `low` or `out`).
- Row tap-area is the full row (still a `<button>`); no chevron.

Spec details:

- Row padding: `var(--space-4)` block / 0 inline (rules go full-bleed).
- Category eyebrow: `var(--font-mono) 10px 600 / 0.18em`, uppercase, `color: var(--color-text-tertiary)`. Falls back to `UNCATEGORIZED` only if you decide to show that; otherwise omit when product has no category.
- Product name: `var(--font-body) 16px 500`, `color: var(--color-text-primary)`. Truncate single-line.
- ON HAND eyebrow: `var(--font-mono) 10px 600 / 0.16em`, uppercase, `color: var(--color-text-tertiary)`, right-aligned.
- Stock number: `var(--font-display)` italic, `font-variation-settings: "SOFT" 60`, `font-size: 26px`, `font-weight: 500`, `font-variant-numeric: tabular-nums`, `color: var(--color-text-primary)`, `letter-spacing: -0.02em`. (Italic Fraunces echoes the page hero — establishes Inventory as a typed surface.)
- Stock color shifts: `--color-warning` when low, `--color-oxblood` when zero/out.
- Status chip (`.inventory-row__stamp`): only renders for `low` or `out`. Style is a stamp pill — `var(--font-mono) 9.5px 700 / 0.18em`, uppercase, padding `3px 8px`, `border: 1px solid currentColor`, `border-radius: 2px` (sharp like a stamped corner), background `transparent`. Color is `--color-warning` for `LOW`, `--color-oxblood` for `OUT`. Optional very-subtle rotation `transform: rotate(-1.5deg)` to read like a hand-pressed stamp; gate behind `@media (prefers-reduced-motion: no-preference)` to be safe.
- Hover / active: row background goes to `var(--color-bg-muted)` (matches existing). Tap feedback is a 100ms fade.

### Empty state

Keep the existing `.inventory-empty` block; it already uses Fraunces italic and the icon. One small tweak: use the `PackageOpen` lucide icon instead of `PackageX` (less negative — they haven't failed, they just haven't started). Add a small Fraunces italic line — `"start with your first product"` — already done via `inventory.empty_body`. No structural change needed beyond keeping the existing styles after we remove the padding doubling.

---

## Visual spec — AdjustStockModal

### Hero (`.adjust-modal__hero`)

Replaces the current single-title block. Three stacked lines, all left-aligned:

```
ADJUST STOCK                              <- mono uppercase tracked eyebrow, tertiary ink
Cold brew bottle                          <- Fraunces italic 28/500 title (the product name in italic, terracotta)
ON HAND  47                               <- mono eyebrow (tertiary) + Fraunces italic 36/500 number on same line
```

- Eyebrow: `var(--font-mono) 11px 600 / 0.20em`, uppercase, `color: var(--color-text-tertiary)`.
- Title: `var(--font-display)` italic, `font-weight: 500`, `font-size: 28px`, `color: var(--color-brand)` (terracotta — this is the focal point). Truncate two lines max.
- Current stock line:
  - `ON HAND` label: `var(--font-mono) 10px 600 / 0.16em`, uppercase, `color: var(--color-text-tertiary)`.
  - Number: `var(--font-display)` italic, `36px 500`, tabular-nums, `color: var(--color-text-primary)`. (Echoes the row's stock typography but bigger.)

### Delta entry (`.adjust-modal__delta`)

Replace the plain `<input type="number">` with a steppered control plus quick-pick chips:

```
DELTA *

[ −10 ] [ −5 ] [ −1 ]   [  −  ]  [ 5 ]  [  +  ]   [ +1 ] [ +5 ] [ +10 ]
```

Layout:

- A centered row with: stepper button (–) ▸ large mono input ▸ stepper button (+).
- Beneath: a flowing row of quick-pick chips: `−10 −5 −1 +1 +5 +10`. Tapping adds (or subtracts) that amount to the current delta value (does NOT replace it — so users can build "+12" as `+10 +1 +1`). Hold the chip for 350ms to replace instead (optional polish; defer if it complicates).
- Negative quick-picks are tinted `var(--color-oxblood)`; positive tinted `var(--color-moss)` to make sign legible at a glance. Both use `var(--font-mono) 12px 600 / 0.06em`, tabular-nums, padding `8px 10px`, `border-radius: var(--radius-full)`, 1px outline in the tint.
- Stepper button: 44×44 circular, mono `−` / `+` glyph, `border: 1px solid var(--color-hair)`, `background: var(--color-bg-surface)`. Tap target meets `--touch-target-min` (56px) by extending hit area via padding wrapper if needed.
- Delta input: large mono `var(--font-mono) 32px 500 / 0.02em`, tabular-nums, center-aligned, no border (only the steppers carry the chrome). Width matches a 4-character delta (`-9999`). Sign auto-rendered in `var(--color-brand)` when positive, `var(--color-oxblood)` when negative.

### Result preview (`.adjust-modal__preview`)

A single line under the delta, only renders once `delta !== 0`:

```
AFTER       47  →  52
```

- `AFTER` eyebrow: mono uppercase tracked tertiary.
- Numbers: Fraunces italic 22/500 tabular-nums.
- Arrow (`→`): Geist regular, `color: var(--color-ink-4)`, 18px.
- Resulting number colored:
  - `--color-error` if the new value is negative (the form is already blocked by validation, but show it red so the user understands why),
  - `--color-warning` if it crosses below `lowStockThreshold`,
  - `--color-brand` otherwise (a small celebratory accent — the operator just restocked).
- 1px hair rule above this line so it reads like a ledger footer line.

### Reason field

Keep the textarea but tighten the styling: label is `pm-field-label` (already good); counter is repositioned inside the textarea's bottom-right corner (absolute-positioned) so it stops occupying its own row. Counter uses mono 10/600 tabular-nums, tertiary ink, fading to warning at >450 chars (existing logic). 12px gap between this section and the next.

### "Stamp as expense" section (`.adjust-modal__expense`)

Replace the muted-card-with-checkbox-inside pattern with a printed-ledger pull-tab:

```
─────────────────────────────────────────  <- full-width hair rule
[ ] STAMP AS EXPENSE                       <- checkbox row, mono uppercase tracked label
─────────────────────────────────────────  <- hair rule

(only when checked, slides down)
  AMOUNT *           [ price input        ]
  CATEGORY           [ category picker    ]
```

- The checkbox row sits between two hairline rules — establishes that this is a separate concern, an opt-in ledger entry. No `--color-bg-muted` background.
- Label text: `var(--font-mono) 12px 600 / 0.14em`, uppercase, `color: var(--color-text-primary)`.
- Checkbox: 18×18, `accent-color: var(--color-brand)` (already correct).
- Sub-form when open: nested `pm-field` rows, no inner card chrome. The page padding already gives it the right margin; we just need vertical rhythm. Gap `var(--space-4)` between sub-fields, `var(--space-4)` between the checkbox row and the first sub-field.
- The PriceInput and ExpenseCategoryPicker keep their existing styling — they already match the design system.

### Footer

Keep the existing `modal-footer` with `Cancel` link + primary pill. Update the primary pill copy to be active-voice and specific: instead of just `Save`, render `Stamp adjustment` (mono uppercase tracked inside the pill — matches the "ledger stamp" metaphor). Falls back to `Save` translation key if we want to keep it as one string.

(If renaming the button feels out of scope, leave the copy alone; the styling change is the win.)

---

## Behavior changes (functional, beyond styles)

1. **Padding cleanup.** Remove `.inventory-view`'s padding; rely on `.products-page`. Verify no regression in the empty state (which currently relies on min-height).
2. **Status filter state.** New local `useState` in `InventoryView` for `'all' | 'low' | 'out'`. Filter the sorted list accordingly. No URL param; transient filter.
3. **Tally counts.** Compute `lowCount` and `outCount` from the products list (active + stock <= threshold for low; active + stock <= 0 for out). Pass to `<InventoryTally />` subcomponent (new file or inline) and to the filter pills for the count badges.
4. **Quick-pick delta chips.** New click handlers on `AdjustStockModal` that compute `parseInt(delta || '0', 10) + N` and call `setDelta(String(newValue))`. Steppers do the same with ±1.
5. **AFTER preview.** Derived value `currentStock + parsedDelta`, rendered only when `parsedDelta !== 0 && !isNaN`. Color computation matches the rules above.
6. **No new translation IDs unless we add labels not already in `en-US.json`.** New strings to add (one per locale, real translations per CLAUDE.md i18n rule 3):
   - `inventory.filter_all`, `inventory.filter_low`, `inventory.filter_out`
   - `inventory.tally_eyebrow` ("Inventory")
   - `inventory.tally_tracked` ("{n, plural, one {# tracked} other {# tracked}}")
   - `inventory.tally_low` ("{n} low")
   - `inventory.tally_out` ("{n} out")
   - `inventory.row_on_hand` ("On hand")
   - `inventory.row_stamp_low` ("Low")
   - `inventory.row_stamp_out` ("Out")
   - `adjust_stock_modal.eyebrow` ("Adjust stock")
   - `adjust_stock_modal.preview_after` ("After")
   - `adjust_stock_modal.quick_pick_aria` ("Add {delta} to delta")
   - `adjust_stock_modal.stamp_as_expense` ("Stamp as expense")  (replaces `checkbox_log_as_expense`)
   - After adding keys, regenerate `messageIds.d.ts` via `npm run i18n:types --workspace=apps/web`.

---

## Files touched

- `apps/web/src/components/inventory/InventoryView.tsx` — add filter state, tally header, filter pill row, pass filter to list.
- `apps/web/src/components/inventory/InventoryListItem.tsx` — restructure row markup; remove chevron; add eyebrow + Fraunces stock + stamp chip.
- `apps/web/src/components/inventory/AdjustStockModal.tsx` — new hero, delta stepper + quick-picks, AFTER preview, restructured expense section, footer copy.
- `apps/web/src/styles/inventory-tab.css` — rewrite. Drop `.inventory-view` padding. Add `.inventory-tally`, `.inventory-filter`, restructured `.inventory-row` (no card wrapper, hair rules between rows), new `.adjust-modal__*` classes for the modal pieces.
- `apps/web/src/i18n/en-US.json` + every other locale in `packages/shared/src/locales.ts` — new keys.
- `apps/web/src/i18n/messageIds.d.ts` — regenerated.

No backend changes. No schema changes. No new dependencies.

---

## Verification (CLAUDE.md "verification-before-completion")

1. `npm run lint` and `npm run build` clean.
2. Open `http://localhost:3000/<businessId>/products?tab=inventory` and verify:
   - No double padding at the top (the segment + filter + tally are flush to the page gutter).
   - Tally numbers match the products list reality (count active products, low = stock ≤ threshold, out = stock ≤ 0).
   - Filter pills update the list AND the tally subtitle.
   - Status chips render only on low/out rows; stock number color matches.
   - Tapping a row opens AdjustStockModal with the new hero.
   - Quick-pick chips accumulate (`+10` then `+1` = `+11`).
   - AFTER preview only shows when delta ≠ 0; colors match the rules.
   - Expense section toggles open with hairline rules above + below the checkbox.
   - Submit succeeds (no API contract changes); list updates optimistically.
3. Toggle dark mode — every surface should still resolve to a legible palette (all colors route through CSS variables that have `.dark` overrides).
4. Empty state still renders correctly (PackageOpen icon, no Inventory tab chrome visible — short-circuit before tally/filter/list).
5. CSP: no new origins introduced, no inline styles added.
6. **Screenshot the result and confirm in the browser before claiming done** (per CLAUDE.md frontend rule).

---

## Out of scope / explicitly not doing

- No barcode-to-adjust workflow. (Option B was rejected.)
- No bulk-adjust UI (multi-select, batch). Would expand surface significantly; revisit later.
- No history view inside the modal. Showing the last N adjustments would be valuable but is its own design pass.
- No threshold editing inline. Threshold lives on the product record; edit via the product edit modal. (Could add a "set low-stock threshold" link in the modal later.)
- No animations beyond what the design system already provides (modal slide, focus rings, hover transitions). The stamp chip's `-1.5deg` rotation is a static transform, not an animation.

---

## Addendum — decisions baked in (2026-05-21, after review)

The review surfaced real issues; this section overrides anything in the body that conflicts.

### Decisions

- **Q1 → A.** Reuse the existing Products-tab `.inventory-ledger` chrome. The Inventory sub-tab gets the same outer card (header row with eyebrow + counts, hairline-divided rows beneath). No second ledger vocabulary. The status filter pills sit *inside* the ledger header, on a second row below the count line.
- **Q2 → A.** Row stock numbers use **JetBrains Mono 19/600 tabular-nums** (not Fraunces italic). Italic serif numerals slant unevenly down a list; mono is the right ledger voice for receipt-style row data. **Fraunces italic** stays only on the *modal hero* number (where it stands alone and reads as display) and the Inventory tab's optional page title if any. Stamp chip stays — no rotation.
- **Q3 → A.** Quick-pick chips **replace** the delta (`+5` sets delta to `5`; tapping `-10` sets it to `-10`). The `−` / `+` steppers do `±1` accumulation. Two affordances, clearly different jobs.
- **Q4 → A.** Filter persists in `sessionStorage` under key `kasero.inventory.filter` (`'all' | 'low' | 'out'`). Survives navigation within the session; resets on new tab.
- **Q5 → A.** Rewrite `AdjustStockModal` to use a clean state-driven step stack (`'form' | 'success'`) inside `ModalShell rawContent`. Drop the 250ms `setTimeout` cleanup proxy — the on-open `useEffect` already resets state correctly; the timeout is dead code (and per CLAUDE.md modal rules, cleanup should not race the close animation).

### Review-driven changes

1. **Inventory ledger chrome reuse.** New `InventoryView` renders `.inventory-ledger` (same class set as the Products tab's ledger). Header row: `INVENTORY · 23 ON HAND · 4 LOW · 1 OUT` (mono uppercase tracked, counts in tabular-nums). Filter pill row directly below the count line. Rows beneath are restyled (see #3).
2. **Vocabulary unified across all four surfaces.** Use `ON HAND` everywhere a count appears (tally, row eyebrow, modal hero). `LOW` / `OUT` are state modifiers, not nouns. Drop `TRACKED` — replaced by `ON HAND` in the tally line.
3. **Row stock number → JetBrains Mono 19/600 tabular-nums.** Color shifts: `--color-warning` for low, `--color-error` (semantic, not raw oxblood) for out. Status chip: outline-only, mono uppercase tracked, **no rotation**.
4. **Quick-pick chip semantics changed to REPLACE.** New aria-label format: "Set adjustment to +5", "Set adjustment to -10". Stepper aria-labels: "Decrease adjustment by 1", "Increase adjustment by 1". All quick-pick chips meet `--touch-target-min: 56px` — extend hit area via `padding: 14px 12px` or a `::before` pseudo-element extender.
5. **AFTER preview color rules revised.**
   - Result < 0 → `--color-error`
   - Result below `lowStockThreshold` (and >= 0) → `--color-warning`
   - Result above threshold AND delta > 0 → `--color-success` (moss; restock confirmation)
   - Otherwise → `--color-text-primary` (ink). **Never `--color-brand`** — brand is the action color, not a passive state.
6. **Stamp chip on AFTER preview.** When the AFTER value crosses below threshold, render the same `LOW` / `OUT` stamp inline beside the resulting number. Vocabulary stays consistent.
7. **Filter persistence.** sessionStorage. Read on mount with a try/catch (in case storage is unavailable / quota); write on every change.
8. **Modal compound API + cleanup.** Migrate to a `'form' | 'success'` step-stack pattern (state in the modal). Drop the `setTimeout` cleanup. Reset form fields and step on `isOpen` true.
9. **i18n key rename — full sweep.** Rename `adjust_stock_modal.checkbox_log_as_expense` → `adjust_stock_modal.stamp_as_expense`. Delete the old key in every locale file. For CJK locales (ja, ko, zh), don't auto-translate "stamp" literally — use the existing "log as expense" semantic (e.g. ja: 「経費として記録する」 stays).
10. **Plural keys.** `inventory.tally_on_hand` uses real ICU plural differentiation in locales that have it (`one {1 on hand} other {# on hand}`); CJK locales use a single form (the ICU library handles single-form locales correctly when only `other` is provided).
11. **RTL.** All `right:` positioning in the row + chip uses `inset-inline-end:`. All horizontal padding/margins use logical properties (`padding-inline`, `margin-inline`) where present.
12. **A11y.**
    - Row `aria-label` includes state: `"{name}, {stock} on hand, low stock"` / `"…, out of stock"`.
    - Stepper buttons have explicit aria-labels with action verbs.
    - Quick-pick chips: `aria-label="Set adjustment to {signed}{n}"`.
    - AFTER preview: `aria-live="polite"` on the result number container so screen readers announce the new stock as the user adjusts.
    - Focus ring on rows: `outline-offset: -2px` to keep the terracotta ring inside the row bounds.
13. **Dark mode.** Stamp/chip/AFTER coloring all routes through semantic tokens (`--color-error`, `--color-warning`, `--color-success`). The raw `--color-oxblood` is not used for status — it's only used as a palette fallback inside `.dark` to redefine `--color-error`.

### NEW — Realtime plumbing (added per user request)

The modal must react cleanly when the product being adjusted changes or disappears on another device.

1. **Close-on-delete.** Inside `AdjustStockModal`, use `useDismissOnDelete('product', product?.id, onClose)` from `@/hooks/useDismissOnDelete`. If a remote device deletes the product while this modal is open, the modal closes immediately. (The list refetch is already wired in the products context's realtime handler — `apps/web/src/lib/realtime/handlers.ts:102`.)
2. **Resync-on-update.** Use `useResyncOnUpdate('product', product?.id, () => { ... })`. When a remote update lands (e.g. another device adjusted stock), pull the fresh product from the products context inside the callback. Display the fresh `stock` value in the hero's `ON HAND` line — and recompute the AFTER preview against the new base. **Do not** silently overwrite the user's in-progress delta; only the base changes. Show a small mono inline notice beneath the hero: `STOCK UPDATED ELSEWHERE` (tertiary ink, fades to transparent after 4s) so the user understands why the numbers shifted.
3. **Race during save.** If the user taps save and the server returns `STOCK_CONCURRENCY_CONFLICT` (already a real envelope in the codebase per `apps/web/src/components/tab-shell/views/ProductsView.tsx:466`), the existing `useApiMessage` translation flow surfaces it; the modal stays on the form step with the error banner. The optimistic-locked write in the inventory-adjustments context handles this on the server side.
4. **Self-echo suppression.** The realtime handlers already suppress events from the publishing device (see `apps/web/src/lib/realtime/handlers.ts:69-171`), so the modal doesn't get a spurious dismiss when the local user saves their own adjustment.
5. **No new transport code.** All Upstash/Redis publish work is already plumbed in `apps/api/` for `product.updated` and `product.deleted` — see `packages/shared/src/realtime/types.ts:45-57`. This task adds zero new event types.

### NEW — Success states

The modal becomes a two-step state-driven stack: `'form'` → `'success'`.

- **Optimistic.** On the user's tap, IMMEDIATELY push to `'success'` and trigger the Lottie animation. Fire the API in the background. If the API fails, the success step shows an error inline + a `Try again` link that pops back to `'form'`. If it succeeds, the user taps `Done` to dismiss; the modal closes and `onExitComplete` resets the step stack.
- **Success step layout** (matches the success-step idiom in the modal-system doc):
  - Lottie `/animations/success.json` 160×160 centered.
  - Fraunces italic 24/500 line: `Stock adjusted.`
  - Mono uppercase tracked summary line: `{productName} · {oldStock} → {newStock}` (tabular-nums, hairline rule above this line).
  - If `logAsExpense`: second mono line beneath, `+ EXPENSE LOGGED · ${formatted amount}`.
  - Footer: a single `Done` primary pill spanning full width.
- **Where else success states matter.** This work doesn't touch the Products tab modals, but the success-step pattern is documented in `.claude/docs/modal-system.md` so the form already understands the contract. AdjustStockModal is the only modal added in this PR; nothing else needs a new success state.

---

## Open questions for the human

1. **Stamp chip rotation.** Subtle hand-stamped tilt (`-1.5deg`) — keep or drop? Risk: if the user adds many rows with rotated stamps, the page can look noisy. My instinct: keep, but make sure the stamp container has enough horizontal margin so the rotated corners don't clip.
2. **Primary button copy.** Rename `Save` → `Stamp adjustment` (matches metaphor, slightly heavier verb) or keep `Save` (one less translation churn)? Default: leave as `Save`; rename can land later.
3. **Translation backfill.** Per CLAUDE.md i18n rule 3, every new key must land with a real translation in every registered locale. There are ~9 locales (`en-US`, `es`, `ja`, `fil`, `fr`, `it`, `ko`, `pt`, `vi`, `zh`, `de`). I will translate them myself using locale-appropriate vocabulary, not run `npm run i18n:translate`.
