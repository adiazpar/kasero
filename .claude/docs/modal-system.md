# Modal System Guide

The modal system is built on `ModalShell` — a single standardized wrapper around `IonModal` that manages chrome (header, toolbar, close button, breakpoints, drag handle) consistently across all ~30 modals in the app. Multi-step flows are implemented as step-stack state owned by the consumer, not by a compound component.

**Source:** `apps/web/src/components/ui/modal-shell.tsx`

---

## Quick Reference

```tsx
import { ModalShell } from '@/components/ui'

// Pattern 0 — single-body modal
<ModalShell isOpen={isOpen} onClose={onClose} title="Edit Item" footer={<button onClick={onClose}>Save</button>}>
  <p>Content here</p>
</ModalShell>

// Pattern 1 — multi-step modal (step-stack state in the consumer)
<ModalShell isOpen={isOpen} onClose={onClose} rawContent noSwipeDismiss>
  {step === 'form' && <FormStep onNext={() => setStep('success')} onClose={onClose} />}
  {step === 'success' && <SuccessStep onClose={onClose} />}
</ModalShell>
```

---

## Component API

### `<ModalShell>`

| Prop | Type | Description |
|------|------|-------------|
| `isOpen` | `boolean` | Controls visibility |
| `onClose` | `() => void` | Called on `onDidDismiss` (after the close animation) |
| `title` | `string` | Header title text. Omit only when `chromeless` is also set. |
| `variant` | `'full' \| 'half'` | Drawer height variant — `'full'` (default) or `'half'` |
| `onBack` | `() => void` | When set, renders a back chevron in the toolbar's start slot |
| `footer` | `ReactNode` | Rendered inside `IonFooter` at the bottom of the modal |
| `rawContent` | `boolean` | When true, renders children directly in `IonModal` without an auto-wrapped `IonContent`. Required for multi-step modals whose steps render their own `IonHeader` / `IonContent` / `IonFooter`. |
| `noSwipeDismiss` | `boolean` | Disables sheet swipe-to-dismiss. Required for any modal with an `IonInput` + a Lottie success step (iOS keyboard resize can trigger snap-to-0 dismiss). |
| `chromeless` | `boolean` | Suppresses the auto-rendered header entirely. Use for terminal success/celebration steps. |
| `flushContent` | `boolean` | Skips the `.modal-content` inset on the auto-rendered `IonContent`. Use for list-style sheets where rows paint edge-to-edge. |
| `noScroll` | `boolean` | Disables `IonContent` inner scroll via `--overflow: hidden`. Use for fixed-layout steps (e.g., cash-keypad). |
| `keepContentsMounted` | `boolean` | Forces the body to stay mounted across open/close cycles. |

---

## Critical Rules

### 1. Keep step chrome at the consumer level

`ModalShell` renders a single `IonModal`. For multi-step flows, the consumer owns a step-stack (or step enum) state and conditionally renders the active step's body. Each step is a plain content subtree — `IonHeader` + `IonContent` + `IonFooter` rendered directly inside the `rawContent` modal, NOT wrapped in a `<IonPage>` or routed via `<IonNav>`.

```tsx
// CORRECT — step body is a plain subtree, chrome is local to the step
<ModalShell isOpen={isOpen} onClose={onClose} rawContent noSwipeDismiss>
  {step === 'form' && <FormStep />}
  {step === 'success' && <SuccessStep />}
</ModalShell>

// CORRECT — Pattern 0: single body, chrome owned by ModalShell
<ModalShell isOpen={isOpen} onClose={onClose} title="Confirm"
  footer={<button onClick={onConfirm}>Yes</button>}>
  <p>Are you sure?</p>
</ModalShell>
```

**If you need reusable step content:**
1. Extract content-only step components that render their own `IonHeader` + `IonContent` + optional `IonFooter`.
2. Pass shared navigation callbacks (push/pop/close) via a step-context (e.g. `useMyNav()`).
3. Never wrap step components in `IonPage` — see Rule 5.

### 2. Separate Add and Edit Modals

Do NOT combine add and edit flows into one modal with conditional rendering. The timing issues between `useEffect`-based state population cause:
- Wrong step on open (form vs mode selection)
- Missing footer buttons (state not set on first render)
- Stale content on reopen

Instead, create separate modals:
```tsx
<AddItemModal isOpen={isOpen && !editingItem} ... />
<EditItemModal isOpen={isOpen && !!editingItem} ... />
```

### 3. State Cleanup Belongs in onClose (which fires after animation)

`ModalShell` passes `onClose` to Ionic's `onDidDismiss` — which fires AFTER the dismiss animation completes. This means resetting state in `onClose` is safe and does not cause mid-animation content flashes.

