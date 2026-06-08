# Performance Patterns

Patterns for keeping the app fast despite remote database latency (production uses Turso) and the Lambda cold-start shape Vercel gives us.

---

## 1. Optimistic UI

**Principle:** Avoid unnecessary waiting. Modal success steps await the mutation (so errors can be surfaced inline), then advance to a dedicated success step. Background data that is no longer blocking the user is refreshed fire-and-forget after the await.

### Modal success-step pattern (await-then-advance)

Modal flows that end with a success/confirmation step (Lottie animation, "Done" button) follow this pattern: the mutation is awaited so that an error can be shown inline on the same step, and the success step is only reached once the API call resolves successfully.

```typescript
// CORRECT - await the mutation, advance only on success, show error inline on failure
const handleSave = async () => {
  setIsSaving(true)
  try {
    const saved = await onSubmit(data)
    if (!saved) { setError('Failed'); return }
    goToStep(successStep)          // advance AFTER the API resolves
  } catch (err) {
    setError(err.message)          // stays on current step, error visible
  } finally {
    setIsSaving(false)
  }
}
```

Source: `ReviewStep.handleSave` (`apps/web/src/components/products/steps/ReviewStep.tsx`) and `AdjustStockModal` (`apps/web/src/components/inventory/AdjustStockModal.tsx`) both follow this pattern.

### Optimistic background refresh (fire-and-forget)

After the await resolves, data that is no longer blocking the user can be refreshed in the background without making the user wait. Use `void` to signal the intentional fire-and-forget:

```typescript
const saved = await sales.commitSale({ ... })
// Server decremented stock atomically — refresh the products cache in the
// background so the picker reflects the new stock numbers without waiting.
void products.refetch()
onGoToSuccess()   // navigate immediately; refetch resolves on its own
```

Source: `ChargeButton.tsx` (`apps/web/src/components/sales/cart-modal/ChargeButton.tsx`).

### Navigation feels optimistic too

Ionic's router commits route changes synchronously and starts the slide-in animation immediately on tap. There's no "pending route" state to manage from app code — taps feel instant by default. The `pendingHref` plumbing that previously lived in `PageTransitionContext` for cross-context navigation feedback is no longer needed for tab/drill-down switches; it remains only for the navigation-error timeout (see Section 11).

### When NOT to fire-and-forget the mutation itself

Always await the mutation when:
- The next UI state depends on the API response data (e.g., a saved product number shown on the success step)
- An error must be surfaced inline before the user leaves the step
- Login / registration (need to know if credentials are valid)
- Joining a business (need to validate invite code)

---

## 2. Business Access Cache

**File:** `apps/api/src/lib/business-auth.ts`

Every business-scoped API route calls `requireBusinessAccess()` via `withBusinessAuth`. This queries the DB to verify the user's role. With the in-memory cache, repeated requests to the same business skip the DB query.

### How It Works

- Module-level `Map<string, CachedAccess>` keyed by `userId:businessId`
- 60-second TTL per entry
- On Vercel, warm function instances reuse the cache across requests
- Cache is invalidated locally when roles change

### Invalidation

Call `invalidateAccessCache(userId, businessId)` after any operation that changes a user's access. Two sibling helpers are available for broader sweeps:

```typescript
import {
  invalidateAccessCache,
  invalidateAccessCacheForBusiness,
  invalidateAccessCacheForUser,
} from '@/lib/business-auth'

// Specific (userId, businessId) pair — role/status change
invalidateAccessCache(targetUserId, businessId)

// Every member of one business — business delete / mutation
invalidateAccessCacheForBusiness(businessId)

// Every business this user belongs to — account delete
invalidateAccessCacheForUser(userId)
```

### Where Invalidation Fires

| Route | What changed | Helper |
|-------|-------------|--------|
| `users/change-role` | Target user's role | `invalidateAccessCache` |
| `users/toggle-status` | Target user's status | `invalidateAccessCache` |
| `transfer/accept` | Old owner + new owner | `invalidateAccessCache` × 2 |
| `businesses/[id]` PATCH | Business metadata (role-dependent display) | `invalidateAccessCacheForBusiness` |
| `businesses/[id]` DELETE | Business removed | `invalidateAccessCacheForBusiness` |
| `businesses/[id]/leave` | Member removed from business | `invalidateAccessCache` |
| `account/delete` POST | User deleted entirely | `invalidateAccessCacheForUser` |

