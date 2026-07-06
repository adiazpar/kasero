# Realtime Implementation Reference

> **Read this before touching any realtime code.** It is the source of truth for the AS-IMPLEMENTED state of the realtime subsystem, including every architectural decision that was tried-and-rejected during the original implementation. The earlier `.claude/docs/realtime-system.md` describes the design intent; this document describes what actually shipped and why several pieces of it look the way they do.
>
> **For agents:** if a piece of code looks redundant, over-engineered, or "wrong" — read the corresponding section below FIRST. Most non-obvious choices here exist because the obvious version was tried and broke production. Reverting them silently re-creates the original bug.

---

## 1. Coverage today

### Domains wired end-to-end

| Domain | Routes that publish | Refetch key | Entity-event type |
|---|---|---|---|
| Team management | invite/join, businesses/[id]/users/{remove,change-role,toggle-status}, businesses/[id]/invite/{create,regenerate,delete} | `team`, `invites` | `team-member`, `invite` |
| Business lifecycle | businesses/create, businesses/[id] (PATCH/DELETE), transfer/accept | `business`, `businesses-list` | — |
| Profile | account/change-email confirm, better-auth update-user (`after` hook) | `profile` | — |
| Products + inventory | businesses/[id]/products (POST), products/[id] (PATCH/DELETE), products/[id]/stock (PATCH), product-settings (PATCH) | `products`, `product-settings` | `product` |
| Categories | categories (POST), categories/[id] (PATCH/DELETE), categories/reorder | `categories` | `category` |
| Sales / sessions | sales (POST), sales/[id]/void (POST), sales-sessions/{open,close} | `sales`, `sales-sessions` | `sale`, `sales-session` |
| Inventory adjustments | products/[id]/stock (PATCH) | `inventory-adjustments` | — |
| Expenses | expenses (POST/PATCH/DELETE), expense-categories (POST/PATCH/DELETE) | `expenses`, `expense-categories` | `expense`, `expense-category` |
| Subscription (Kasero Pro) | businesses/[id]/subscription/redeem (POST), subscription/verify-purchase (POST) — both publish `business.updated fields:['plan']`, no new event type | `business` (also refreshes `useSubscription` via the same key) | — |

### Detail modals wired with `useDismissOnDelete` / `useResyncOnUpdate`

- `MemberModal` — `team-member`, dismiss-on-delete
- `InviteModal` — `invite`, dismiss-on-delete (gains `inviteId` prop from `useTeamManagement().generatedCodeId`)
- `EditProductModal` — `product`, dismiss-on-delete
- `ProductInfoDrawer` — `product`, dismiss-on-delete + resync-on-update
- `SessionSalesList` — registers its own `refetch` under `'sales'` (it's a list view, not a per-entity modal; included here because it's a sneaky case where the component fetches its own data outside any context)

### Domains deliberately NOT realtime

- Anything `aggregate`/`summary`/derived (GET-only by design)
- Account modals (only the user themselves changes their own account)
- Multi-step add/edit wizards before an entity exists

---

## 2. Critical decisions (DO NOT REVERT)

Every item here was tried the other way during the original build, broke prod, and was rolled back. Re-introducing the "obvious" alternative re-creates a known bug.

### 2.1 Echo suppression: NOT on `callRefetch`, YES on entity-event emits

`apps/web/src/lib/realtime/handlers.ts` computes `isSelfEcho` at the top of `dispatchRealtimeEvent`:

```ts
const isSelfEcho = 'originDeviceId' in event && event.originDeviceId === ctx.ownDeviceId
```

`callRefetch(...)` calls are **always** invoked, including on the publishing device. Reason: Kasero's existing mutation flows do not optimistically patch local state — they rely on a follow-up refetch. Suppressing the echo means the publishing device was the LAST one to see its own change (caught only by `useRevalidateOnFocus` at the 5s focus debounce). Symptom of the original bug: removing a team member made the OTHER device's list update instantly while the OWNER's list stayed stale for 15+ seconds.

