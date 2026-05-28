# Modal System Guide

The modal system uses a compound component pattern with built-in multi-step navigation, animated transitions, and footer management.

**Source:** `apps/web/src/components/ui/modal/`

---

## Quick Reference

```tsx
import { Modal, useModal } from '@/components/ui'

<Modal isOpen={isOpen} onClose={onClose} onExitComplete={onCleanup}>
  <Modal.Step title="Step One">
    <Modal.Item>
      <p>Content here</p>
    </Modal.Item>
    <Modal.Footer>
      <button className="btn btn-primary flex-1">Save</button>
    </Modal.Footer>
  </Modal.Step>
</Modal>
```

---

## Component API

### `<Modal>`

| Prop | Type | Description |
|------|------|-------------|
| `isOpen` | `boolean` | Controls visibility |
| `onClose` | `() => void` | Called when X/backdrop/ESC triggers close |
| `onExitComplete` | `() => void` | Called AFTER close animation finishes — use for state cleanup |
| `title` | `string` | Fallback title (overridden by step titles) |
| `size` | `'default' \| 'large'` | Modal width |
| `initialStep` | `number` | Starting step index (default: 0) |

### `<Modal.Step>`

| Prop | Type | Description |
|------|------|-------------|
| `title` | `string` | Step title shown in header |
| `hideBackButton` | `boolean` | Hide the back arrow |
| `backStep` | `number` | Override back button to go to specific step |
| `onBackStep` | `() => void` | Callback when back is pressed (e.g., abort processing) |

### `<Modal.Item>`

Wraps content sections with proper padding and staggered enter animation.

### `<Modal.Footer>`

Renders in a fixed footer area below the content. Animates height when present/absent.

### Navigation Buttons

| Component | Description |
|-----------|-------------|
| `<Modal.NextButton>` | Go to next step |
| `<Modal.BackButton>` | Go to previous step |
| `<Modal.CancelBackButton>` | Go back (or close if first step) |
| `<Modal.GoToStepButton step={n}>` | Jump to specific step |

### `useModal()` Hook

Access modal state and navigation from any child component:

```tsx
const { currentStep, goToStep, goNext, goBack, lock, unlock } = useModal()
```

---

## Critical Rules

### 1. Direct Children Only

Modal uses `Children.toArray()` with `_isModalStep` / `_isModalFooter` markers to find steps and footers. **Wrapper components are invisible** to this scan.

```tsx
// CORRECT
<Modal>
  <Modal.Step title="Confirm">
    <Modal.Item><p>Are you sure?</p></Modal.Item>
    <Modal.Footer><button>Yes</button></Modal.Footer>
  </Modal.Step>
</Modal>

// BROKEN - Modal.Step inside wrapper is not detected
<Modal>
  <SomeWrapperComponent />  {/* Returns Modal.Step — invisible to Modal */}
</Modal>

// BROKEN - Modal.Footer inside wrapper is not detected
<Modal.Step title="Edit">
  <FormWithFooter />  {/* Returns Modal.Item + Modal.Footer — footer not extracted */}
</Modal.Step>
```

**If you need reusable step content:**
1. Extract content-only components that return `<Modal.Item>` elements
2. Extract button components that use `useModal()` for navigation
3. Keep `<Modal.Step>` and `<Modal.Footer>` as direct children in the modal JSX

### 2. Separate Add and Edit Modals

Do NOT combine add and edit flows into one modal with conditional rendering. The timing issues between `useEffect`-based state population and `initialStep` cause:
- Wrong step on open (form vs mode selection)
- Missing footer buttons (state not set on first render)
- Stale content on reopen

Instead, create separate modals:
```tsx
<AddItemModal isOpen={isOpen && !editingItem} ... />
<EditItemModal isOpen={isOpen && !!editingItem} ... />
```

### 3. Clean Up in onExitComplete, Not onClose

Never reset state in `onClose` — it fires when the close STARTS, causing content to flash empty during the fade-out animation.

```tsx
// WRONG — content blinks during close animation
const handleClose = () => {
  setEditingItem(null)  // Content changes mid-animation!
  setIsOpen(false)
}

// CORRECT — state cleanup after animation finishes
<Modal
  isOpen={isOpen}
  onClose={() => setIsOpen(false)}
  onExitComplete={() => {
    setEditingItem(null)
    resetForm()
  }}
>
```

### 4. Optimistic Success Steps