### Session Cookie Cache (better-auth)

better-auth's `session.cookieCache` (5 min, in-memory per Lambda) avoids DB lookups on every request; verifyEmailVerified mutations bust the cache via `setCookieCache` in the handler.

### Limitations

- In-memory only — not shared across Vercel function instances
- Worst case: 60 seconds of stale access data / 5 minutes of stale session-cookie data on a different instance
- Best case (same instance): invalidation is immediate

---

## 3. Session Cache (Client-Side)

**Files:** `apps/web/src/hooks/useSessionCache.ts`, and the resource contexts that consume it.

Client-side `sessionStorage` caches reduce redundant API calls when navigating between pages. All keys go through a single registry so invalidation helpers can sweep them together.

### CRITICAL: Use the `CACHE_KEYS` Registry

Never hardcode a cache-key string at a call site. Every key lives in `CACHE_KEYS` in `apps/web/src/hooks/useSessionCache.ts`; adding a new cache means adding a new entry there first.

```typescript
// WRONG — ad-hoc string
const cache = createSessionCache<Product[]>(`products_cache_${businessId}`)

// CORRECT — scoped via the registry
import { scopedCache, CACHE_KEYS } from '@/hooks/useSessionCache'
const cache = scopedCache<Product[]>(CACHE_KEYS.PRODUCTS, businessId)
```

### Registry

Per-business keys (scoped via `scopedCache(key, businessId)`, which appends `_${businessId}`):

| Key | Data |
|-----|------|
| `CACHE_KEYS.PRODUCTS` | Products list (ProductsContext) |
| `CACHE_KEYS.PROVIDERS` | Providers list (ProvidersContext) |
| `CACHE_KEYS.ORDERS` | Orders list (OrdersContext) |
| `CACHE_KEYS.CATEGORIES` | Product categories (ProductSettingsContext) |
| `CACHE_KEYS.PRODUCT_SETTINGS` | `{ defaultCategoryId, sortPreference }` (ProductSettingsContext) |
| `CACHE_KEYS.PENDING_TRANSFER` | Outgoing transfer state for this business (`usePendingTransfer`) |

Cross-business keys (single global entry, no business suffix):

| Key | Data |
|-----|------|
| `CACHE_KEYS.BUSINESS_SHELL` | `Map<businessId, {name, role, ...}>` for instant business-shell paint |
| `CACHE_KEYS.HUB_BUSINESSES` | The list rendered on the hub home |

### Invalidation Helpers

```typescript
import { clearPerBusinessCaches, clearHubBusinessesCache } from '@/hooks/useSessionCache'

// One businessId — sweep every per-business cache in one call. Used by
// useDeleteBusiness, useLeaveBusiness, and the DELETE /auth/me flow.
clearPerBusinessCaches(businessId)

// Cross-business — called after any mutation that changes a business's
// visible metadata (name / icon / locale / type) or which businesses a
// user belongs to.
clearHubBusinessesCache()
```

`useUpdateBusiness` + `useDeleteBusiness` already call these.

---

## 4. Shared Resource Contexts

The three list resources + the product settings + sales / sales-sessions are all fetched once per business and shared across every page that consumes them. Mounting happens in `apps/web/src/routes/BusinessProvidersFromUrl.tsx`, which sits **outside** the `IonRouterOutlet` so providers stay mounted across tab switches and drill-downs. The matching `BusinessTabsLayout` (the `<IonTabs>` shell) is rendered as a child of this provider tree:

