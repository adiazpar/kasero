# P1-2: Account truncation fix

## Targets
1. **Bottom sheet user identity row** (`user-menu-content.tsx` / `.user-menu-header`)
2. **Account page Change email row** (`AccountPage.tsx` / `.account-list__email-note`)

## Changes

### Bottom sheet (`apps/web/src/styles/interactive.css`)
- `.user-menu-header`: change `align-items: center` -> `align-items: flex-start`. Keep avatar on the left.
- `.user-menu-info`: switch to `display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-1)`.
- `.user-menu-name`: `font-family: var(--font-display); font-size: var(--text-lg);` drop `white-space: nowrap / overflow / text-overflow` (allow natural wrap if extreme).
- `.user-menu-email`: `font-family: var(--font-mono); font-size: var(--text-xs); color: var(--color-text-tertiary); word-break: break-all;` drop ellipsis truncation.

No markup changes in `user-menu-content.tsx`.

### Account page Change email row
- In `apps/web/src/components/account/AccountPage.tsx`: move `{user.email}` from an `IonNote slot="end"` into a `<p>` beneath the `<h3>` inside the existing `IonLabel`. Remove the `IonNote` element.
- In `apps/web/src/styles/app.css`: replace `.account-list ion-note.account-list__email-note` block with `.account-list__email-value` styling: `font-family: var(--font-mono); font-size: var(--text-xs); color: var(--color-text-tertiary); margin-top: var(--space-1); word-break: break-all;`.

Row remains tappable (still on `IonItem button detail onClick`).

## Verification
- `npx tsc --noEmit` from `apps/web`.
