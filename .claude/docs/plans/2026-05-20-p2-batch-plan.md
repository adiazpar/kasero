# P2 Polish Batch — 2026-05-20

Six XS-effort polish fixes from style-guide § P2.

## Plan

1. **Fix 1 — Add Product progress bar.** Add a tiny `<WizardProgress current total />` component, render it inside `.pm-shell` at the top of the 4 wizard-chain steps (NameStep, PriceStep, CategoryStockStep, BarcodeStep). Replace each step's `pm-hero__eyebrow` "Step X of 4" with a quiet mono `1 / 4` inline label. Add CSS for `.pm-wizard-progress` (2px track + brand fill) in products-modal-add-edit.css. Reuse existing i18n keys but reformat to `1 / 4` shorthand by leaving the eyebrow keys alone and rendering the slim label via a new shared component using `{current} / {total}` literal (not user-locale string — it's a number ratio).
2. **Fix 2 — OTP verify sticky Continue + 0:30 countdown.** VerifyStep already has cooldown logic; change the cooldown format to `m:ss`. Add an `IonButton` Continue button as primary action (terracotta) above the resend link. Update i18n key `verify_email_resend_cooldown` value to `Send a new code in {time}` and pass `time={mm:ss}` formatted string.
3. **Fix 3 — One card per group (Manage + Account).** Already implemented: both use `IonList inset` with hair dividers via `.account-list.list-inset`. Skip (note in report).
4. **Fix 4 — Open-session keypad: tonal active state.** Keys already pilled via `.price-keypad__key`. Switch the `:active` background from `var(--color-brand-subtle)` (terracotta wash) to `var(--color-paper-deep)` (tonal). Same for border-color — keep `--color-hair-soft` instead of `--color-brand`.
5. **Fix 5 — Cart Confirm shows mono total inline.** In ViewCartModal step-0 footer, change the `IonButton` label from `Confirm` to a span composition: `Confirm · {mono total}`. Add new i18n key `sales.cart.modal_confirm_with_total` taking `{total}` — but since we want mono styling on the total only, render as JSX children: `{label} · <span style="font-family:var(--font-mono)">{formatCurrency(cart.total)}</span>`. The "Confirm" text stays in existing key.
6. **Fix 6 — Hide PRODUCTS/ORDERS segmented tab when both empty.** In ProductsView, conditionally render the `.products-segment` div only when `products.length > 0 || orders.length > 0`. When hidden, also force `activeTab='products'` so the TabContainer keeps the products empty-state visible.

## i18n keys

- `verify_email_resend_cooldown` — UPDATE value (replace `{seconds}s` placeholder format with `{time}` mm:ss) in all 11 locales.
- No other new keys.

## TS typecheck cadence

After each fix: `cd apps/web && npx tsc --noEmit`.