```tsx
// BusinessProvidersFromUrl: only mounts when the URL is `/:businessId/...`
<PageTransitionProvider>
  <IncomingTransferProvider>
    <BusinessProvider businessId={bid}>
      <PendingTransferProvider>
        <OrdersProvider key={`orders-${bid}`} businessId={bid}>
          <SalesSessionsProvider key={`sales-sessions-${bid}`} businessId={bid}>
            <SalesProvider key={`sales-${bid}`} businessId={bid}>
              <ProvidersProvider key={`providers-${bid}`} businessId={bid}>
                <ProductsProvider key={`products-${bid}`} businessId={bid}>
                  <ProductSettingsProvider key={`product-settings-${bid}`} businessId={bid}>
                    <ContentGuard>
                      <BusinessDataPreloader businessId={bid} />
                      {children /* <BusinessTabsLayout/> */}
                    </ContentGuard>
                  </ProductSettingsProvider>
                </ProductsProvider>
              </ProvidersProvider>
            </SalesProvider>
          </SalesSessionsProvider>
        </OrdersProvider>
      </PendingTransferProvider>
    </BusinessProvider>
  </IncomingTransferProvider>
</PageTransitionProvider>
```

Each provider:
1. Seeds its initial state from `sessionStorage` via the relevant `CACHE_KEYS.*` entry
2. Lazy-loads on first `ensureLoaded()` call
3. Stale-while-revalidate via a 30-second freshness window (see below)
4. Writes back to sessionStorage on every state change so the next paint is instant
5. Revalidates on tab-return (`visibilitychange` / window `focus`) via `useRevalidateOnFocus`

> `useProductSettings` was previously a standalone hook called independently by two separate consumers. That split into two independent copies of state; the provider above is the single source of truth now. Never `useProductSettings()` outside `ProductSettingsProvider` — it throws.

### Freshness Window (`apps/web/src/lib/freshness.ts`)

`STALE_AFTER_MS = 30_000`. Each context tracks a `lastFetchedAt: useRef<number | null>` that's set to `Date.now()` on every successful fetch. `ensureLoaded()` then becomes:

```typescript
const ensureLoaded = useCallback(async () => {
  if (inFlight.current) return inFlight.current
  if (isFresh(lastFetchedAt.current, Date.now())) return Promise.resolve()
  inFlight.current = fetchProducts()
  return isLoaded ? Promise.resolve() : inFlight.current
}, [isLoaded, fetchProducts])
```

- **No cache**: `isFresh` returns false (lastFetchedAt is null), fetch fires, awaited (consumers see `isLoading=true`).
- **Cache present, within 30s window**: returns immediately, no fetch.
- **Cache present, stale**: returns immediately with cached data AND kicks off a silent background refetch. New data swaps in atomically when the fetch lands.
- **Failed fetch**: `lastFetchedAt` stays at the previous value — a transient error doesn't invalidate cached data that was good 30s ago.

The 30s window is short enough that returning to a tab after a meaningful gap revalidates, long enough that flicking between tabs doesn't hammer the API. Tunable via the optional third argument to `isFresh`.

### Focus Revalidation (`apps/web/src/hooks/useRevalidateOnFocus.ts`)

Each context calls `useRevalidateOnFocus(ensureLoaded)` after defining `ensureLoaded`. When the tab/window becomes visible after being hidden (Cmd+Tab back, etc.), the hook fires the callback — debounced 5 seconds so back-and-forth alt-tabbing doesn't trigger a refetch storm. Routes through `ensureLoaded`, so the freshness window still applies; quick alt-tabs within 30s of the last fetch are no-ops.

`OrdersContext` wires focus revalidation to `ensureActiveLoaded` only, not the completed bucket — completed orders are a history view where surprise reordering would be jarring mid-scroll.

### Preloader (`apps/web/src/components/layout/BusinessDataPreloader.tsx`)

`<BusinessDataPreloader businessId={bid} />` is mounted inside the per-business provider tree (next to `ContentGuard`). On business entry it fires `ensureProductsLoaded()`, `ensureProvidersLoaded()`, and `ensureActiveLoaded()` in parallel without awaiting. By the time the user taps any tab, the data is already in flight or cached. Calls are idempotent — every consuming view also calls `ensureLoaded()` and `fetchDeduped()` collapses concurrent GETs to the same URL.

### In-Flight Dedup (`apps/web/src/lib/fetch.ts`)

`fetchDeduped` keeps a module-level `Map<url, Promise<Response>>` of currently-in-flight GET requests. A second concurrent call to the same URL gets the same promise back (cloned). Cleanup happens 100ms after the request resolves, just enough to catch true duplicates without holding stale entries.

