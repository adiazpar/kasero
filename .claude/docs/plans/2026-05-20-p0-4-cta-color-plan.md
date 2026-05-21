# P0-4 — Sticky CTA color audit (terracotta alignment)

## Problem

Primary sticky-bottom CTAs render as black (`var(--color-ink)`) instead of brand terracotta (`var(--color-brand)`) in:

- Cart Confirm (step 0 of `ViewCartModal`)
- Open Session "Done" (`OpenSessionModal`)
- Close Session "Next" (`CloseSessionConfirmModal`)
- Add Product Review "Add to catalog" / Success "Done" (`ReviewStep`)
- Edit Product "Save changes" (`ReviewStep`)
- All Order / Provider / Team modal primary actions (shared `.order-modal__primary-pill`)

Black is reserved for global header back affordances and secondary actions. Primary terminal CTAs must be terracotta.

## Root causes (two locations)

1. **Shared "primary pill" class** — `apps/web/src/styles/products-modal-orders.css:1322` (`.order-modal__primary-pill`) hard-codes `background: var(--color-ink)` with `:hover` / `:active` flashing to `var(--color-ink-2)`. Used by 31 callsites across `order-steps/`, `providers/`, `team/InviteModal`, etc.
2. **Modal-footer IonButton press states** — `apps/web/src/styles/app.css:500-502` flashes `--background-activated/hover/focused` to `var(--color-ink-2)`. The resting `--background` is inherited from `--ion-color-primary` (already terracotta), but the press-state flash to ink reinforces the ink-palette mood. Switch press states to `var(--color-brand-shade)` to stay in the brand palette.

## Fix

- `products-modal-orders.css:1331,1348,1353` — swap `--color-ink` → `--color-brand`, `--color-ink-2` → `--color-brand-shade`. Keep everything else.
- `app.css:500-502` — swap `--color-ink-2` → `--color-brand-shade`. Update the inline comment accordingly.

## Out of scope (leave alone)

- Hub "Create a business" / "Join a business" hero cards (intentional treatment).
- Close Session "Close session" outline button (`color="danger"`, intentional oxblood).
- Header back chevrons (legitimate ink).
- `.charge-pill` (already terracotta).
- Secondary buttons (`.order-modal__secondary-pill`, `.pm-ghost-btn`).

## Verification

Dev server (vite :3000) is not currently running. Verify via code grep that the two CSS edits cover every offender enumerated above. Take a manual screenshot pass after merge if a reviewer wants visual confirmation.