```tsx
// CORRECT — ModalShell.onClose fires via onDidDismiss, after animation
<ModalShell
  isOpen={isOpen}
  onClose={() => {
    setIsOpen(false)
    setEditingItem(null)  // Safe — animation is already done
    resetForm()
  }}
  title="Edit Item"
>
  {/* ... */}
</ModalShell>
```

Do not try to split the close signal from the cleanup signal — `ModalShell` has no separate `onExitComplete` prop. The single `onClose` callback covers both.

### 4. Success Steps: Await, Then Advance

For save/delete flows, **await** the mutation and advance to the success step only on success — so a failure surfaces inline on the form instead of after a celebratory animation (real examples: `ReviewStep.tsx` awaits `onSubmit(...)`; `AdjustStockModal.tsx` awaits `create(...)` then `setStep('success')`). The genuinely optimistic move is to fire-and-forget a *non-blocking* follow-up like `void products.refetch()` after the await — never to skip awaiting the mutation itself:

```tsx
function FormStep({ onSuccess, onSubmit }: Props) {
  const handleSave = async () => {
    const saved = await onSubmit()   // await the mutation — errors are catchable here
    if (!saved) return               // stay on the form and show the error
    onSuccess()                      // advance consumer step state to 'success'
  }

  return (
    <>
      <IonHeader>
        <IonToolbar><IonTitle>Edit</IonTitle></IonToolbar>
      </IonHeader>
      <IonContent>
        {/* form fields */}
        <button onClick={handleSave}>Save</button>
      </IonContent>
    </>
  )
}
```

The success step is a chromeless terminal step with a single Done/close button (or auto-close timer). Set `chromeless` on `ModalShell` when the success step is active:

```tsx
<ModalShell
  isOpen={isOpen}
  onClose={onClose}
  title={step !== 'success' ? intl.formatMessage({ id: 'thing.edit_title' }) : undefined}
  chromeless={step === 'success'}
  rawContent
  noSwipeDismiss
>
  {step === 'form' && <FormStep onSuccess={() => setStep('success')} onSubmit={submit} />}
  {step === 'success' && (
    <IonContent>
      <div className="flex flex-col items-center text-center py-4">
        <LottiePlayer src="/animations/success.json" loop={false} autoplay style={{ width: 160, height: 160 }} />
        <button onClick={onClose} className="btn btn-primary">Done</button>
      </div>
    </IonContent>
  )}
</ModalShell>
```

**Available Lottie animations:**
- `/animations/success.json` — green checkmark (save, create, receive)
- `/animations/error.json` — red X (deletions)

### 5. Never nest `IonNav` (or any `IonPage`) inside `IonModal`

**Hard rule. No exceptions.**

Every step in a multi-step modal MUST be a plain content subtree — `IonHeader` + `IonContent` + `IonFooter` (or just `IonContent`) rendered directly as a child of `ModalShell`. Multi-step flows manage their own step stack via `useState<Step[]>(...)` and render the active step with conditional rendering.

**Do not** wrap step components in `<IonPage>`. **Do not** use `<IonNav>` to drive step transitions inside a modal. **Do not** use `IonBackButton` inside a modal (it depends on `IonRouterOutlet`'s view-stack, which doesn't extend into the modal portal).

#### Why

`IonModal` portals its children to the document root, but in React's tree they still live inside the host `IonPage` that's mounted by the surrounding `IonRouterOutlet`. If any of those children render an `IonPage`, Ionic's `StackManager` silently registers them against the **outer** outlet's view stack — even though they're visually inside a modal portal. The outlet's stack tracking then desyncs from the URL.

Symptoms range from "wrong page renders under correct URL" (modal opens → close → tap a tab → drill down → back → outer outlet now shows a cached `IonPage` from the wrong route) to "iOS pop animation drags for 1–2 seconds after the modal closes". The bug is dormant after the first corruption and only surfaces on the next push+pop in the outer outlet, which makes it incredibly easy to miss in dev.

#### Correct pattern (state-driven step stack)

