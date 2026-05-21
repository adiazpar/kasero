# App-wide press-state audit (2026-05-20)

## Rule

Button `:active` / `:hover` / `:focus` / `--background-activated` / `--background-hover`
/ `--background-focused` MUST be tonal — a darker or lighter shade of the resting
color. Never flash to ink, black, or a contrasting hue family.

## Inventory after grep

### Ionic state-var overrides (all 7 occurrences inspected)

| File:line                                  | Resting                  | Press                          | Verdict |
|--------------------------------------------|--------------------------|--------------------------------|---------|
| `app.css:546-548` (`.modal-footer ion-button`) | brand                | brand-shade                    | OK (P0-4) |
| `app.css:786-787` (`.account-list ion-item`)   | transparent on surface | bg-muted                       | OK |
| `products-modal-add-edit.css:1796-1799`     | transparent             | paper-warm                     | OK |
| `team-roster.css:314-316`                   | transparent             | bg-muted                       | OK |
| `products-tab.css:340-342`                  | transparent             | transparent (suppressed)       | OK |
| `OAuthButtons.css:15`                       | surface (cream)         | bg-muted                       | OK |
| `OAuthButtons.css:37-38`                    | #000 (Apple HIG)        | #1a1a1a                        | OK (HIG mandate) |
| `providers-detail.css:647-648`              | transparent on card     | bg-muted                       | OK |

### Pseudo-class `:hover` / `:active` backgrounds (suspects)

Found ONE off-brand pattern:

- `sales-tab.css:481` `.product-tile__qty-button:hover` uses
  `rgba(0, 0, 0, 0.04)` — raw black wash. Sibling implementations of the
  same control elsewhere (`products-modal-orders.css:332`,
  `sales-modal-cart.css:261`) correctly use `var(--color-paper-deep)`.
- `sales-tab.css:487` `.dark` variant uses `rgba(255, 255, 255, 0.06)` —
  raw white wash. Sibling dark variants in orders/cart use the same raw
  wash. The consistent thing is to use the paper-deep token (which already
  resolves to a slightly lighter cream in light mode and a slightly
  lighter warm-charcoal in dark mode).

### P0-4 re-check

- `.modal-footer ion-button` and `.order-modal__primary-pill` press
  states use `--color-brand-shade`. Verified still correct.

## Fixes

1. `sales-tab.css:481` → `background-color: var(--color-paper-deep);`
2. `sales-tab.css:486-489` → drop the dark-only override (the token is
   already theme-aware and resolves to a lighter shade in dark mode via
   `.dark { --color-paper-deep: #281F18; }`).

For consistency, also unify the sibling dark-mode overrides in
`products-modal-orders.css:336-339` and `sales-modal-cart.css:265-268`
that still use `rgba(255,255,255,0.06)` — replace with the same single
theme-aware paper-deep token, deleting the `.dark` block.

## Intentionally leaving

- `pm-scanner__close:hover` uses `rgba(0,0,0,0.75)` — sits on a live
  camera feed, not paper; black-tinted backdrop is correct.
- Apple SIWA button hardcoded `#000 / #1a1a1a` — Apple HIG mandate.

## No new tokens required

`--color-paper-deep` already exists in both themes and is the
correct semantic destination for "subtle hover over a cream/dark
surface". No additions to `base.css`.
