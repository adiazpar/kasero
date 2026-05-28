# Login Entry Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the `/` entry screen into a centered header floating above a bottom-anchored stack of three identical neutral-outline sign-in buttons (Google, Apple, Continue with email), where the email button opens a styled `ModalShell` modal carrying the existing OTP-send flow.

**Architecture:** Pure frontend change in `apps/web/`. `EntryPage` is restructured (inline email form + "or" divider removed); the Apple OAuth button is restyled from solid-black to the shared neutral-outline look; a new single-step `EmailLoginModal` (built on `ModalShell`) owns the email-OTP flow lifted verbatim from today's `EntryPage`. Layout is driven by two new CSS rules in `auth.css`.

**Tech Stack:** Vite + React + Ionic (`@ionic/react`), `react-intl` (11 locales), `ModalShell` compound modal, Vitest + Testing Library.

---

## File Structure

- `apps/web/src/i18n/messages/*.json` (11 files) — add 3 keys, remove 1 unused key.
- `apps/web/src/i18n/messageIds.d.ts` — regenerated (do not hand-edit).
- `apps/web/src/components/auth/OAuthButtons.tsx` — Apple button → `fill="outline"`, drop modifier class.
- `apps/web/src/components/auth/OAuthButtons.css` — remove `.oauth-button--apple` + `.oauth-divider`; zero `.oauth-buttons` bottom margin.
- `apps/web/src/components/auth/EmailLoginModal.tsx` — **new** single-step email modal.
- `apps/web/src/components/auth/EmailLoginModal.test.tsx` — **new** behavior test.
- `apps/web/src/components/auth/index.ts` — export `EmailLoginModal` (verify barrel exists).
- `apps/web/src/routes/EntryPage.tsx` — restructure to centered header + `.entry-actions` stack + modal.
- `apps/web/src/styles/auth.css` — add `.auth-hero--entry` and `.entry-actions`.

---

## Task 1: i18n keys across all 11 locales

**Files:**
- Modify: `apps/web/src/i18n/messages/{en-US,es,ja,pt,de,vi,it,fr,zh,fil,ko}.json`
- Regenerate: `apps/web/src/i18n/messageIds.d.ts`

The CLAUDE.md i18n rule requires real translations in every registered locale — no English placeholders. There are **11** locale files. `oauth_or_divider` is used only by `EntryPage` (which stops rendering the divider in Task 4), so it becomes dead and must be removed everywhere.

- [ ] **Step 1: Add the three new keys to every locale file**

In each file, add `"oauth_email_continue"` next to the existing `"oauth_apple_continue"` line, and add `"auth.email_modal_title"` + `"auth.email_modal_subtitle"` next to the existing `"auth.welcome_back_subtitle"` line. Use these exact values per locale:

| Locale | `oauth_email_continue` | `auth.email_modal_title` | `auth.email_modal_subtitle` |
|---|---|---|---|
| en-US | Continue with email | Continue with email | We'll email you a 6-digit code to sign in. |
| es | Continuar con correo | Continuar con correo | Te enviaremos un código de 6 dígitos para iniciar sesión. |
| ja | メールで続行 | メールで続行 | サインイン用の6桁のコードをメールでお送りします。 |
| pt | Continuar com e-mail | Continuar com e-mail | Enviaremos um código de 6 dígitos por e-mail para você entrar. |
| de | Mit E-Mail fortfahren | Mit E-Mail fortfahren | Wir senden dir einen 6-stelligen Code zum Anmelden per E-Mail. |
| vi | Tiếp tục bằng email | Tiếp tục bằng email | Chúng tôi sẽ gửi mã gồm 6 chữ số qua email để bạn đăng nhập. |
| it | Continua con l'email | Continua con l'email | Ti invieremo via email un codice di 6 cifre per accedere. |
| fr | Continuer avec l'e-mail | Continuer avec l'e-mail | Nous vous enverrons un code à 6 chiffres par e-mail pour vous connecter. |
| zh | 使用邮箱继续 | 使用邮箱继续 | 我们会通过邮件向你发送一个 6 位验证码用于登录。 |
| fil | Magpatuloy gamit ang email | Magpatuloy gamit ang email | Padadalhan ka namin ng 6-digit na code sa email para mag-sign in. |
| ko | 이메일로 계속하기 | 이메일로 계속하기 | 로그인을 위한 6자리 코드를 이메일로 보내드립니다. |