`emit*` calls (`emitEntityDeleted`, `emitEntityUpdated`) ARE guarded by `if (!isSelfEcho)`. Reason: the publishing device's UI is already mid-transition for the action (e.g., showing a "Product deleted!" success modal). Echoing the entity-deleted event back to that device prematurely dismisses the success modal. Original symptom: clicking Delete dismissed the success animation immediately on the publisher.

**Rule: refetches always fire on all devices. Modal lifecycle effects only fire on remote devices.**

### 2.2 SSE frames are unnamed (no `event:` field)

The SSE route in `apps/api/src/app/api/realtime/route.ts` emits frames as:

```
id: <streamId?>\ndata: <json>\n\n
```

NOT:

```
event: <type>\nid: <streamId?>\ndata: <json>\n\n
```

The client's `RealtimeProvider` uses a single `es.onmessage = onMessage` handler. The dispatch logic switches on `payload.type` from the JSON, NOT on the event name.

**Why:** browser `EventSource` only fires `onmessage` for default-typed events. Named events require explicit `addEventListener(type, handler)` per name. The original implementation kept a hard-coded `NAMED_EVENT_TYPES` array that mirrored the union. Adding a new event type required updating the array — and the product events were missed, so they arrived on the wire but no listener fired. Cross-device product create lagged 15s (focus refetch).

**Rule: never add an `event:` line to SSE frames. Never add per-type `addEventListener` calls in `RealtimeProvider`.**

### 2.3 Heartbeat interval MUST NOT be `unref()`'d

In the SSE route, the heartbeat:

```ts
const hb = setInterval(() => safeEnqueue(`:hb\n\n`), 15_000)
cleanupFns.push(() => clearInterval(hb))
```

There is NO `hb.unref()` call. Reason: Vercel Fluid Compute uses the event loop's ref state to decide whether the function is alive. After the ReadableStream's `start()` callback returns, the heartbeat interval is the only thing keeping the loop ref'd. If we `unref()` it, the function drains immediately, EventSource sees a 0.1 kB completed response, browser reconnects every 350ms, blows past rate limit, 429 storm.

`maxDuration: 300` caps the process lifetime cleanly anyway.

**Rule: leave `setInterval(...)` ref'd. The HTTP response stream is owned by the runtime, not by your code.**

### 2.4 Service worker fetch matcher excludes `/api/realtime` directly

In `apps/web/src/pwa/sw.ts`:

```ts
registerRoute(
  new Route(
    ({ url }) => url.pathname.startsWith('/api/') && url.pathname !== '/api/realtime',
    new NetworkOnly(),
  ),
)
```

NOT an `addEventListener('fetch', ...)` early return. The original "bypass" listener returned early, which DOES NOT prevent subsequent Workbox `registerRoute` handlers from claiming the request. The `/api/*` `NetworkOnly` route still matched `/api/realtime`, called `fetch()`, buffered the text/event-stream body, and EventSource saw a 0.2 kB "complete" response. Reconnect storm.

Excluding `/api/realtime` from the matcher itself means no SW route claims it. Browser fetches direct to origin. Network tab shows `Initiator: Other`, not `sw.js:1`.

**Rule: if you add another long-lived endpoint, exclude it from the matcher, don't try to bypass via fetch event listener.**

### 2.5 `RealtimeProvider`'s open/close `useEffect` MUST NOT depend on `openConnection`

In `apps/web/src/contexts/realtime-context.tsx`:

```ts
useEffect(() => {
  if (!isAuthenticated) { /* cleanup */ return }
  openConnectionRef.current?.()  // ← via ref
  return () => { /* close esRef */ }
}, [isAuthenticated, activeBusinessId])  // ← NOT [openConnection]
```

`openConnection` is a `useCallback` with deps `[isAuthenticated, user, ...]`. The first `system.resync` event from the server triggers `callAllRefetches` → `refreshUser` updates the user reference → `openConnection` re-creates → `useEffect` re-runs → closes and reopens EventSource → server sends new `system.resync` → infinite loop at ~350ms/cycle. Storms the 429 rate limit.

Reading `openConnection` via `openConnectionRef.current` decouples the effect from the callback's identity. The latest body is always reached at re-run time.