This means the preloader and a page-level `ensureLoaded()` racing on first paint resolve to **one** network call, not three.

---

## 5. Context Value Memoization

Every context that exposes more than one or two fields wraps its `value` in `useMemo` with an exhaustive dep list. Without this, every provider re-render hands consumers a new object reference and fans out a full re-render across every `useContext` caller — meaningful because several contexts (the resource stores, PageTransitionContext) have very high consumer counts.

```typescript
const value = useMemo<Shape>(
  () => ({ a, b, c, d, ... }),
  [a, b, c, d, ...],
)
return <Ctx.Provider value={value}>{children}</Ctx.Provider>
```

Every callback passed in must be wrapped in `useCallback` — a naked arrow function in the value defeats the memo every render.

For contexts whose value comes straight from a hook return (`usePendingTransfer`, `useIncomingTransfer`), destructure the hook return into fields first, then memo on the fields — the hook returns a fresh object literal each render, but the fields themselves are stable (state + `useCallback`).

---

## 6. Bundle-Perf Patterns

### Lazy-load modals on heavy pages

Pages with many modals-closed-by-default (`ProductsTab`, `AccountPage`, `ManageTab`) use `React.lazy` per modal so the modal bundle + its transitive deps (framer-motion motion primitives, `bwip-js`, Lottie JSON) stay out of the initial page chunk:

```typescript
import { lazy, Suspense } from 'react'

const AddProductModal = lazy(() =>
  import('@/components/products/AddProductModal').then((m) => ({ default: m.AddProductModal })),
)

// In the page render:
{showAdd && (
  <Suspense fallback={null}>
    <AddProductModal isOpen={showAdd} onClose={() => setShowAdd(false)} />
  </Suspense>
)}
```

Vite's code splitter creates a separate chunk per `lazy()` import; modals only download when first opened.

### Lazy-import heavy third-party libs inside functions

`bwip-js` (~70 KB) is imported dynamically inside the functions that actually render a barcode / QR:

```typescript
// apps/web/src/lib/qr.ts
export async function generateInviteQRCode(code: string): Promise<string> {
  const { default: bwipjs } = await import('bwip-js/browser')
  // ...
}

// apps/web/src/lib/barcode-print.ts — async function, fire-and-forget callers
export async function printBarcodeLabel(opts: PrintOpts): Promise<void> {
  const { renderBarcodeSvg } = await import('./barcode-render')
  // ...
}
```

Callers are already `onClick` handlers or fire-and-forget, so the async signature is a drop-in.

### Dev-server gotcha: deps behind a lazy boundary need `optimizeDeps.include`

The two patterns above have a Vite **dev-only** side effect. Vite pre-bundles dependencies by scanning the module graph at startup, but it does **not** crawl into `React.lazy()` / `import()` boundaries. So a third-party package that is *only* reachable through a lazy-loaded modal or a dynamic `import()` is never in the startup optimize set. The first time the user opens that modal, Vite discovers the dep on-demand, triggers a re-optimization, and the in-flight request for the not-yet-bundled module fails with a **504 Gateway Timeout** — which surfaces in React as `Failed to fetch dynamically imported module: .../SomeModal.tsx`.

Fix: force-include any such package in `apps/web/vite.config.ts` so it is pre-bundled at boot:

```typescript
optimizeDeps: {
  // libphonenumber-js is only reachable through PhoneInput, which lives
  // behind the lazy-loaded EditProfileModal (and the register wizard).
  include: ['libphonenumber-js'],
},
```

Rule of thumb: **if you add a new npm dependency whose only importers sit behind a `lazy()` modal or a dynamic `import()`, add it to `optimizeDeps.include` in the same PR.**

When you hit this on a machine where the dep already existed, the cause is usually a stale cache or a leftover dev server, not the config. Recovery:

1. Kill any zombie dev servers — `ps aux | grep vite` often shows old `npm run dev` trees from prior sessions still holding a stale optimize-deps registry. Kill all of them.
2. Delete the optimize-deps cache: `rm -rf apps/web/node_modules/.vite/deps` (the active cache lives under the Vite project root, `apps/web/`, not the repo-root `node_modules/.vite`).
3. Restart `npm run dev`. Verify the dep is pre-bundled: it should appear in `apps/web/node_modules/.vite/deps/_metadata.json` and a request to `/node_modules/.vite/deps/<dep>.js` should return 200, not 504.