For save/delete flows, navigate to the success step BEFORE the API call. Set the animation trigger state first, then fire the API in the background:

```tsx
function SaveButton({ onSubmit }) {
  const { goToStep } = useModal()

  const handleClick = () => {
    setSaved(true)     // Trigger Lottie animation
    goToStep(3)        // Navigate to success step
    onSubmit()         // API fires in background
  }

  return <button onClick={handleClick}>Save</button>
}
```

The success step gates the Lottie on the trigger state:
```tsx
<Modal.Step title="Saved" hideBackButton>
  <Modal.Item>
    <div className="flex flex-col items-center text-center py-4">
      <div style={{ width: 160, height: 160 }}>
        {saved && (
          <LottiePlayer
            src="/animations/success.json"
            loop={false}
            autoplay={true}
            delay={300}
            style={{ width: 160, height: 160 }}
          />
        )}
      </div>
      <p
        className="text-lg font-semibold text-text-primary mt-4 transition-opacity duration-300"
        style={{ opacity: saved ? 1 : 0 }}
      >
        Changes saved!
      </p>
    </div>
  </Modal.Item>
  <Modal.Footer>
    <button onClick={onClose} className="btn btn-primary flex-1">Done</button>
  </Modal.Footer>
</Modal.Step>
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

**Reference implementations:** the order modals (`NewOrderModal.tsx`, `OrderDetailModal.tsx` + `order-steps/`) and the product modals (`AddProductModal.tsx`, `EditProductModal.tsx` + `steps/`). Both intentionally moved away from `IonNav` for this reason — see the note at `order-steps/OrderNavContext.tsx:5-13` and `steps/ProductNavContext.tsx:5-15`.

### 6. Step Indices Are Positional

Steps are numbered by their order as direct children of `<Modal>`. If you conditionally render steps, the indices shift and `goToStep(n)` breaks.

```tsx
// DANGEROUS — step indices change based on canDelete
<Modal.Step title="Form">...</Modal.Step>
{canDelete && <Modal.Step title="Confirm Delete">...</Modal.Step>}
<Modal.Step title="Success">...</Modal.Step>  {/* Is this step 1 or 2? */}

// SAFE — always render all steps, gate content instead
<Modal.Step title="Form">...</Modal.Step>
<Modal.Step title="Confirm Delete">...</Modal.Step>  {/* Always present */}
<Modal.Step title="Success">...</Modal.Step>          {/* Always step 2 */}
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

<Modal.Step title="Edit product">
  {/* Tab buttons - add modal-step-item class so they fade with content */}
  <div className="section-tabs section-tabs--modal modal-step-item">
    <button onClick={() => setActiveTab('details')} className={`section-tab ${activeTab === 'details' ? 'section-tab-active' : ''}`}>
      Details
    </button>
    <button onClick={() => setActiveTab('barcode')} className={`section-tab ${activeTab === 'barcode' ? 'section-tab-active' : ''}`}>
      Barcode
    </button>
  </div>

  <TabContainer
    activeTab={activeTab}
    onTabChange={(id) => setActiveTab(id as 'details' | 'barcode')}
    swipeable
  >
    <TabContainer.Tab id="details">
      <Modal.Item>...</Modal.Item>
      <Modal.Item>...</Modal.Item>
    </TabContainer.Tab>
    <TabContainer.Tab id="barcode">
      <Modal.Item>...</Modal.Item>
    </TabContainer.Tab>
  </TabContainer>

  <Modal.Footer>...</Modal.Footer>
</Modal.Step>
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

**Simple edit modal:** `apps/web/src/components/providers/ProviderModal.tsx`
**Add + AI flow:** `apps/web/src/components/products/AddProductModal.tsx`
**Edit with delete/inventory:** `apps/web/src/components/products/EditProductModal.tsx`
**Multi-step with review:** `apps/web/src/components/products/NewOrderModal.tsx`
**Team management (modals + flows in a tab page):** `apps/web/src/routes/tabs/TeamTab.tsx`

> Modal hosts live inside whichever `IonPage` mounts them. Each tab page (`HomeTab`, `SalesTab`, `ProductsTab`, `ManageTab`) and each drill-down page (`ProvidersTab`, `TeamTab`, `ProviderDetailPage`) owns its own modals; modals render as portals at the document root and close cleanly when the host `IonPage` unmounts or the `isOpen` prop flips to false.