```tsx
// In the modal component:
type Step = 'name' | 'price' | 'review' | 'success'
const INITIAL_STACK: Step[] = ['name']

function MyMultiStepModal({ isOpen, onClose }: Props) {
  const [stack, setStack] = useState<Step[]>(INITIAL_STACK)

  // Reset on open — the same modal component is reused across sessions.
  useEffect(() => {
    if (isOpen) setStack(INITIAL_STACK)
  }, [isOpen])

  const push = useCallback((step: Step) => setStack((s) => [...s, step]), [])
  const pop = useCallback(
    () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    [],
  )
  const nav = useMemo(() => ({ push, pop, depth: stack.length }), [push, pop, stack.length])
  const current = stack[stack.length - 1]

  return (
    <MyNavContext.Provider value={nav}>
      <ModalShell rawContent isOpen={isOpen} onClose={onClose}>
        {current === 'name' && <NameStep />}
        {current === 'price' && <PriceStep />}
        {current === 'review' && <ReviewStep />}
        {current === 'success' && <SuccessStep />}
      </ModalShell>
    </MyNavContext.Provider>
  )
}

// In a step component — no IonPage, no IonBackButton:
function NameStep() {
  const nav = useMyNav()
  return (
    <>
      <IonHeader>
        <IonToolbar>
          {nav.depth > 1 && (
            <IonButtons slot="start">
              <IonButton fill="clear" onClick={() => nav.pop()} aria-label="back">
                <IonIcon icon={chevronBack} />
              </IonButton>
            </IonButtons>
          )}
          <IonTitle>Name</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>{/* ... */}</IonContent>
      <IonFooter>
        <IonToolbar>
          <IonButton onClick={() => nav.push('price')}>Continue</IonButton>
        </IonToolbar>
      </IonFooter>
    </>
  )
}
```

Pop at `depth === 1` is a no-op by design — the root step exits via the close X in its own toolbar, not via the back chevron.

**Reference implementation:** the product modals (`AddProductModal.tsx`, `EditProductModal.tsx` + `steps/`), which intentionally moved away from `IonNav` for this reason — see the note at `steps/ProductNavContext.tsx:5-15`.

### 6. Use Named Step States, Not Numeric Indices

Multi-step modals use a string enum (or step-stack of string enums) for step identity. Avoid numeric indices — when a conditional step is present or absent, numeric references to later steps silently point to the wrong step.

```tsx
// DANGEROUS — numeric index changes based on canDelete
type Step = 0 | 1 | 2
// step 0 = form, step 1 = confirm-delete (maybe), step 2 = success?
// Once canDelete is false, step 2 no longer exists

// SAFE — named step states are stable regardless of which steps render
type Step = 'form' | 'confirm-delete' | 'success'
const [step, setStep] = useState<Step>('form')

// Conditional rendering in the modal body
{step === 'form' && <FormStep onDelete={() => setStep('confirm-delete')} onSave={() => setStep('success')} />}
{step === 'confirm-delete' && <ConfirmDeleteStep onBack={() => setStep('form')} />}
{step === 'success' && <SuccessStep onClose={onClose} />}
```

---

### 7. Header normalization: content steps are titled, terminal steps are chromeless

Every modal step is exactly one of two shapes — there is no in-between:

