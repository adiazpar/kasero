# P0-3 — Stock-state tokens (kill red 0 UNITS)

## Problem
`ProductsTab.tsx` renders a single `product-row__stock` chip per product, error-tinted (oxblood) whenever `stockValue <= lowStockThreshold`. For a brand-new product with `stock=0`, this surfaces a loud red "0 UNITS" pill 3 seconds after creation — teaches users "creation = error."

## Decision: 3-state simplification

Product type in `packages/shared/src/types/index.ts` has no `salesCount` / `lastSoldAt` / `timesSold` (`salesCount` exists only on `sales_sessions`). Adding a new field/endpoint is out of scope. We therefore ship the 3-state model:

| State | Trigger | Label | Color |
|---|---|---|---|
| UNTRACKED | `stock == null` | `UNTRACKED` | `--color-text-tertiary` mono |
| IN STOCK | `stock > 0` | `IN STOCK · {n}` | `--color-success` (moss) |
| READY · SET STOCK | `stock === 0` | `READY · SET STOCK` | `--color-text-tertiary` mono |

The `LOW STOCK` warning treatment (saffron when `stock <= threshold && stock > 0`) is preserved as a sub-state of IN STOCK so the existing low-stock signal isn't lost — but in saffron (`--color-warning`), not oxblood. This kills the only red treatment.

Tap-to-adjust is automatic: the existing row tap already opens the edit modal.

## Files

- `apps/web/src/components/products/ProductsTab.tsx` — replace the single `products.units_count` render with branch on stock state; emit a `data-state` attribute for CSS.
- `apps/web/src/styles/products-tab.css` — add `.product-row__stock[data-state="untracked|ready|in-stock|low"]` variants; remove the red `--low` (oxblood) treatment.
- `apps/web/src/i18n/messages/en-US.json` — add `products.stock_untracked`, `products.stock_ready`, `products.stock_in_stock`, `products.stock_low`.
- All other locales in `apps/web/src/i18n/messages/` — real translations (es, ja, de, fil, fr, it, ko, pt, vi, zh).
- Regenerate `apps/web/src/i18n/messageIds.d.ts` via `npm run i18n:types --workspace=apps/web`.

## Out of scope

- `ProductPicker.tsx` (POS) — already has its own `sold_out_stamp` overlay treatment that is sale-flow correct. Leaving untouched.
- Adding a `hasSold` boolean to the product API — explicitly deferred.

## Verify

- Screenshot `04-stock-in-stock.png` for Coffee (`stock=10`) → IN STOCK · 10 (moss).
- Set Coffee stock to 0, screenshot `04-stock-zero.png` → READY · SET STOCK (tertiary), no red.
