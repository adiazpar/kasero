# Press-state audit v2 — neutral→brand flash

User complaint: "a lot of buttons that are white and flash terracotta when I press them, especially in the home page."

## Rule

Press/hover/focus must stay inside the resting color family. A neutral
(surface / cream / paper-warm / transparent) resting bg that flips to
`--color-brand` / `--color-brand-subtle` / `--color-brand-hover` /
`--color-brand-shade` on hover or active is a color-family jump — same
bug class as the v1 "white → black" flash, just in the opposite direction.

## Scope

Fix the **background** swap only. Border-color and color changing to
brand on press is allowed (text/border tint as emphasis). Selected /
aria-pressed / .is-active persistent states stay brand (those are
intentional selected states, not transient press feedback).

For neutral cream surfaces, replace `background: var(--color-brand-subtle)`
on `:hover` / `:active` with `background: var(--color-paper-deep)`
(slightly darker cream — a true tonal step).

## Fixes

### Home (priority — explicitly flagged)
- `home-tab.css` — add tonal `:active`/`:hover` to `.home-mini`,
  `.home-mini--cta`, `.home-mini--cta-open`, `.home-mini__stat-row`.
  These ship without any defined press state, so the browser falls
  back to whatever the default tap-highlight inherits (in an Ionic
  app where `--ion-color-primary = brand`, the highlight is brand
  rgba). Add explicit tonal press states + `-webkit-tap-highlight-color: transparent`.

### Cross-app neutral→brand-subtle swaps (bg only, on hover/active)

These all have resting bg in the neutral family
(`--color-bg-surface`, `--color-paper-warm`, `--color-bg-muted`, `transparent`)
and swap to `--color-brand-subtle` on `:hover` and/or `:active`.