1. **Headered content step** — has a short, human title in the header bar, plus the X
   close (and a back chevron when there's a prior step). For standard `ModalShell`
   modals, pass `title`. For `rawContent` multi-step modals, the step's own
   `IonHeader` must contain an `IonTitle`.
2. **Chromeless terminal step** — success / celebration. **No header** (no title, no X).
   The big animation + a single "Done"/primary button is the whole screen, and that
   button (or a timer auto-close) is the only dismissal affordance. Set `chromeless`
   on `ModalShell` (standard modals) or render no `IonHeader` for the step (`rawContent`).

**The X close button is tied to the header.** `ModalShell` renders its header — including
the X — only when `showHeader` is true (`!chromeless && title !== undefined`). So:

- A content step **must** have a `title`. Omitting it removes the X and, with
  `noSwipeDismiss`, creates a close-trap.
- A terminal step **must** use `chromeless` (not just an omitted/empty `title`) so the
  intent is explicit, and it **must** carry its own button or timer to close.

```tsx
// Multi-step modal: form step is headered, success step is chromeless.
<ModalShell
  isOpen={isOpen}
  onClose={onClose}
  title={intl.formatMessage({ id: 'thing.edit_title' })}  // only the content step's title
  chromeless={step === 'save-success'}                     // success step → no header
  footer={footer}
  noSwipeDismiss
>
```

Prefer `chromeless` over the legacy implicit `title={undefined}` / `title=""`. A DEV-only
guard in `ModalShell` warns when a non-`rawContent` modal would render no header with
neither a `title` nor `chromeless` — fix those by adding the right one.

**Title vs in-body hero.** The header title is a short label. A modal may *also* render a
large editorial headline in the body (`.modal-hero__title`); the two coexisting is the
house style (e.g. `EditNameModal`, `ChangeEmailModal`). The in-body celebratory heading on
a chromeless success step (under the Lottie) stays — only the header title goes away.

**Documented exceptions** (keep their bespoke chrome; not governed by this rule): the
live-camera `LiveBarcodeScanner` overlay, and pure list / action sheets such as `UserMenu`.

---

## TabContainer

For modals that need tabs within a single step (e.g., Details / Barcode tabs), use `TabContainer` from `@/components/ui`. **Read `.claude/docs/tab-system.md` for the full API, behavior guarantees, and architectural rules.** This section covers only what's modal-specific.

```tsx
import { TabContainer } from '@/components/ui'

// Inside a rawContent step component (renders its own IonHeader/IonContent/IonFooter):
<>
  <IonHeader>
    <IonToolbar>
      <IonTitle>Edit product</IonTitle>
    </IonToolbar>
    {/* Tab buttons - add modal-step-item class so they fade with content */}
    <div className="section-tabs section-tabs--modal modal-step-item">
      <button onClick={() => setActiveTab('details')} className={`section-tab ${activeTab === 'details' ? 'section-tab-active' : ''}`}>
        Details
      </button>
      <button onClick={() => setActiveTab('barcode')} className={`section-tab ${activeTab === 'barcode' ? 'section-tab-active' : ''}`}>
        Barcode
      </button>
    </div>
  </IonHeader>

  <IonContent>
    <TabContainer
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as 'details' | 'barcode')}
      swipeable
    >
      <TabContainer.Tab id="details">
        <div className="modal-step-item">...</div>
        <div className="modal-step-item">...</div>
      </TabContainer.Tab>
      <TabContainer.Tab id="barcode">
        <div className="modal-step-item">...</div>
      </TabContainer.Tab>
    </TabContainer>
  </IonContent>

  <IonFooter>
    <IonToolbar>
      <div className="modal-footer">...</div>
    </IonToolbar>
  </IonFooter>
</>
```

**Modal-specific rules:**
- Always pass `swipeable` and `onTabChange` — modals are mobile-first and users expect to swipe between tabs.
- **Do not** pass `fitActiveHeight` in modals. Modals need a stable container height to avoid the modal card growing/shrinking on swipe. The default (`fitActiveHeight={false}`) sizes to the tallest tab and is the correct choice. Only enable `fitActiveHeight` on full-page tabs where one tab is dramatically shorter than the other (see tab-system guide).
- Form state must live in a context (e.g. `useProductForm`), not in component state inside a tab subtree. `TabContainer` keeps tabs mounted, but contexts also survive modal close/reopen, which the tab subtree does not.

**Tabs styling:**
- Use `section-tabs--modal` modifier for modal context (no sticky positioning, no top padding)
- Add `modal-step-item` class to the tabs container so it participates in step transition animations

---

## Programmatic close from outside the modal

Some navigation-level events must dismiss every open modal before routing away, because the host `IonPage` is about to be replaced. The realtime revoke flow is the primary example: when `session.revoked`, `business.deleted`, or `ownership.transferred` arrives for the active business, `RealtimeProvider` calls `revokeBusinessContext`, which dismisses all open modals before navigating to the hub:

```typescript
document.querySelectorAll('ion-modal').forEach((m) => {
  ;(m as unknown as { dismiss?: () => void }).dismiss?.()
})
```

`HTMLIonModalElement.dismiss()` triggers the modal's exit animation and fires `onDidDismiss`, so each modal's host component cleans up its state correctly through the normal modal lifecycle. This is equivalent to the user pressing the close button on every open modal simultaneously.

**When to use this pattern:** any code path that replaces the active `IonPage` programmatically (e.g., a push notification routing to a different business, a forced re-auth redirect) should call `dismiss()` on all open modals first. Without it, the modal portal stays mounted at the document root after the host `IonPage` is gone, leaving a stranded overlay on screen.

See `.claude/docs/realtime-system.md` for the full revoke flow.

---

## Examples

**Simple single-body modal:** `apps/web/src/components/account/EditProfileModal.tsx`
**Multi-step with OTP:** `apps/web/src/components/account/ChangeEmailModal.tsx`
**Add + AI flow:** `apps/web/src/components/products/AddProductModal.tsx`
**Edit with delete:** `apps/web/src/components/products/EditProductModal.tsx`
**Team management (modals + flows in a tab page):** `apps/web/src/routes/tabs/TeamTab.tsx`

> Modal hosts live inside whichever `IonPage` mounts them. Each tab page (`HomeTab`, `LedgerTab`, `ProductsTab`, `ManageTab`) and the `TeamTab` drill-down own their own modals; modals render as portals at the document root and close cleanly when the host `IonPage` unmounts or the `isOpen` prop flips to false.