**Rule: the open/close effect depends only on `isAuthenticated` and `activeBusinessId`. Never add the callback itself to its dep array.**

### 2.6 `BusinessProvider` MUST call `setActiveBusinessId(businessId)`

In `apps/web/src/contexts/business-context.tsx`:

```ts
const { setActiveBusinessId } = useRealtime()
useEffect(() => {
  setActiveBusinessId(businessId ?? null)
  return () => setActiveBusinessId(null)
}, [businessId, setActiveBusinessId])
```

Without this, the EventSource opens with only `?deviceId=...`, the SSE route subscribes only to `user:{userId}`, and ANY event on `business:{id}` channel never reaches the client. Team/invite/business events are silently dropped, focus refetch is the only fallback.

**Rule: `setActiveBusinessId` is called by `BusinessProvider`'s lifecycle, not by route components.**

### 2.7 DELETE method exempt from Content-Length enforcement

In `apps/api/src/lib/api-middleware.ts` (both `withAuth` and `withBusinessAuth`):

```ts
if (
  request.method !== 'GET' &&
  request.method !== 'HEAD' &&
  request.method !== 'DELETE'  // ← exempt
) {
  const oversize = enforceMaxContentLength(request, cap)
  if (oversize) return oversize
}
```

iOS Safari and iOS PWAs omit `Content-Length` on DELETE (semantically bodyless). Without this exemption, every DELETE from those clients 411s with `REQUEST_LENGTH_REQUIRED`.

**Rule: don't restore the Content-Length check on DELETE. Body-size enforcement only applies to POST/PATCH/PUT.**

### 2.8 Realtime SSE rate limit is 300/min/user

In `apps/api/src/lib/rate-limit.ts`:

```ts
realtimeConnect: { limit: 300, windowSeconds: 60 },
```

Used by the SSE route via `checkRateLimit(\`realtime:${session.user.id}\`, RateLimits.realtimeConnect)`.

The limit MUST be far above the browser's worst-case auto-retry cadence (3s for EventSource). If a transient bug causes the SSE stream to close immediately, EventSource retries every 3s = 20/min. A tight limit creates a permanent-lockout trap because EventSource has no JS-controllable backoff — each retry keeps the sliding window saturated.

**Rule: don't lower this below 200/min. It's tuned for retry-storm safety, not for steady-state load.**

### 2.9 Stock cascade pattern: single event, dual client refetch

When a route mutates `products.stock` as a side effect (sales create, inventory adjustment, category delete), the server fires ONE domain-level event:

- `sale.created` → client: `callRefetch('sales')` + `callRefetch('products')`
- `inventory-adjustment.created` → client: `callRefetch('inventory-adjustments')` + `callRefetch('products')`
- `category.deleted` → client: `callRefetch('categories')` + `callRefetch('products')`

**Not** N `product.updated fields:['stock']` events per affected product. Two extra GETs on receivers is cheaper than N pub/sub fan-outs.

**Rule: if you add another mutation that cascades to other entities, prefer one event with a multi-key client-side refetch.**

### 2.10 Notes (and similar sub-entities) collapse under the parent's update event

When a route mutates a sub-entity that the client always views as part of its parent (e.g. sale line items that are always rendered inside the parent sale), those routes publish the PARENT's update event with a `fields` hint rather than creating a dedicated sub-entity event type. For example, a hypothetical sale-items rewrite would publish:

```ts
publishToBusiness(businessId, { type: 'sale.updated', saleId, fields: ['items'] })
```

NOT a dedicated `sale-item.*` event.

**Rule: sub-entities that the client always views as part of their parent share the parent's event. Don't multiply event types for internal data shape.**

### 2.11 `UPSTASH_REDIS_URL` is Vercel-only

This env var is set in Vercel Production + Preview ONLY, never in local `.env.local`. Local dev uses the in-memory backend (`apps/api/src/lib/realtime/in-memory-backend.ts`) which activates when `UPSTASH_REDIS_URL` is absent and `VERCEL_ENV !== 'production'`.

