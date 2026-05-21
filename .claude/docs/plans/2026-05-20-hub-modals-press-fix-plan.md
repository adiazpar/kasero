# Hub modals — press-state audit (2026-05-20)

Third pass on the tonal-press-state rule for the Hub page surface area:
HubHome (`compose row`, `app-search`), the `IonActionSheet` it opens, the
Create Business modal (all four steps + their buttons), and the Join
Business modal (code / preview / success steps and their CTAs).

## Tonal-press rule (recap)

Press / hover / focus / activated bg must stay in the same hue family as
the resting bg. Cream + terracotta on press = wrong. Cream resting →
press uses `--color-paper-deep` (warmer) or `--color-bg-muted` (cooler
neutral). Brand resting → press uses `--color-brand-shade`.

Mobile gotcha: when a clickable element ships **no** `:active` rule,
iOS/Ionic falls back to a default `-webkit-tap-highlight-color` (often a
translucent ink/brand wash). Every cream surface that takes a tap needs
either an explicit tonal `:active` or `-webkit-tap-highlight-color:
transparent`.

## Findings (grep + read)

### app.css

| Selector | State | Resting | Current press | Decision |
|---|---|---|---|---|
| `.feature-card` (L98) | `:hover` border, `:active` transform | surface | border darkens; no bg flash | OK |
| `.business-row` (L186) | same pattern | surface | OK |
| `.app-search` (L334) | `:focus-within` bg-surface + brand border + brand-subtle ring | bg-muted | brand-subtle ring is a focus state, acceptable | OK |
| `.app-search__clear` (L378) | `:hover` color only, no `:active` | transparent | iOS tap-highlight bleed risk | **FIX**: add `-webkit-tap-highlight-color: transparent`; tonal `:active` color |
| `.hub-compose-row` (L480) | `:hover` border+color, `:active` transform | transparent | iOS tap-highlight bleed risk | **FIX**: add `-webkit-tap-highlight-color: transparent`; tonal `:active` bg + keep transform |

### hub-modals.css

| Selector | Resting | Current state | Decision |
|---|---|---|---|
| `.create-business__logo-upload` (L317) | surface | `:hover` border-brand + bg paper-deep (tonal ✓); no `:active` | **FIX**: add tonal `:active` bg paper-deep + tap-highlight transparent |
| `.create-business__logo-remove` (L284) | surface | `:hover` color/border error (destructive ✓); no `:active` | **FIX**: add tonal `:active` bg paper-deep + tap-highlight transparent (don't change the destructive hover) |
| `.create-business__success-action` (L461) | wrapper for IonButton | nothing tappable on itself | OK |
| `.join-business__code-frame` (L505) | surface | `:focus-within` brand border + brand-subtle ring | OK (focus is acceptable) |
| `.join-business__code-error-action` (L607) | transparent text button (error palette) | no `:hover`/`:active` | **FIX**: tap-highlight transparent; `:active` darken color |
| `.join-business__preview-card` (L633) | paper-deep | not clickable | OK |

### ionic-theme.css + IonActionSheet

`IonActionSheet` rendered by HubHome (lines 180-198) has **zero**
project-level styling. Ionic's iOS theme paints destructive/normal
button activated states with a default ink wash that can read as
brand-tinted in some modes. Cancel button takes its own surface.

**FIX**: add an `ion-action-sheet` rule block in `ionic-theme.css` that
sets tonal activated/hover/focus bgs using `--color-paper-deep` and a
transparent ripple. Cancel button gets the same tonal handling.

### Create / Join modal IonButton CTAs

All footer IonButtons hit `.modal-footer ion-button` in app.css
(L534-549) which already sets `--background-activated/hover/focused` to
`--color-brand-shade` — tonal ✓.

`fill="outline"` Decline button on the transfer preview footer renders
with bg transparent / brand border. The default `--background-activated`
for `fill="outline"` Ionic buttons resolves to a brand-tinted wash on
press. The `.modal-footer ion-button` rule covers it too — but worth
double-checking.

Toolbar close X (`<IonButton fill="clear">` in each wizard step + ModalShell):
the global rule `ion-button:not([fill="clear"])` excludes these; Ionic's
default clear-button hover/activated for iOS is a translucent
`--background-activated: var(--ion-color-primary-tint)` style — brand
family on transparent. That **is** a violation per the tonal rule
(transparent resting → brand-tinted press).

**FIX**: add a global `ion-button[fill="clear"]` rule that sets
`--background-activated` / `--background-hover` / `--background-focused`
to a tonal `var(--color-bg-muted)` (cool neutral on transparent).
Scoping to header/footer toolbars to avoid touching other clear-fill
use sites elsewhere.

## Files to change

- `apps/web/src/styles/hub-modals.css` — add `:active` blocks to
  logo-upload, logo-remove, code-error-action; add
  `-webkit-tap-highlight-color: transparent` where missing.
- `apps/web/src/styles/app.css` — add `:active` block + tap-highlight
  transparent on `.app-search__clear` and `.hub-compose-row`.
- `apps/web/src/styles/ionic-theme.css` — add `ion-action-sheet` tonal
  press-state block; add `ion-button[fill="clear"]` tonal press-state
  block.

## Verify

`npx tsc --noEmit` from `apps/web`.
