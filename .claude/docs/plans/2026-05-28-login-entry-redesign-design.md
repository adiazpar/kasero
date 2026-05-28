# Login / Entry Screen Redesign — Design

**Date:** 2026-05-28
**Scope:** `EntryPage` (`/`) layout + a new email-login modal. No backend changes.

## Goal

Reshape the unauthenticated entry screen into a clean, bottom-anchored list of three
identical sign-in options, with a centered header floating above them. The inline email
field and the "or" divider go away; email becomes a modal triggered by a button.

## Current state

`EntryPage.tsx` renders, inside a vertically-centered `AuthLayout`:

1. `.auth-hero` — title (*"Welcome to Kasero"*, italic brand accent) + subtitle
   (*"Choose how you'd like to continue."*), top-anchored.
2. An inline `<form>`: `AuthField` (email) + Continue `IonButton`.
3. `.oauth-divider` ("or").
4. `<OAuthButtons>` — Google (`fill="outline"`, paper-warm surface, border, dark text)
   and Apple (`fill="solid"`, hardcoded `#000` black per the Apple-HIG note in
   `OAuthButtons.css`).
5. Footer: version label.

## Target layout

```
┌─────────────────────────────┐
│        (safe-area top)        │
│                               │
│                               │
│         Welcome to            │   ← header: horizontally centered,
│           Kasero              │     vertically centered in the gap
│  Choose how you'd like to     │     between top of screen and the
│         continue.             │     top of the button stack
│                               │
│                               │
│  ┌─────────────────────────┐ │
│  │ G   Continue with Google│ │   ← three identical neutral-outline
│  └─────────────────────────┘ │     buttons, equal gaps, pinned to
│  ┌─────────────────────────┐ │     the bottom of the main region
│  │     Continue with Apple │ │
│  └─────────────────────────┘ │
│  ┌─────────────────────────┐ │
│  │ ✉   Continue with email │ │   ← opens the email modal
│  └─────────────────────────┘ │
│                               │
│      ─── kasero v1.2.3 ───    │   ← version footer, unchanged
└─────────────────────────────┘
```

## Decisions (confirmed)

- **Button style:** all three buttons use the existing neutral-outline `.oauth-button`
  look — paper-warm surface, hairline border, dark text. Brand logos carry identity.
- **Header:** keep both the italic-accent title and the subtitle, centered horizontally
  and vertically in the space above the button stack.
- **Apple HIG divergence:** restyling Apple's button away from solid black is an
  intentional, explicit divergence from the Sign-in-with-Apple HIG guidance noted in
  `OAuthButtons.css`. The hardcoded-color comment block is removed along with the
  override.

## Components & changes

### 1. `EntryPage.tsx` (restructured)

- Drop the inline email `<form>`, the email `AuthField`, the Continue submit button, and
  the `.oauth-divider`. Remove the now-unused `sendOtp`/`EMAIL_RE`/email-state/submit
  logic — it moves into the modal.
- Keep the `titleNode` italic-accent memo and render it in a centered header.
- Render an `.entry-actions` stack containing `<OAuthButtons>` (Google + Apple) followed
  by a third **Continue with email** `IonButton` (`fill="outline"`, `.oauth-button`,
  `mailOutline` icon) whose `onClick` opens the modal.
- Own `const [emailOpen, setEmailOpen] = useState(false)` and render
  `<EmailLoginModal isOpen={emailOpen} onClose={() => setEmailOpen(false)} />`.
- Keep `<AuthLayout footer={version} center>` — `center` drops the 44px phantom-toolbar
  top inset, leaving only the safe-area inset, so the centered header reads against the
  true top of the screen.

Button order in the stack: Google, Apple, Continue with email (email last, as the
non-OAuth fallback).

### 2. `OAuthButtons.tsx`

