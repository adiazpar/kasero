# Modal Header Normalization — Design

**Date:** 2026-05-28
**Scope:** Normalize how every modal in `apps/web` presents its header (title + close), via a documented rule, a small `ModalShell` API addition, and fixes to the non-conforming modals. Frontend-only.

## Problem

An audit of all 34 `ModalShell`-based modals found the header treatment is ungoverned:

- Most content modals/steps render a header with a short title + X (good).
- A few content steps render a header with **no title** (`AddExpenseCategoryModal`, the `CreateBusinessModal` steps) or a blank title (`JoinBusinessModal` passes `title=""`).
- Terminal **success/celebration** steps are split: the `rawContent` product modals (`AddSuccessStep`, `EditSuccessStep`, `DeleteSuccessStep`) are fully chromeless (Lottie + "Done", no header), while ~15 bucket-B modals keep a titled header + X on their success step.
- A structural gotcha makes the implicit behavior dangerous: in `ModalShell` the X close button is rendered **only when `title` is set**, so "no title" silently also means "no X". For a `noSwipeDismiss` modal that's a close-trap.

## Decisions (confirmed)

- **Philosophy A** — every **content/form step** presents a consistent header: a short title label + an X close (and a back chevron when a prior step exists). The large in-body hero headline (`.modal-hero__title`) remains an **independent, optional** editorial element — modals that have it (EditName, ChangeEmail, EmailLoginModal, …) keep it; list/utility sheets that don't (UserMenu, LanguageModal) are not forced to add one. This normalization governs **header title presence**, not the hero headline.
- **Success/celebration end-steps are chromeless** — no header (no title, no X); the big animation + a single "Done"/primary button is the whole screen, and that button is the close affordance. The 3 `rawContent` product success steps already do this and are the model; the ~15 bucket-B modals that currently keep a header on success are brought down to it.
- **Enforcement = Approach 2** — add a self-documenting `chromeless` boolean to `ModalShell` so "this step has no header bar" is explicit at the call site instead of the implicit `title={undefined}` trick, plus a dev-only guard that warns when a modal would render no header unintentionally.
- **Exceptions (keep bespoke chrome, out of normalization):** the live-camera `LiveBarcodeScanner` overlay and pure list/action sheets (`UserMenu`). These are noted as intentional exceptions in the doc.

## The normalized rule (to be documented in `modal-system.md`)

Every modal step is exactly one of:

1. **Headered content step** — has a short, human title. Implemented either by passing `title` to `ModalShell` (single/standard modals) or, for `rawContent` multi-step modals, by the step's own `IonHeader` containing an `IonTitle`. Always carries the X close in the toolbar end slot; a back chevron in the start slot when `depth > 1` / not the first step.
2. **Chromeless terminal step** — success/celebration. No header. Closes via its primary/"Done" button. Set `chromeless` on `ModalShell` (or, for `rawContent`, simply render no `IonHeader`).

A modal must never render a content step with no title, and never leave a `noSwipeDismiss` step with no close affordance.

## ModalShell change (`apps/web/src/components/ui/modal-shell.tsx`)

1. Add `chromeless?: boolean` to `ModalShellProps`, documented as: "Suppress the auto-rendered header bar entirely. Use for terminal success/celebration steps whose primary button is the only dismissal affordance. Distinct from omitting `title`, which is being phased out as an implicit form of this."
2. Header render condition becomes: `const showHeader = !chromeless && title !== undefined`. (`rawContent` modals are unaffected — they never auto-render a header.)
3. **Dev guard:** when `import.meta.env.DEV`, if `!rawContent && !chromeless && title === undefined`, `console.warn` once that the modal renders no header/close and is likely missing a `title` or an explicit `chromeless`. This converts the silent close-trap into a visible warning.

No behavior change for any current modal that passes a `title`.

## Per-modal changes

**Add a title to header-less content steps:**
- `expenses/AddExpenseCategoryModal.tsx` — its self-rendered `IonHeader` has an X but no `IonTitle`; add one (new i18n key `expenses.add_category_modal_title`, all 11 locales).
- `create-business/steps/NameStep.tsx`, `LocaleStep.tsx`, `LogoStep.tsx` — add an `IonTitle` to each step's `IonHeader` (reuse existing per-step heading copy if present; otherwise new keys, all 11 locales). Confirm during planning whether the title should instead be hoisted to `CreateBusinessModal`'s `ModalShell`/`onBack` header.
- `join/JoinBusinessModal.tsx` — replace `title=""` with a real short title (new/existing key, all 11 locales). Keep the editorial hero.

**Bring success steps to chromeless** (set `chromeless` on the success step; stop computing a success-step title):
- The bucket-B modals whose success step currently keeps a header: `manage/EditNameModal`, `manage/EditLocationModal`, `manage/EditLogoModal`, `manage/TransferOwnershipModal`, `manage/DeleteBusinessModal`, `manage/CancelTransferModal`, `manage/LeaveBusinessModal` (if it has a success step), `account/EditProfileModal`, `account/ChangeEmailModal` (success stage), `account/DeleteAccountModal` (success stage), `inventory/AdjustStockModal`, `transfer/IncomingTransferModal` (accept-success), `sales/OpenSessionModal` / `sales/CloseSessionConfirmModal` / `sales/ViewCartModal` (success/“Done” steps), `expenses/ExpenseDetailModal` (delete-success), `team/InviteModal` (deleted-success), `team/MemberModal` (success). The exact list is finalized in the plan after a per-file read; each must already have a "Done"/primary button on the success step (the audit confirms they do).
- The 3 `rawContent` product success steps need **no change** — they are already chromeless and are the reference implementation.

**Verify (no change expected, confirm during planning):** `expenses/AddExpenseModal`, `EditExpenseModal`, `team/InviteModal` content steps already carry titles (grep was ambiguous because of footer `IonToolbar`s).

## i18n cleanup

Going chromeless on success steps orphans the `*_title_success` (and similar success-only header-title) keys. Per the repo's existing practice of pruning unused keys, remove each orphaned key from all 11 locale files as part of the same change, then regenerate `apps/web/src/i18n/messageIds.d.ts`. New keys added for the header-less content steps land in `en-US.json` first with real translations in every other locale (the project i18n rule). The plan enumerates the exact add/remove key list per file.

## Documentation

Update `.claude/docs/modal-system.md`:
- State the normalized rule (the two step kinds above).
- Document the `chromeless` prop and that the X close is tied to the header — i.e. a content step MUST have a title, a terminal step MUST be `chromeless` with its own button.
- List the intentional exceptions (`LiveBarcodeScanner`, list/action sheets).

## Testing / verification

- Extend `modal-shell.test.tsx`: (a) `chromeless` renders no header/title/close even when `title` is provided; (b) the existing title→header+X behavior is unchanged.
- `npm run build` (tsc + vite), `npm run test:run` (full web suite), `npm run lint` all clean.
- Manual walkthrough on a representative sample: open a bucket-B modal to its success step (header gone, Done closes it), open `AddExpenseCategoryModal` / a `CreateBusinessModal` step / `JoinBusinessModal` (now titled), and a `rawContent` product flow (unchanged). Confirm no DEV console warnings from the new guard on conforming modals, and that no modal is left without a close affordance.

## Out of scope

- Rewording existing titles, or changing the toolbar-title-plus-hero-headline house style (option A keeps both).
- Normalizing back-navigation affordances (back chevron vs footer Back button) — a separate concern.
- `LiveBarcodeScanner` and list/action sheets — documented exceptions, untouched.
- Any non-`ModalShell` surfaces (none of substance were found).