| File | Selector | Resting bg | Action |
|---|---|---|---|
| `account-modals.css:353` | `.edit-profile__action:hover` | transparent (mono pill) | hover bg → `--color-paper-deep` |
| `products-modal-add-edit.css:236` | `.pm-choice:hover` | `--color-bg-surface` | hover bg → `--color-paper-deep` |
| `products-modal-add-edit.css:502` | `.pm-icon-rail__button:hover` | transparent | hover bg → `--color-paper-deep` |
| `products-modal-add-edit.css:889` | `.pm-ai-dropzone:hover` | `--color-paper-warm` | hover bg → `--color-paper-deep` |
| `products-modal-add-edit.css:1208` | `.pm-suggested__pick-row:hover` | `--color-bg-surface` | hover bg → `--color-paper-deep` |
| `products-modal-add-edit.css:1245` | `.pm-suggested__back:hover` | transparent | hover bg → `--color-paper-deep` |
| `products-modal-add-edit.css:1943` | `.pm-stock-stepper__button:hover` | transparent | hover bg → `--color-paper-deep` |
| `products-modal-add-edit.css:2000` | `.pm-review__hero-card:hover` | `--color-bg-surface` | hover bg → `--color-paper-deep` |
| `products-modal-settings.css:192` | `.settings-add-cta:hover` | transparent | hover bg → `--color-paper-deep` |
| `products-modal-settings.css:373` | `.settings-category-row__grip:hover` | transparent | hover bg → `--color-paper-deep` |
| `providers-modal.css:210` | `.pv-status:hover` | `--color-bg-surface` | hover bg → `--color-paper-deep` |
| `manage-modals.css:811` | `.transfer-ownership__switch:hover` | (mono pill, transparent) | hover bg → `--color-paper-deep` |
| `products-tab.css:140` | `.tools-button:hover` | `--color-bg-muted` | hover bg → `--color-paper-deep` |
| `products-tab.css:147` | `.tools-button:active` | `--color-bg-muted` | active bg → `--color-paper-deep` |
| `sales-modal-history.css:161` | `.session-history-load-more:hover` | `--color-bg-surface` | hover bg → `--color-paper-deep` |
| `sales-modal-history.css:229,235` | `.session-sales-row:hover/:active` | transparent | both bg → `--color-paper-deep` |
| `team-member-modal.css:300` | `.tm-member__action:hover` | `--color-bg-surface` | hover bg → `--color-paper-deep` |
| `team-member-modal.css:540` | `.tm-member__self-footer-link:hover` | transparent | hover bg → `--color-paper-deep` |
| `forms.css:155` | `.input-number-spinner:hover` | `--color-bg-muted` | hover bg → `--color-paper-deep` |
| `forms.css:161` | `.input-number-spinner:active` | `--color-bg-muted` | active bg → `--color-paper-deep` (was full brand!) |
| `forms.css:271` | `.image-upload-zone:hover` | `--color-bg-muted` | hover bg → `--color-paper-deep` |
| `team-invite-modal.css:90` | `.tm-invite__role-card:hover` | `--color-bg-surface` | hover bg → `--color-paper-deep` |
| `sales-modal-cart.css:462` | `.quick-bill:hover` | transparent | hover bg → `--color-paper-deep` |
| `products-modal-orders.css:1255` | `.order-overview__icon-action--edit:hover` | transparent | hover bg → `--color-paper-deep` |
| `products-modal-orders.css:1384` | `.order-modal__secondary-pill:hover` | transparent | hover bg → `--color-paper-deep` |
| `providers-detail.css:191` | `.pd-action-pill--ghost:hover` | transparent | hover bg → `--color-paper-deep` |
| `sales-tab.css:86` | `.sales-stats-link:hover` | transparent | hover bg → `--color-paper-deep` |
| `sales-tab.css:268` | `.pos-scan-button:hover` | `--color-bg-muted` | hover bg → `--color-paper-deep` |
| `sales-tab.css:273` | `.pos-scan-button:active` | `--color-bg-muted` | active bg → `--color-paper-deep` |
| `sales-tab.css:974` | `.recent-sessions-view-all:hover` | transparent | hover bg → `--color-paper-deep` |
| `hub-modals.css:337` | `.create-business__logo-upload:hover` | `--color-bg-surface` (already `--color-bg-muted` on hover plus brand glow) | replace brand-subtle box-shadow with hairline; keep bg-muted swap |
| `manage-modals.css:518` | `.edit-logo__upload:hover` | `--color-bg-surface` | same as above |

### Intentionally left

- `.theme-modal__swatch.is-active`, `.language-modal__card.is-active`,
  `.transfer-ownership__member.is-active`, `.product-tile__qty-button--plus.is-active`,
  `[aria-pressed='true']` variants, `.theme-option-active`,
  `.quick-bill--selected` — **persistent selected state**, brand fill is intentional.
- All `:focus-visible` outline-only rules using brand — accessibility focus ring.
- Input `:focus` / `:focus-within` (`.pv-field__input:focus`, `.app-search:focus-within`,
  `.input:focus`, `.auth-field:focus-within`, etc.) — input field focus rings,
  brand-subtle fill mirrors a focused input across the codebase. Not a button
  press.
- Brand-resting buttons whose press darkens to `brand-hover` / `brand-shade`
  (`.pos-empty__cta`, `.charge-pill`, `.tm-roster__invite-pill`,
  `.pd-action-pill`, `.order-overview__primary`, `.order-modal__primary-pill`)
  — already tonal-correct.
- Color/border-only swaps to brand on hover (text/border tint without bg fill):
  e.g. `.recent-sessions-view-all` actually swaps bg too → already in list.
- Anchor `a:hover` color change in base.css — text link tinting, not a button.

### Out of scope

- `.card-interactive:hover { border-color: brand }` — border-only hint, no bg
  flash.
- Skip the `--background-activated`/`--background-hover` on `.modal-footer
  ion-button` — that's a primary terracotta button darkening to brand-shade
  (correct tonal pattern; explicitly noted in the source comment).

## Verification

`npx tsc --noEmit` from `apps/web` after changes. No screenshot/Playwright.