Keep each file as valid JSON (mind trailing commas — insert the new lines with commas, not at the end of the object unless following the file's existing trailing-comma convention; these files do not use trailing commas, so place the new keys before a following key).

- [ ] **Step 2: Remove the dead `oauth_or_divider` key from every locale file**

Delete the `"oauth_or_divider": "..."` line from all 11 files.

- [ ] **Step 3: Regenerate the message-id union type**

Run: `npm run i18n:types --workspace=apps/web`
Expected: `apps/web/src/i18n/messageIds.d.ts` updates — `oauth_email_continue`, `auth.email_modal_title`, `auth.email_modal_subtitle` appear; `oauth_or_divider` is gone. No errors.

- [ ] **Step 4: Verify JSON validity**

Run: `cd apps/web && node -e "['en-US','es','ja','pt','de','vi','it','fr','zh','fil','ko'].forEach(l=>{const m=require('./src/i18n/messages/'+l+'.json'); if(!m.oauth_email_continue||!m['auth.email_modal_title']||!m['auth.email_modal_subtitle']||m.oauth_or_divider) throw new Error('bad '+l)}); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "i18n(auth): add email-continue + email-modal keys, drop or-divider"
```

---

## Task 2: Restyle the Apple OAuth button to neutral outline

**Files:**
- Modify: `apps/web/src/components/auth/OAuthButtons.tsx:76-91`
- Modify: `apps/web/src/components/auth/OAuthButtons.css`

- [ ] **Step 1: Change the Apple button to outline and drop the modifier class**

In `OAuthButtons.tsx`, the Apple `IonButton` currently reads `fill="solid"` with `className="oauth-button oauth-button--apple"`. Change it to match Google:

```tsx
      <IonButton
        expand="block"
        fill="outline"
        onClick={() => startSocial('apple')}
        disabled={disabled || pending !== null}
        className="oauth-button"
      >
```

(Leave the Google button and all `startSocial` logic untouched.)

- [ ] **Step 2: Remove the Apple override and divider rules; zero the stack's bottom margin**

In `OAuthButtons.css`:
- Delete the entire `.oauth-button--apple { ... }` block **and its preceding Apple-HIG comment block** (the `/* Apple HIG: ... */` comment).
- Delete the `.oauth-divider`, `.oauth-divider::before`, `.oauth-divider::after` blocks **and the `/* Divider used between ... */` comment** (no longer rendered after Task 4).
- In `.oauth-buttons`, change `margin-bottom: var(--space-4);` to `margin-bottom: 0;` so the OAuth pair and the email button below it form one evenly-spaced stack inside `.entry-actions`.

- [ ] **Step 3: Verify lint passes**

Run: `npm run lint --workspace=apps/web`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "style(auth): neutral-outline Apple button, drop or-divider styles"
```

---

## Task 3: Create the EmailLoginModal

**Files:**
- Create: `apps/web/src/components/auth/EmailLoginModal.tsx`
- Create: `apps/web/src/components/auth/EmailLoginModal.test.tsx`
- Modify: `apps/web/src/components/auth/index.ts` (add the export)

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/auth/EmailLoginModal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { IonApp } from '@ionic/react'
import type { ReactNode } from 'react'
import enUS from '../../i18n/messages/en-US.json'

const push = vi.fn()
vi.mock('@/lib/next-navigation-shim', () => ({
  useRouter: () => ({ push }),
}))

const sendOtp = vi.fn()
vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ sendOtp }),
}))

import { EmailLoginModal } from './EmailLoginModal'

const wrap = (node: ReactNode) => (
  <IntlProvider locale="en" messages={enUS as Record<string, string>}>
    <IonApp>{node}</IonApp>
  </IntlProvider>
)

describe('EmailLoginModal', () => {
  beforeEach(() => {
    push.mockReset()
    sendOtp.mockReset()
    sendOtp.mockResolvedValue({ success: true })
  })
  afterEach(() => vi.restoreAllMocks())

  it('sends the OTP and routes to the verify step on valid submit', async () => {
    render(wrap(<EmailLoginModal isOpen={true} onClose={() => {}} />))
    fireEvent.change(screen.getByTestId('email-modal-input'), {
      target: { value: 'user@example.com' },
    })
    fireEvent.click(screen.getByTestId('email-modal-submit'))
    await waitFor(() => expect(sendOtp).toHaveBeenCalledWith('user@example.com'))
    expect(push).toHaveBeenCalledWith('/auth?email=user%40example.com&step=verify')
  })

  it('shows an inline error and does not navigate when the send fails', async () => {
    sendOtp.mockResolvedValue({ success: false, error: 'Nope' })
    render(wrap(<EmailLoginModal isOpen={true} onClose={() => {}} />))
    fireEvent.change(screen.getByTestId('email-modal-input'), {
      target: { value: 'user@example.com' },
    })
    fireEvent.click(screen.getByTestId('email-modal-submit'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Nope'))
    expect(push).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test --workspace=apps/web -- --run EmailLoginModal`
Expected: FAIL — `Failed to resolve import "./EmailLoginModal"` (module does not exist yet).

- [ ] **Step 3: Implement the modal**

Create `apps/web/src/components/auth/EmailLoginModal.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import { IonButton, IonSpinner } from '@ionic/react'
import { ModalShell } from '@/components/ui/modal-shell'
import { AuthField } from '@/components/auth'
import { useRouter } from '@/lib/next-navigation-shim'
import { useAuth } from '@/contexts/auth-context'

// Shared with EntryPage / the auth-wizard EmailStep — keep acceptance
// semantics identical. better-auth re-validates on the server.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface Props {
  isOpen: boolean
  onClose: () => void
}

/**
 * Single-step email entry modal launched from EntryPage's "Continue with
 * email" option. Sends a 6-digit OTP via better-auth's email-otp plugin in
 * sign-in mode (idempotent; creates the user on first verify) and forwards
 * into the /auth wizard's verify step. New-vs-returning branching is the
 * wizard's job; this modal only owns the email send.
 */
export function EmailLoginModal({ isOpen, onClose }: Props) {
  const intl = useIntl()
  const router = useRouter()
  const { sendOtp } = useAuth()

  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Reset to a clean form on each closed->open transition (the same modal
  // instance is reused across opens).
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setEmail('')
      setError(null)
      setIsLoading(false)
    }
    wasOpenRef.current = isOpen
  }, [isOpen])

  const trimmed = email.trim()
  const valid = EMAIL_RE.test(trimmed)
  const canSubmit = valid && !isLoading

  const handleEmailChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (error) setError(null)
      setEmail(e.target.value)
    },
    [error],
  )

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!canSubmit) return
      setError(null)
      setIsLoading(true)
      const result = await sendOtp(trimmed)
      if (!result.success) {
        setError(result.error ?? intl.formatMessage({ id: 'auth.connection_error' }))
        setIsLoading(false)
        return
      }
      // Hand off to the auth wizard at the verify step. WizardNavContext
      // reads ?email=&step=verify to resume there.
      router.push(`/auth?email=${encodeURIComponent(trimmed)}&step=verify`)
      onClose()
    },
    [canSubmit, intl, onClose, router, sendOtp, trimmed],
  )

  const footer = (
    <IonButton
      expand="block"
      onClick={handleSubmit}
      disabled={!canSubmit}
      className="flex-1"
      data-testid="email-modal-submit"
    >
      {isLoading ? (
        <IonSpinner name="crescent" />
      ) : (
        intl.formatMessage({ id: 'auth.register_wizard.continue' })
      )}
    </IonButton>
  )

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={intl.formatMessage({ id: 'auth.email_modal_title' })}
      footer={footer}
      noSwipeDismiss
    >
      <header className="modal-hero">
        <p className="modal-hero__subtitle">
          {intl.formatMessage({ id: 'auth.email_modal_subtitle' })}
        </p>
      </header>

      <form onSubmit={handleSubmit} data-testid="email-modal-form">
        <AuthField
          label={intl.formatMessage({ id: 'auth.email_label' })}
          type="email"
          value={email}
          onChange={handleEmailChange}
          autoComplete="email"
          inputMode="email"
          autoFocus
          required
          data-testid="email-modal-input"
          below={
            error ? (
              <div className="auth-error" role="alert">
                {error}
              </div>
            ) : null
          }
        />
      </form>
    </ModalShell>
  )
}
```

- [ ] **Step 4: Add the barrel export**

In `apps/web/src/components/auth/index.ts`, add (next to the other exports):

```ts
export { EmailLoginModal } from './EmailLoginModal'
```

If `index.ts` does not exist, skip this step and have Task 4 import directly from `@/components/auth/EmailLoginModal`. (Verify with: `cat apps/web/src/components/auth/index.ts`.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test --workspace=apps/web -- --run EmailLoginModal`
Expected: PASS — both tests green.

- [ ] **Step 6: Verify lint + types**

Run: `npm run lint --workspace=apps/web`
Expected: no errors. (TypeScript message-id typing requires Task 1's regenerated `messageIds.d.ts` to be in place — it is.)

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat(auth): EmailLoginModal for the entry screen's email option"
```

---

## Task 4: Restructure EntryPage + layout CSS

**Files:**
- Modify: `apps/web/src/routes/EntryPage.tsx` (full rewrite of the body)
- Modify: `apps/web/src/styles/auth.css` (add two rules)

- [ ] **Step 1: Add the layout CSS**

In `apps/web/src/styles/auth.css`, after the `.auth-container--center .auth-main { ... }` rule (around line 34-36), add:

```css
/* ===== Entry screen (/) — centered header above a bottom-pinned actions
   stack. The hero grows to fill the region above the buttons and centers
   its title/subtitle on both axes; the actions stack sits at the bottom of
   .auth-main, directly above the version footer. ===== */
.auth-hero--entry {
  flex: 1;
  justify-content: center;
  align-items: center;
  text-align: center;
}

/* The subtitle has a max-width; center its block within the centered hero. */
.auth-hero--entry .auth-hero__subtitle {
  margin-left: auto;
  margin-right: auto;
}

.entry-actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  flex-shrink: 0;
  width: 100%;
}
```

- [ ] **Step 2: Rewrite EntryPage**

Replace the entire contents of `apps/web/src/routes/EntryPage.tsx` with:

```tsx
import { useIntl } from 'react-intl'
import { useMemo, useState } from 'react'
import { IonPage, IonContent, IonButton, IonIcon } from '@ionic/react'
import { mailOutline } from 'ionicons/icons'
import { OAuthButtons } from '@/components/auth/OAuthButtons'
import { AuthLayout } from '@/components/auth'
import { EmailLoginModal } from '@/components/auth/EmailLoginModal'
import { APP_VERSION } from '@/lib/version'

/**
 * Unified passwordless entry. A centered header floats above a
 * bottom-anchored stack of three identical sign-in options:
 *  - Continue with Google / Apple (OAuthButtons; full-page redirect)
 *  - Continue with email — opens EmailLoginModal, which sends an OTP and
 *    forwards into the /auth wizard's verify step.
 *
 * Mounted at `/` by HubPage's unauthenticated branch.
 */
export function EntryPage() {
  const intl = useIntl()
  const [emailOpen, setEmailOpen] = useState(false)

  // Italic accent on the brand word, mirroring Hub's HubGreeting pattern.
  // "Kasero" is a proper noun rendered verbatim across locales, so the
  // emphasis term is a fixed string. Falls through to plain text if the
  // localized title happens not to contain the brand.
  const titleNode = useMemo(() => {
    const full = intl.formatMessage({ id: 'auth.heading_login' })
    const emphasis = 'Kasero'
    const idx = full.indexOf(emphasis)
    if (idx === -1) return full
    return (
      <>
        {full.slice(0, idx)}
        <em>{emphasis}</em>
        {full.slice(idx + emphasis.length)}
      </>
    )
  }, [intl])

  const footer = (
    <p className="auth-version">
      {intl.formatMessage({ id: 'auth.version_label' }, { version: APP_VERSION })}
    </p>
  )

  return (
    <IonPage>
      <IonContent>
        <AuthLayout footer={footer} center>
          <header className="auth-hero auth-hero--entry">
            <h1 className="auth-hero__title">{titleNode}</h1>
            <p className="auth-hero__subtitle">
              {intl.formatMessage({ id: 'auth.welcome_back_subtitle' })}
            </p>
          </header>

          <div className="entry-actions">
            <OAuthButtons callbackURL="/" disabled={emailOpen} />
            <IonButton
              expand="block"
              fill="outline"
              className="oauth-button"
              onClick={() => setEmailOpen(true)}
              data-testid="entry-email-open"
            >
              <IonIcon slot="start" icon={mailOutline} aria-hidden="true" />
              {intl.formatMessage({ id: 'oauth_email_continue' })}
            </IonButton>
          </div>
        </AuthLayout>

        <EmailLoginModal isOpen={emailOpen} onClose={() => setEmailOpen(false)} />
      </IonContent>
    </IonPage>
  )
}
```

Note: `OAuthButtons` renders its own `.oauth-buttons` flex container (gap `--space-2`); placing it and the email button inside `.entry-actions` (also gap `--space-2`, and `.oauth-buttons` bottom-margin now 0 from Task 2) yields one evenly-spaced stack of three.

- [ ] **Step 3: Verify lint + types**

Run: `npm run lint --workspace=apps/web`
Expected: no errors. (No remaining references to `AuthField`, `useAuth`, `useRouter`, `IonSpinner`, `EMAIL_RE`, or `oauth_or_divider` in this file.)

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat(auth): redesign entry screen — centered header, bottom-pinned button stack"
```

---

## Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the web build**

Run: `npm run build --workspace=apps/web`
Expected: `tsc -b` clean, Vite build succeeds. (This is the authoritative check that all message-id usages resolve against the regenerated `messageIds.d.ts` and no stale imports remain.)

- [ ] **Step 2: Run the full web test suite**

Run: `npm run test:run --workspace=apps/web`
Expected: all tests pass (including the new `EmailLoginModal` tests; `EntryPage` has no test).

- [ ] **Step 3: Lint the whole workspace**

Run: `npm run lint`
Expected: no errors in any workspace.

- [ ] **Step 4: Manual walkthrough (dev)**

Run `npm run dev`, open `http://localhost:3000/` logged out, and confirm:
- Header (title + subtitle) is horizontally centered and vertically centered in the gap between the top of the screen and the top of the button stack.
- Three identical neutral-outline buttons (Google, Apple, Continue with email) are stacked with equal spacing, pinned just above the version label. Apple is no longer black.
- No "or" divider, no inline email field on the page.
- Tapping **Continue with email** opens the modal (app-styled `ModalShell`): subtitle + email field + Continue button. Entering a valid email + Continue routes to `/auth` at the verify step. An invalid/empty email keeps Continue disabled; a send failure shows an inline error and stays on the modal.
- Google and Apple still initiate their OAuth redirects.
- DevTools → Console is CSP-clean on `/` (no new violations — no new origins were introduced).

- [ ] **Step 5: Update the modal-system doc note (optional, only if you noticed the staleness)**

The `Modal`/`useModal` compound API referenced at the top of `.claude/docs/modal-system.md` does not match the shipped `ModalShell`. This is pre-existing and out of scope; do **not** fix it here.

---

## Self-Review notes (for the executor)

- **Spec coverage:** all-same-color buttons → Task 2; Continue-with-email option + modal → Tasks 3 & 4; bottom-aligned stack above version, no divider → Tasks 2 & 4; centered header → Task 4; app-styled modal → Task 3 (`ModalShell` + `modal-hero` + `auth-error`). i18n in all locales → Task 1.
- **Apple HIG:** Task 2's removal of the solid-black styling is the intentional, user-confirmed divergence documented in the spec.
- **Type consistency:** `sendOtp(email) => { success: boolean; error?: string }` is consumed identically in the modal and its test; `router.push` shape matches `next-navigation-shim`'s `useRouter`.