**Why:** Upstash pub/sub is broadcast. A `npm run dev` publish from your laptop would fan out to every connected prod client. The in-memory backend isolates dev from prod.

The canonical Vercel value is mirrored in Bitwarden's `Kasero — Vercel project envs` secure note.

**Rule: never add `UPSTASH_REDIS_URL` to local `.env.local`. The production gate in `redis.ts` (line ~50) raises `RealtimeUnavailableError` on Vercel runtime without the credential.**

---

## 3. Architecture (as-implemented)

### 3.1 Server-side

```
┌──────────────────────────────────────────────────────────────────┐
│ Vercel Fluid Compute instance (region-pinned to iad1)            │
│                                                                  │
│  apps/api/src/app/api/realtime/route.ts                          │
│    GET handler                                                   │
│    ├ better-auth session check                                   │
│    ├ Sec-Fetch-Site CSRF guard                                   │
│    ├ requireBusinessAccessForRealtime (30s in-instance cache)    │
│    ├ rate-limit (RateLimits.realtimeConnect, 300/min/user)       │
│    ├ Last-Event-ID replay (XREAD via subscriber.xread)           │
│    │   OR first-connect tip → emit system.resync with id         │
│    ├ broker.subscribe(user:{id}) + (business:{id} if present)    │
│    ├ heartbeat: setInterval(15_000)  ←  MUST be ref'd            │
│    └ on abort: clearInterval + unsubscribe all + close stream    │
│                                                                  │
│  apps/api/src/lib/realtime/                                      │
│    broker.ts                                                     │
│      module-scope singleton (globalThis-keyed for HMR safety)    │
│      one ioredis subscriber connection                           │
│      refcounted SUBSCRIBE / UNSUBSCRIBE per channel              │
│      EventEmitter fan-out to all SSE listeners                   │
│      resync flow: on subscriber 'end' → 'ready' →                │
│        re-issue SUBSCRIBE + emit synthetic __resync__ event      │
│        (translated by SSE handler to system.resync frame)        │
│      30s liveness watchdog: subscriber.ping(), reconnect on fail │
│                                                                  │
│    publisher.ts                                                  │
│      publishToBusiness(businessId, event, originDeviceId?)       │
│      publishToUser(userId, event, originDeviceId?)               │
│      publishCriticalToUser(userId, event, originDeviceId?)       │
│        ↑ pipelined MULTI: XADD MAXLEN + PEXPIRE + PUBLISH        │
│      publishBatchedToUsers(userIds, event, originDeviceId?)      │
│                                                                  │
│    redis.ts                                                      │
│      Dual backend: ioredis (Vercel) | in-memory (dev)            │
│      Lazy construction — no module-eval connections              │
│      getSubscriber(): RealtimeSubscriber                         │
│      getPublisher(): RealtimePublisher                           │
│      Production gate throws if URL missing on Vercel             │
│                                                                  │
│    streams.ts                                                    │
│      readUserStreamSince(userId, lastEventId): ReplayEntry[]     │
│      getUserStreamTip(userId): string  // '0-0' on empty         │
│      Uses subscriber.xread / getStreamTipId (the wrapper         │
│      internally calls into the publisher connection)             │
│                                                                  │
│    in-memory-backend.ts                                          │
│      Process-local EventEmitter pub/sub + Map-backed streams     │
│      MAXLEN exact, PEXPIRE lazy eviction                         │
│      Same interface as ioredis wrapper                           │
│                                                                  │
│    entity-events not on server — client-only bus                 │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
        │                                          ▲
        │ ioredis subscriber (1 connection)        │
        │ ioredis publisher  (1 connection)        │
        ▼                                          │
   Upstash Redis (production)                      │
   pub/sub channels: business:{id}, user:{id}      │
   streams: stream:user:{id}                       │
        │                                          │
        └──────────────────────────────────────────┘
```

