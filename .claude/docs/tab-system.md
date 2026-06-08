# Tab System

There are **two distinct tab abstractions** in the codebase. Don't confuse them:

| Concept | Source | Use case |
|---------|--------|----------|
| **`TabContainer`** (custom) | `apps/web/src/components/ui/TabContainer.tsx` | In-page sub-tab UI inside a single page or modal (e.g. the Products and Ledger views' sub-tabs, AddProductModal's Details↔Barcode tabs). Handles swipe gestures, slide animations, and scroll reset. |
| **`IonTabs`** (Ionic) | `@ionic/react` | Top-level navigation across the 4 business-context bottom tabs (Home, Sales, Products, Manage). Persistence + scroll preservation are native to Ionic; we don't reimplement them. |

This document is about **`TabContainer`** — the in-page sub-tab primitive. For the top-level bottom-nav shell, see the section [IonTabs (top-level shell)](#iontabs-top-level-shell) below — it's a short pointer; the full per-page wiring lives in `apps/web/src/routes/BusinessTabsLayout.tsx`.

`TabContainer` is the canonical primitive for any in-page tab UI — both modals and full pages. It handles swipe-to-switch, slide animations, and scroll reset. Don't roll your own tab renderer.

> When tabs live inside a modal, also read `.claude/docs/modal-system.md` — it covers the modal-specific rules (which props to enable, where form state must live, tab button styling with `section-tabs--modal` and `modal-step-item`).

## API

```tsx
<TabContainer
  activeTab={activeTab}
  onTabChange={setActiveTab}    // required when swipeable
  swipeable                     // enable horizontal drag-to-switch
  fitActiveHeight               // size wrapper to active tab (see below)
>
  <TabContainer.Tab id="details">{detailsContent}</TabContainer.Tab>
  <TabContainer.Tab id="barcode">{barcodeContent}</TabContainer.Tab>
</TabContainer>
```

| Prop | Default | Purpose |
|------|---------|---------|
| `activeTab` | — | The currently visible tab id. |
| `onTabChange` | — | Required when `swipeable`. Called with the next tab id when a swipe crosses the threshold. |
| `swipeable` | `false` | Enable horizontal swipe-to-switch via framer-motion. |
| `fitActiveHeight` | `false` | Wrapper sizes to the **active** tab instead of the **tallest** tab. Use only when tab heights differ significantly (see decision matrix below). |

`TabContainer.Tab` is a marker component — it must be a direct child of `TabContainer`. Don't wrap it in another component.

You still render your own tab buttons above the `TabContainer`. The component handles only the panel area, not the tab bar.

## When to use which prop combination

| Surface | `swipeable` | `fitActiveHeight` | Why |
|---------|:-----------:|:-----------------:|-----|
| Modals with similar-height tabs (`AddProductModal`, `EditProductModal`) | yes | **no** | Stable container height — no growing/shrinking on swipe. |
| Full pages with very different tab heights (the Products view's Products↔Inventory) | yes | **yes** | Avoids large empty space below the shorter tab. Height swap is instant under the slide. |
| Anywhere swipe is undesirable (rare) | no | n/a | Falls back to a plain opacity cross-fade with all tabs mounted. |

**Default to `fitActiveHeight={false}`.** Only enable it when the height delta between tabs is large enough that the empty space below the short tab is visible and annoying.

## Behavior guarantees

These are properties of the component. Don't reimplement them in consumers.

1. **All tabs are kept mounted.** Switching tabs never unmounts/remounts the tab subtree. Internal state, DOM nodes, image loads, and form fields are preserved across switches.
2. **Form state should still live in a context.** Even though tabs aren't unmounted, hoisting form state into a context (like `useProductForm`) is the right pattern — it makes the form survive modal close/open as well, and it's a defensive choice if `TabContainer` ever needs to virtualize tabs in the future.
3. **Swipe direction mirrors the gesture.** Swipe left → next tab slides in from the right. Swipe right → previous tab slides in from the left.
4. **Tap-to-switch animates correctly too.** The slide direction is derived from the index delta of the active tab change, not from drag state. So tapping the leftmost tab from the rightmost slides in from the left, regardless of how the previous switch happened.
5. **Works for any number of tabs.** Index-delta direction generalizes — jumping from tab 0 to tab 3 still slides in from the right.
6. **The new tab starts at scroll-top.** On every `activeTab` change, `TabContainer` walks up from its outer wrapper to the closest scrollable ancestor (`overflow-y: auto|scroll`) and resets `scrollTop` to 0. This handles `IonContent`'s scroll container (full pages — Ionic exposes the inner scroller as the closest `overflow-y: auto` ancestor), `.modal-body` (modal level), and any other scroll container in the tree without per-consumer wiring.
7. **Initial render does not animate.** The wrapper uses `initial={false}`, so on mount each tab is at its target position with no flash/slide-out.

## Architecture notes (the gotchas we hit)

If you change this component, read these first.

### Two-layer drag/clip structure
The wrapper is two divs:

```
<div className="overflow-hidden">           ← stationary clip box
  <motion.div drag="x" ...>                 ← inner draggable layer
    {tabs}
  </motion.div>
</div>
```

Do **not** put `overflow-hidden` on the same element that has `drag="x"`. If you do, the clip box translates with the finger and exposes the page background on the opposite side ("background residual" bug).

### Inactive tabs must be both offscreen AND opacity 0
Each tab is positioned at `x: (i - activeIndex) * 100%` and `opacity: 1` only when active. If you skip the opacity hide, neighboring tabs become visible during the drag (the "two pages glued together" bug). Both conditions are required.

### Slide direction is derived, not stored
Don't add a `direction` state and update it in the drag handler — that breaks tap-to-switch. Direction is computed from the index delta on every render via a `prevActiveRef`. This gives a single source of truth and works for any switch source (swipe, tap, programmatic).

### `fitActiveHeight` does not use `layout`
Earlier we tried framer's `layout` prop on the wrapper to animate the height between tabs. **Don't.** It made the slide feel jarring (height animating against the translate) and reintroduced the modal grow/shrink for the no-prop case. Instead, when `fitActiveHeight` is on, the active tab is `position: relative` and inactive tabs are `position: absolute inset-x-0 top-0`. The wrapper height swaps instantly under cover of the slide, which reads as smooth.

### Flex chain when `fitActiveHeight={true}`
When `fitActiveHeight` is on (full-page tab surfaces like ProductsTab), both the outer clip wrapper and the inner `motion.div` receive a `grow` class so the flex chain extends downward. This allows children that use `flex: 1` — such as `.page-body` containing an `.empty-state-fill` — to fill the remaining vertical viewport space and center empty states correctly. Without this `grow` propagation, the wrapper shrinks to content height and `flex: 1` children collapse to zero. Modals use `fitActiveHeight={false}` and don't need this behavior.

### Don't unmount tabs (no `AnimatePresence`)
We tried `AnimatePresence` with a single rendered tab. It caused two regressions:
1. **Blinking** — components inside tabs flashed on every switch from unmount/remount. Especially noticeable in the modals.
2. **Container resize** — with only one tab in the DOM, the container sized to that tab, so the modal grew/shrank on each swipe.
Keep all tabs mounted.

### Drag must allow vertical scroll
The inner `motion.div` has `touch-pan-y` so vertical scrolling inside tab content is unaffected by the horizontal drag handler. Don't remove this.

### Initial render
`initial={false}` on each tab is required — without it, framer animates from its default `x: 0, opacity: 1` to each tab's target on first mount, causing the inactive tabs to visibly slide out from the center.

## Adding swipe to a new tabbed surface

1. Convert your conditional render (`activeTab === 'a' ? <A/> : <B/>`) to `<TabContainer.Tab>` children of a `<TabContainer>`.
2. Pass `activeTab`, `onTabChange`, and `swipeable`.
3. Decide on `fitActiveHeight` using the matrix above (default no).
4. Verify nothing inside the tab subtree relies on being unmounted to reset state — `TabContainer` keeps everything mounted.
5. Keep your existing tab buttons; they trigger `setActiveTab` directly. The slide will animate in the correct direction automatically.

## Swipe thresholds

Configured in `TabContainer.tsx`:

- `SWIPE_OFFSET_THRESHOLD = 60` — minimum horizontal pixels to commit a swipe.
- `SWIPE_VELOCITY_THRESHOLD = 400` — minimum horizontal velocity (px/s) that commits a swipe even on a short drag.

A swipe commits if **either** threshold is crossed. Adjust both together if the gesture feels too sticky or too sensitive.

## Form controls and `data-no-swipe`

Drag handlers do not interfere with form controls (`<input>`, `<textarea>`, `<select>`, `<button>`) — pointer events on those elements are consumed before the drag starts. If you encounter a custom interactive element that gets hijacked by the swipe (e.g., a custom slider, signature pad, draggable picker), add `data-no-swipe` to it as an escape hatch — you'll then need to wire it through to skip the drag in `TabContainer` (not currently implemented; add when needed).

---

## IonTabs (top-level shell)

The 4 business-context bottom tabs (`home`, `sales`, `products`, `manage`) are rendered by **Ionic's `<IonTabs>`** inside `apps/web/src/routes/BusinessTabsLayout.tsx`. This is **not** a `TabContainer`. It's a different abstraction with different behavior:

- **Routing-driven**: each tab is a `<Route>` rendering an `<IonPage>`. URL is the source of truth for the active tab.
- **Persistent by default**: `IonRouterOutlet` keeps every visited tab mounted in memory so switching back is instant and scroll position is preserved.
- **No swipe between tabs**: Ionic's bottom-tab pattern is tap-only by design (matches iOS / Android conventions).
- **Native tab bar**: `<IonTabBar slot="bottom">` + `<IonTabButton>` provide the chrome. Brand colors flow through via `--ion-tab-bar-*` variables in `apps/web/src/styles/ionic-theme.css`.

Skeleton:

```tsx
import { IonTabs, IonTabBar, IonTabButton, IonRouterOutlet, IonLabel, IonIcon } from '@ionic/react'
import { Route } from 'react-router-dom'

export function BusinessTabsLayout() {
  const businessId = useCurrentBusinessId()
  return (
    <IonTabs>
      <IonRouterOutlet>
        <Route exact path="/:businessId/home" component={HomeTab} />
        <Route exact path="/:businessId/sales" component={LedgerTab} />
        <Route exact path="/:businessId/products" component={ProductsTab} />
        <Route exact path="/:businessId/manage" component={ManageTab} />
        {/* Drill-down reachable from the manage tab shares this outlet */}
        <Route exact path="/:businessId/team" component={TeamTab} />
      </IonRouterOutlet>
      <IonTabBar slot="bottom">
        <IonTabButton tab="home" href={`/${businessId}/home`}>
          <IonIcon /* ... */ />
          <IonLabel>{intl.formatMessage({ id: 'navigation.home' })}</IonLabel>
        </IonTabButton>
        {/* sales, products, manage */}
      </IonTabBar>
    </IonTabs>
  )
}
```

**Why two different abstractions:**

- `TabContainer` is the right shape for **in-page** sub-tabs: same page, swipe between sibling content panels, no URL change.
- `IonTabs` is the right shape for **top-level** tabs: each tab is a distinct page with its own URL, deep-linkable, persistent in the navigation stack, and tappable from the system-style bottom bar.

Don't try to unify them. They look superficially similar but model different navigation concepts.

### Persistence and scroll preservation

`IonRouterOutlet` keeps each visited tab mounted on a transform-translated layer. Switching tabs is a CSS visibility flip with the inactive tab moved offscreen — the React tree never unmounts. This means:

- **Internal state survives** tab switches: search filter input, expanded rows, in-progress modal data.
- **Scroll position is preserved per tab** by Ionic — the inactive tab's scroll position is kept on the offscreen element and restored when the tab becomes active again.
- **Drill-downs from a tab** (e.g., manage → team) push onto the tab's own stack. Going back unwinds to the parent tab in its prior state.

We don't need a `TabShell` component, an `useIdleMount` hook, or a `getActiveTab` function for this — Ionic owns it.