- Apple button: change `fill="solid"` → `fill="outline"` and stop applying the
  `oauth-button--apple` class so it inherits the shared neutral-outline `.oauth-button`
  style. Google is unchanged. Component stays OAuth-only (no email button added here —
  the email button lives in `EntryPage` next to its modal state).

### 3. `OAuthButtons.css`

- Remove the `.oauth-button--apple` block (and its Apple-HIG comment).
- Remove the `.oauth-divider` rules (no longer rendered anywhere — verify no other
  consumer first; `EntryPage` is the only one).
- Set `.oauth-buttons { margin-bottom: 0 }` so the OAuth group and the email button form
  one continuous, evenly-spaced stack inside `.entry-actions` (both use
  `gap: var(--space-2)`).

### 4. `EmailLoginModal.tsx` (new, in `components/auth/`)

Single-step `ModalShell` modal, modeled on `EditNameModal`:

- `ModalShell` props: `isOpen`, `onClose`, `title` (`auth.email_modal_title`),
  `footer`, `noSwipeDismiss` (it contains an `IonInput`, per the modal-system gotcha).
- Body: a `.modal-hero` (subtitle only, e.g. *"We'll email you a 6-digit code."*) +
  `AuthField` (email, `autoFocus`, `inputMode="email"`, `autoComplete="email"`) with an
  inline `.auth-error` slot via `below`.
- Footer: `IonButton expand="block"` — Continue, swaps to `<IonSpinner name="crescent">`
  while sending.
- Behavior (lifted verbatim from today's `EntryPage`): validate with the shared
  `EMAIL_RE`; on submit call `useAuth().sendOtp(trimmed)`; on success
  `router.push('/auth?email=...&step=verify')` then `onClose()`; on failure show the
  returned error (or `auth.connection_error`) inline. Clear the error when the user edits.
- State reset on open via the `wasOpenRef` from-closed-to-open pattern (as in
  `EditNameModal`); clear email/error/loading.

### 5. `auth.css`

Add two rules (EntryPage layout):

- `.auth-hero--entry { flex: 1; justify-content: center; align-items: center; text-align: center; }`
  — fills the region above the buttons and centers the title/subtitle both axes. Also
  center the subtitle's auto margins (`margin-left/right: auto`) since it has a
  `max-width`.
- `.entry-actions { display: flex; flex-direction: column; gap: var(--space-2); flex-shrink: 0; width: 100%; }`
  — the bottom-pinned button stack.

The existing `.auth-main` (flex column, `flex: 1`) provides the flex context: the
`flex: 1` hero grows to fill, pushing `.entry-actions` to the bottom of the main region,
directly above the version footer.

### 6. i18n

New keys (added to `en-US.json` first, then real translations in `es.json` and
`ja.json` — no English placeholders):

| Key | en-US |
|---|---|
| `oauth_email_continue` | "Continue with email" |
| `auth.email_modal_title` | "Continue with email" |
| `auth.email_modal_subtitle` | "We'll email you a 6-digit code to sign in." |

Reused existing keys: `auth.email_label`, `auth.register_wizard.continue`,
`auth.email_invalid`, `auth.connection_error`.

Remove `oauth_or_divider` only if no other consumer remains after the divider is dropped
(grep first). Then regenerate `apps/web/src/i18n/messageIds.d.ts` via
`npm run i18n:types --workspace=apps/web`.

## Out of scope

- The `/auth` wizard (`EmailStep`/`VerifyStep`/`NameStep`) and `JoinPage` — untouched.
- OAuth round-trip mechanics (`sessionStorage` entry flag, `signIn.social`) — unchanged.
- No new network origins → no CSP changes.

## Testing / verification

- `npm run lint` and `npm run test` clean.
- Walk the `/` screen in dev: three identical outline buttons bottom-anchored above the
  version; header centered in the gap above them; tapping **Continue with email** opens a
  styled modal; entering an email + Continue routes into `/auth` verify; Google/Apple
  still initiate their redirects.
- Confirm DevTools → Console is CSP-clean on `/` (no new violations).