### Per-route bundle minimization

Each `IonPage` route (Hub, Account, Join, BusinessTabsLayout, Login, Register) can be code-split via React.lazy. Tab pages inside `BusinessTabsLayout` lazy-load on first navigation; once a tab is visited, IonRouterOutlet keeps it mounted (Section 9 below) so re-entry has no further cost.

### List lookups

For lists that render `.map(items)` and look up a secondary entity per row (e.g. category name for each product), build a `Map<id, entity>` via `useMemo` once instead of `array.find()` per row:

```tsx
const categoryNameById = useMemo(() => {
  const map = new Map<string, string>()
  for (const c of categories) map.set(c.id, c.name)
  return map
}, [categories])
```

---

## 7. Icon Upload Optimization

**File:** `apps/web/src/lib/storage-client.ts` (client) + `apps/api/src/lib/storage.ts` (server validation)

When uploading product icons, the file is converted to base64 for validation. Pass the pre-computed base64 to `uploadProductIcon` to avoid reading the file twice:

```typescript
const base64 = await fileToBase64(iconFile)
const { valid } = validateIconSize(base64)
if (!valid) {
  return errorResponse(ApiMessageCode.PRODUCT_ICON_TOO_LARGE, 400)
}
iconData = await uploadProductIcon(iconFile, productId, base64) // reuse base64
```

### Client-Side Compression

AI-generated icons are compressed client-side before upload. The target size stays under the server's 100 KB limit after base64 encoding (~33% overhead):

- Client compression target: **70 KB** (`apps/web/src/hooks/useAiProductPipeline.ts`)
- Server validation limit: **100 KB** (`MAX_ICON_SIZE` in `apps/web/src/lib/storage-client.ts`)

---

## 8. DB Round-Trip Discipline

Turso round trips are ~30 ms each. A few patterns to keep route handlers tight:

- **`.returning()` over UPDATE + SELECT.** Every PATCH that previously did an update + refetch now uses `.returning()`. An empty returning array doubles as the "wrong business / not found" check.
- **`db.batch([...])` for multi-statement writes.** Order-receive was the worst offender pre-cleanup: N items → 2N+1 round trips. Now 1 round trip regardless of N, and atomic.
- **Read from the session, not the DB.** `auth.api.getSession({ headers })` returns the user's email, language, emailVerified inline. Don't re-query `users` for those fields in route handlers.
- **Composite indexes on hot-path columns.** `business_users(userId, businessId)` is indexed as a composite — every business-scoped request hits this pair.
- **Defensive `LIMIT` on every list query.** 500 for products / orders / providers; 200 for categories; 100 for team / businesses list. Bounds bandwidth regardless of row count.

---

## 9. Persistent Tab Stack (IonTabs)

**Files:** `apps/web/src/routes/BusinessTabsLayout.tsx`, the four tab-page components in `apps/web/src/routes/tabs/`, and the drill-down pages reachable from manage.

The 4 business-context bottom-tab routes (`home`, `sales`, `products`, `manage`) and their drill-down children (`providers`, `team`, `providers/[providerId]`) are rendered by Ionic's `<IonTabs>` + `<IonRouterOutlet>`. Once a tab has been visited, **IonRouterOutlet keeps its `IonPage` mounted on a transform-translated layer** — switching tabs is a CSS visibility flip, not a React tree mount. We don't reimplement this; it's a property of Ionic's stack-based navigation primitives.

### What this gets us (without writing any code)

- **Instant tab switches** after first paint — no React mount, no `useEffect` reruns, no data refetch. Ionic moves the inactive tab off-axis and brings the active one on-axis with a transform.
- **Scroll preservation per tab** — Ionic preserves scroll position on the offscreen tab and restores it when that tab becomes active again.
- **Internal state preservation** — the products page's sub-`TabContainer`, expanded rows, search filter input, in-progress modal data — all survive tab switches because the React tree never unmounts.
- **"Back to where I was" feel after drill-down** — pushing into providers / team / provider-detail from the manage tab pushes onto that tab's stack. Going back unwinds to the previous IonPage in its prior state.