**Connection count per Vercel instance: exactly 2** (subscriber + publisher). This is the architectural minimum given Redis pub/sub semantics — once an ioredis connection enters subscribe-mode, it cannot issue arbitrary commands, so XREAD/XADD/PUBLISH need a separate connection. The wrapper structure makes the publisher connection serve both `publisher.publish(...)` calls AND `subscriber.xread(...)` calls (which internally route through the publisher's raw client).

### 3.2 Client-side

```
┌──────────────────────────────────────────────────────────────────┐
│ apps/web/src/contexts/realtime-context.tsx (RealtimeProvider)    │
│   Mounted inside AuthProvider, inside AuthGateProvider           │
│   Owns ONE EventSource for the device                            │
│   Opens on isAuthenticated + activeBusinessId                    │
│   Debounces business-switch close-and-reopen by 250ms            │
│   45-second client-side watchdog (no message for 45s → reopen)   │
│   3-strike-error close (consecutive errors with no intervening   │
│     open → routeToLogin)                                         │
│   Exposes:                                                       │
│     setActiveBusinessId(id)        ← called by BusinessProvider  │
│     revokeBusinessContext(id,reason) ← called by handlers        │
│                                                                  │
│  message handler:                                                │
│     onMessage → JSON.parse → dispatchRealtimeEvent(event, ctx)   │
│     ctx = { ownDeviceId, revokeBusinessContext,                  │
│             routeToLogin, showToast }                            │
│                                                                  │
└─────────────────────────┬────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ apps/web/src/lib/realtime/                                       │
│   handlers.ts                                                    │
│     dispatchRealtimeEvent(event, ctx)                            │
│       compute isSelfEcho = originDeviceId === ownDeviceId        │
│       switch on event.type (EXHAUSTIVE — TS guards drift)        │
│         every case: callRefetch(...) unconditionally             │
│         deletion / update cases: if (!isSelfEcho) emit*(...)     │
│         security events: ctx.revokeBusinessContext / routeToLogin│
│         system.error: ctx.showToast(messageId)                   │
│         system.resync: callAllRefetches()                        │
│                                                                  │
│   refetch-registry.ts                                            │
│     registerRefetch(key, fn) → unregister                        │
│     callRefetch(key) — leading-edge 100ms debounced per key      │
│     callAllRefetches() — NOT debounced (system.resync usage)     │
│     Map<RefetchKey, Set<Listener>> — multiple subscribers per key│
│                                                                  │
│   entity-events.ts                                               │
│     emitEntityDeleted(type, id) + subscribeToEntityDelete(...)   │
│     emitEntityUpdated(type, id) + subscribeToEntityUpdate(...)   │
│     Separate Maps for delete vs update                           │
│     Snapshot iteration ([...set]) so self-unsub during emit OK   │
│                                                                  │
│   device-id.ts                                                   │
│     getDeviceId(): localStorage-backed UUID, SSR-safe            │
│                                                                  │
│   api-client-header.ts                                           │
│     injects X-Device-Id on every apiRequest                      │
│                                                                  │
└─────────────────────────┬────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ apps/web/src/hooks/                                              │
│   useDismissOnDelete(type, id, dismissFn)                        │
│     subscribes to delete bus, calls dismissFn when id matches    │
│   useResyncOnUpdate(type, id, onUpdate)                          │
│     subscribes to update bus, calls onUpdate when id matches     │
│                                                                  │
│ Consumed by:                                                     │
│   MemberModal, InviteModal, EditProductModal, ProductInfoDrawer  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 3.3 Service worker

`apps/web/src/pwa/sw.ts`:
- `/api/*` `NetworkOnly` route excludes `/api/realtime` (see §2.4)
- Top-level `registerSW({ onNeedRefresh })` in `main.tsx` shows the "New version available — Reload" banner (`SWUpdateBanner.tsx`)
- New SWs activate via `self.skipWaiting()` + `self.clients.claim()` in `sw.ts`

---

## 4. The "add a new realtime domain" cookbook

Step-by-step recipe. Every existing domain followed this exactly.

### 4.1 Server side

1. **Audit the routes.** Find every mutation handler (POST / PATCH / DELETE) under `apps/api/src/app/api/businesses/[businessId]/<domain>/`. Skip GET. Skip routes that return aggregations or read-derived data.

2. **For each mutation handler:**
   ```ts
   // Top of handler:
   const originDeviceId = getOriginDeviceId(request)

   // ... existing DB work ...

   // AFTER the DB commit, BEFORE successResponse(...):
   await publishToBusiness(
     access.businessId,
     { type: '<domain>.created', <entity>Id: newId },
     originDeviceId,
   )

   return successResponse({...})
   ```
   - Publishes happen AFTER the DB commit succeeds. Never inside a transaction that may roll back.
   - Non-critical events use `publishToBusiness` (fail-open). Only security-critical events use `publishCriticalToUser` (fail-closed, returns 503 on Upstash blip).
   - PATCH routes should compute `fields: changedFields[]` from the actual payload (`'name' in updateData ? ...`).
   - If `changedFields.length === 0`, skip the publish — empty PATCH payloads shouldn't trigger refetches.

3. **Sub-route gotcha.** If your domain has sub-routes (e.g. line items, embedded sub-records), publish the PARENT's `domain.updated fields:['<sub-token>']` rather than creating sub-entity events. See §2.10.

### 4.2 Shared types

In `packages/shared/src/realtime/types.ts`, add to `BusinessRealtimeEvent`:

```ts
| ({ type: '<domain>.created'; <entity>Id: string } & WithOrigin)
| ({
    type: '<domain>.updated'
    <entity>Id: string
    fields: Array<'name' | 'price' | ...>  // ← enumerate actual mutable columns
  } & WithOrigin)
| ({ type: '<domain>.deleted'; <entity>Id: string } & WithOrigin)
```

Rebuild shared so apps/api and apps/web pick up the new types:
```bash
npx tsc --build packages/shared
```

### 4.3 Client side

1. **Add a `RefetchKey`** in `apps/web/src/lib/realtime/refetch-registry.ts`:
   ```ts
   export type RefetchKey =
     | ...existing...
     | '<domain>'
   ```

2. **Add cases to the exhaustive switch** in `apps/web/src/lib/realtime/handlers.ts`:
   ```ts
   case '<domain>.created':
     callRefetch('<domain>')
     return

   case '<domain>.updated':
     callRefetch('<domain>')
     if (!isSelfEcho) emitEntityUpdated('<entity-type>', event.<entity>Id)
     return

   case '<domain>.deleted':
     callRefetch('<domain>')
     if (!isSelfEcho) emitEntityDeleted('<entity-type>', event.<entity>Id)
     return
   ```
   TypeScript exhaustiveness will fail compile until every variant has a case. That's the safety net.

3. **Add to `EntityType`** in `apps/web/src/lib/realtime/entity-events.ts`:
   ```ts
   export type EntityType = ... | '<entity-type>'
   ```

4. **Register the context's refetch.** Find the context that owns the list state for your domain (e.g., `apps/web/src/contexts/<domain>-context.tsx`). Add:
   ```ts
   useEffect(() => registerRefetch('<domain>', refetch), [refetch])
   ```
   Where `refetch` is a stable `useCallback`. If the context doesn't already expose a refetch, refactor it to do so first.

5. **Wire detail modals.** For each modal that shows a single existing entity by id:
   ```tsx
   useDismissOnDelete('<entity-type>', entity?.id ?? null, stableDismiss)
   useResyncOnUpdate('<entity-type>', entity?.id ?? null, () => {
     const fresh = listFromContext.find(e => e.id === entity?.id)
     if (fresh) setSnapshot(fresh)
   })
   ```
   - Use `useCallback` for `dismiss` so the hook's effect dep stays stable.
   - SKIP add-flow modals (no stable entity id yet).
   - SKIP confirm-delete dialogs (close themselves on confirm).
   - SKIP list/drilldown views (covered by context refetch).
   - List components that fetch their own data outside any context (rare; `SessionSalesList` is an example) need to call `registerRefetch` themselves.

### 4.4 Tests

- For each modified route: add or extend a route test that mocks the publisher and asserts the publish call shape. Use `vi.mock('@/lib/realtime', () => ({ publishToBusiness: vi.fn(), getOriginDeviceId: vi.fn() }))` and verify the mock was called with the right args.
- Update `apps/api/src/test/realtime-types.test.ts` exhaustiveness switch — must cover every new event type.
- Update `apps/web/src/lib/realtime/handlers.test.ts` with dispatch assertions for the new cases.

### 4.5 Quality gates

```bash
cd /Users/adiaz/irvin
npm run test:run --workspace=apps/api    # all pass
npm run test:run --workspace=apps/web    # all pass
cd apps/api && npx tsc --noEmit          # clean (modulo pre-existing transfer/initiate errors)
cd apps/web && npx tsc --noEmit          # clean
npm run lint                              # accept 4 pre-existing lint issues; no NEW ones
npm run build                             # both apps build clean
```

Then push to `main`. Vercel auto-deploys.

---

## 5. Gotchas and how to recognize them

When you see a symptom like the ones below, the cause is likely the corresponding pattern. Each entry references the §2 critical-decision section that exists because we already fixed it.

| Symptom | Pattern | Reference |
|---|---|---|
| Publishing device's list doesn't update — only the OTHER device updates | Echo suppression was added to `callRefetch` | §2.1 |
| New event types arrive on the wire but no client listener fires (15s lag to focus refetch) | `event:` header added to SSE frames OR `NAMED_EVENT_TYPES` array reintroduced | §2.2 |
| Endless reconnect cycle, ~350ms per cycle, 429 storm | Heartbeat was `.unref()`'d, OR SW intercepts via fetch-event return-early pattern | §2.3, §2.4 |
| `system.resync` triggers callAllRefetches which triggers re-render which closes EventSource which gets new system.resync... infinite loop | `RealtimeProvider`'s open/close useEffect depends on `openConnection` | §2.5 |
| Team/business/product events never reach the client; only user-channel events work | `BusinessProvider` not calling `setActiveBusinessId` | §2.6 |
| Every DELETE from iOS returns 411 `REQUEST_LENGTH_REQUIRED` | Content-Length enforcement applied to DELETE | §2.7 |
| 429 storm that persists even after closing the tab — won't recover for minutes | Realtime rate limit set lower than EventSource auto-retry can saturate | §2.8 |
| Sale rung up on Device A doesn't update the active-session view on Device B until close/reopen | Component fetches its own data without registering with the refetch registry | `SessionSalesList` story |
| Publishing device's "Product deleted!" success modal dismisses prematurely | `emit*` calls not echo-suppressed | §2.1 |
| Detail modal stays open showing a now-deleted entity | Missing `useDismissOnDelete` wire on that modal | cookbook §4.3.5 |
| Detail modal stays open showing pre-edit data | Missing `useResyncOnUpdate` wire on that modal | cookbook §4.3.5 |
| Dev publishes reach prod subscribers / iOS PWA loops in failed state | `UPSTASH_REDIS_URL` set in local `.env.local` | §2.11 |
| Local dev `npm run dev` fails to boot with "RealtimeUnavailableError" | Production gate accidentally triggering in dev (check `VERCEL_ENV` is not set locally) | §2.11 |

---

## 6. File reference (current as of last sweep)

### Server (apps/api/src/lib/realtime/)
- `errors.ts` — `RealtimeUnavailableError`
- `redis.ts` — dual-backend factory; lazy; 2 connections per instance
- `in-memory-backend.ts` — dev backend; same interface as ioredis wrapper
- `broker.ts` — globalThis-keyed singleton; refcount + resync + watchdog
- `streams.ts` — `readUserStreamSince` + `getUserStreamTip`
- `publisher.ts` — `publishToBusiness`/`User`/`CriticalToUser`/`BatchedToUsers`
- `origin-device-id.ts` — header extraction helper
- `index.ts` — barrel

### Server route
- `apps/api/src/app/api/realtime/route.ts` — SSE GET endpoint; `runtime = 'nodejs'`, `maxDuration = 300`, `preferredRegion = 'iad1'`

### Server-side authz
- `apps/api/src/lib/business-auth.ts` — `requireBusinessAccessForRealtime` (30s per-instance cache)
- `apps/api/src/lib/auth.ts` — better-auth `after` hook fires `profile.updated`

### Shared types
- `packages/shared/src/realtime/types.ts` — discriminated union
- `packages/shared/src/realtime/index.ts` — barrel
- `packages/shared/src/api-messages.ts` — `REALTIME_UNAVAILABLE`, `REALTIME_PUBLISH_UNAVAILABLE`

### Client realtime layer
- `apps/web/src/contexts/realtime-context.tsx` — RealtimeProvider
- `apps/web/src/lib/realtime/refetch-registry.ts`
- `apps/web/src/lib/realtime/entity-events.ts`
- `apps/web/src/lib/realtime/handlers.ts`
- `apps/web/src/lib/realtime/device-id.ts`
- `apps/web/src/hooks/useDismissOnDelete.ts`
- `apps/web/src/hooks/useResyncOnUpdate.ts`

### Service worker
- `apps/web/src/pwa/sw.ts` — fetch matcher excludes `/api/realtime`
- `apps/web/src/main.tsx` — `registerSW({ onNeedRefresh })` hook
- `apps/web/src/components/SWUpdateBanner.tsx` — "New version available" UI

### Contexts that register refetches
- `business-context.tsx` → `'business'`
- `auth-context.tsx` → `'profile'`
- `apps/web/src/components/hub/HubHome.tsx` → `'businesses-list'`
- `apps/web/src/hooks/useTeamManagement.ts` → `'team'` + `'invites'`
- `products-context.tsx` → `'products'`
- `product-settings-context.tsx` → `'product-settings'` + `'categories'`
- `sales-context.tsx` → `'sales'`
- `sales-sessions-context.tsx` → `'sales-sessions'`
- `apps/web/src/components/sales/session-views/SessionSalesList.tsx` → `'sales'` (component-level, special case)

### Detail modals wired
- `apps/web/src/components/team/MemberModal.tsx`
- `apps/web/src/components/team/InviteModal.tsx`
- `apps/web/src/components/products/EditProductModal.tsx`
- `apps/web/src/components/products/ProductInfoDrawer.tsx`

### Locale keys (in every file under `apps/web/src/i18n/messages/`)
- `session_revoked_removed` + `_no_name` fallback
- `session_revoked_business_deleted` + `_no_name` fallback
- `session_revoked_ownership_transferred` + `_no_name` fallback
- `realtime_disconnected_banner`
- `apiMessages.realtime_unavailable`
- `apiMessages.realtime_publish_unavailable`
- `network.sw_update_available`
- `network.sw_update_reload`

---

## 7. Open / deferred items

Documented for completeness; none are blocking.

1. **Edit-form clobbering policy.** When user A is mid-editing `EditProductModal` (with dirty fields) and user B saves an edit on the same product, A's modal currently silently auto-syncs. Aggressive option: silent resync when no fields are dirty, banner when dirty. Safe option: always banner. Pick when this surfaces as real user pain.

2. **Phase 11 — integration tests + Upstash load test.** Would empirically verify the connection cap headroom under sustained load. Not blocking until you actually approach scale.

3. **Lint cleanup.** 2 `no-this-alias` errors in `in-memory-backend.ts` and 2 `no-explicit-any` warnings in `redis.ts`. Pre-existing; cosmetic; `npm run lint` exits non-zero because of these.

4. **One stash entry** from the original implementation may be lingering in your local git. `git stash list` to verify; `git stash drop` if it's no longer needed.

---

## 8. When to update THIS document

Update this file when:
- You add a new event type → update §1 coverage table and §6 file reference
- You wire a new context refetch → update §6
- You wire a new detail modal → update §1 + §6
- You discover a new gotcha that broke prod → add it to §5 and a corresponding §2 decision if the fix is non-obvious
- You change one of the §2 critical decisions → document why the prior decision no longer holds

The earlier `.claude/docs/realtime-system.md` documents design intent. This file documents what actually shipped and why several pieces look the way they do. Both are valid; this one is more current.