### Mount strategy

Each tab is its own `<Route>` rendering an `<IonPage>`. On first visit to a tab, `IonRouterOutlet` mounts it; on subsequent visits, it just toggles visibility. There's no idle-mount queue, no separate "TabShell" component, no scroll-position `Map` in app code — Ionic owns it.

`IonPage` itself uses `display: contents`-style layout when off-axis so it doesn't reflow content for inactive tabs.

### Drill-downs

Drill-downs (`/<biz>/providers`, `/<biz>/team`, `/<biz>/providers/[providerId]`) are pushed onto the active tab's stack via `useIonRouter().push()` or `<IonRouterLink>`. They render as new `IonPage` instances inside the same `IonRouterOutlet`. Native iOS-style slide-in on push, native peel-back gesture on swipe-from-left — both come from Ionic, no custom Framer Motion code.

### Switching businesses

The data providers in `BusinessProvidersFromUrl` are keyed on `businessId` (`<OrdersProvider key={`orders-${bid}`} businessId={bid}>`). Switching businesses remounts those providers, which clears all per-business state in one move.

### CSS contract

Each tab's `IonPage` is layout-isolated by Ionic — its content lives inside `IonContent`, which is the scroll container. Children that use `flex: 1` (`.page-content`, `.page-body`, `.empty-state-fill`) inherit the height chain from `IonContent`'s built-in flex layout. `IonContent` uses `--padding-top` / `--padding-bottom` CSS variables to handle the safe-area inset around the IonHeader and IonTabBar; you don't need to manually calculate offsets.

---

## 10. Service Worker (vite-plugin-pwa + Workbox)

**Files:** `apps/web/src/pwa/sw.ts`, `apps/web/vite.config.ts`, `apps/api/scripts/start-https.mjs`

The PWA uses [`vite-plugin-pwa`](https://vite-pwa-org.netlify.app) in `injectManifest` mode. The plugin generates the precache manifest and injects it into our hand-written Workbox SW source at `apps/web/src/pwa/sw.ts`. The output is a single `sw.js` served from the SPA root.

### Caching strategies

All non-`NetworkOnly` strategies are GET-only (`request.method === 'GET'`). Mutations (POST/PATCH/DELETE) always pass through to the network unchanged.

| URL pattern (GET only) | Strategy | Notes |
|------------------------|----------|-------|
| Build-time precache (`__WB_MANIFEST`) | Precache | SPA shell + JS/CSS chunks; content-hashed |
| Image destinations (`request.destination === 'image'`) | CacheFirst, 30d | Product / business icons (data-URLs are inline so this is mostly external icon assets) |
| `/api/*` | NetworkOnly | API responses are not cached at the SW layer; the per-context sessionStorage cache (Section 3) covers offline reads |
| SPA navigation (NavigationRoute, denylist `/^\/api\//`) | NetworkFirst, 3s timeout, 7d max | Online: fresh `index.html`; offline: last-cached shell. The SPA hydrates from sessionStorage and the hub becomes browseable. |

The 3s NetworkFirst timeout means: try the network, fall back to cache if no response in 3s. This gives the "fast on flaky wifi" feel.

### Dev/prod gating

The SW is **disabled in `vite dev`** via `devOptions: { enabled: false }` in the `VitePWA` config. The SW + dev HMR fight each other and stale chunks pin to the SW cache.

To verify SW behavior locally: from `apps/api/`, run `npm run start:local`. This builds the SPA + API together and serves the prod-style bundle over HTTPS via `apps/api/scripts/start-https.mjs` using the Tailscale dev certs (`apps/api/certificates/tailscale-dev.{key,crt}`). Required because `vite preview` doesn't accept an HTTPS flag, and PWA install on a real phone over Tailscale needs HTTPS on a real hostname.

### SW lifecycle

`self.skipWaiting()` on `install` + `clients.claim()` on `activate` — new SW activates immediately on next page load (no manual update prompt). For Kasero's mobile-first usage pattern (short sessions), this is the right tradeoff over a "reload to update" banner.

`vite-plugin-pwa` versions caches via build hash. Old caches are purged on activate. The transition from the previous Serwist setup uses `clients.claim()` so the new Workbox SW takes over on first reload.

---

## 11. Online/Offline Detection

**Files:** `apps/web/src/hooks/useOnlineStatus.ts`, `apps/web/src/components/layout/OfflineBadge.tsx`, `apps/web/src/lib/api-client.ts`

Two layers:

### Visual indicator (`<OfflineBadge/>`)

Intended to mount near the top of the tree (outside the IonTabs tree, so it stays fixed across navigation). Reads `useOnlineStatus()` (which subscribes to `online` / `offline` window events with a 500ms debounce against flicker on flaky connections). When offline, renders a slim banner at the top of the screen via `intl.formatMessage({ id: 'network.offline_banner' })`. The component exists at the path above; verify the host JSX still mounts it before relying on the visual indicator (it can drift out of `App.tsx` during refactors).

`useOnlineStatus` initializes from `navigator.onLine` on mount.

### Mutation envelope (`apiRequest` in `apps/web/src/lib/api-client.ts`)

`apiRequest` wraps the `fetch()` call in a try/catch. On `TypeError` matching `/Failed to fetch|NetworkError|Load failed/i` (Chrome/Firefox/Safari respectively), it rethrows as `new ApiError(0, { messageCode: 'OFFLINE_MUTATION_BLOCKED' })`. Other catch types (CORS, AbortError, etc.) rethrow unchanged.

Every API call in the codebase funnels through `apiRequest` (`apiPost`, `apiPatch`, `apiDelete`, `apiPostForm`, `apiPatchForm` are all thin wrappers). So all consumers get offline detection automatically. The `OFFLINE_MUTATION_BLOCKED` envelope code is in the `ApiMessageCode` union in `packages/shared/src/api-messages.ts` and translated via `useApiMessage` against `apiMessages.offline_mutation_blocked`.

For background GET revalidations (e.g., the contexts' `ensureLoaded` paths), the offline `ApiError` is caught by the context's existing try/catch and the cached data stays in place — no error surfaced to the user.

### Realtime push and focus refetch

Realtime push (`/api/realtime` SSE) propagates state changes to open tabs as they happen. Focus refetch via `useRevalidateOnFocus` (5s debounce, Section 4 above) is the backstop for pub/sub events dropped during a subscriber reconnect gap. On reconnect, the server emits `system.resync` (or replays missed stream entries), triggering `callAllRefetches()` — which is equivalent to every context calling `ensureLoaded()` at once. The 30s freshness window still applies; a reconnect that happens within 30s of the last fetch is a no-op.

The SSE endpoint is region-pinned (`preferredRegion = 'iad1'` in the route config) so all Lambda subscriber instances are co-located with the Upstash Redis replica — this keeps the Redis subscriber connection count bounded regardless of global traffic.

See `.claude/docs/realtime-system.md` for the full event taxonomy, publisher API, and client lifecycle.

---

## 12. Navigation Feedback

**Files:** `apps/web/src/contexts/page-transition-context.tsx`, `apps/web/src/components/layout/NavigationErrorNotice.tsx`

Ionic owns the visual feedback for tab switches and stack pushes (instant slide-in, native indicators) so we no longer need an "optimistic active-tab highlight" mechanism — the active tab updates synchronously on tap as Ionic commits the route. What stays is the **navigation error notice** for genuine load failures.

### Error notice (`<NavigationErrorNotice/>`)

Mounted in `App.tsx` at z-50. Reads `navigationError` from `usePageTransition()` and renders a transient bar at the top of the screen via `intl.formatMessage({ id: 'navigation.<key>' })`. Auto-clears after 4 seconds. The state holds a translation **key**, not a translated string, so if the user changes language mid-session the notice reflects the new language.

`PageTransitionContext` exposes a `reportNavigationError(key)` method that any code path can call when it detects a failed navigation (e.g., a chunk load failure caught by a React error boundary, an offline-blocked mutation that was triggered from a navigation handler). The 5-second `pendingHref` safety net that previously polled for pathname-catch-up is gone — Ionic's router doesn't have a "still loading" intermediate state to wait on.
