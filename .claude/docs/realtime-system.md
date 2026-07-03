# Realtime System Guide

Server-Sent Events over Upstash Redis pub/sub + Streams. Delivers UI-hint refreshes (pub/sub) and security-critical session events (streams) to every open browser tab in real time.

**Read this before**: adding a publish call to an API route, defining a new event type, adding an SSE consumer, or working with the `EventSource` lifecycle in the client.

---

## Table of Contents

1. [Overview](#overview)
2. [Transport](#transport)
3. [Channel model](#channel-model)
4. [Event taxonomy](#event-taxonomy)
5. [Publisher API](#publisher-api)
6. [Adding a new event type](#adding-a-new-event-type)
7. [Adding a publish to an existing route](#adding-a-publish-to-an-existing-route)
8. [Client lifecycle](#client-lifecycle)
9. [Service worker note](#service-worker-note)
10. [Dev backend](#dev-backend)
11. [Testing](#testing)
12. [Production deployment](#production-deployment)

---

## Overview

The realtime subsystem propagates state changes from API routes to open browser tabs without polling. Every mutation that changes shared state (team membership, business metadata, session revocation) fires a publish after the DB write. Open clients receive the event and trigger the appropriate refetch or navigation, so the UI stays consistent across devices and teammates.

Two delivery tiers:

- **Pub/sub (missable)** — fire-and-forget. The server publishes after the DB commit; connected clients receive the event immediately. If no client is subscribed, the event is dropped. Focus refetch (`useRevalidateOnFocus`) acts as the backstop: if a subscriber missed events during a reconnect gap, the 45s client watchdog forces a reconnect which triggers `system.resync`, causing all contexts to refetch.
- **Streams (survivable)** — critical events are appended to a per-user Redis stream (capped at 100 entries, 90-day TTL) before being published to the pub/sub channel. On reconnect, the SSE route replays any missed stream entries using the `Last-Event-ID` the browser sends automatically. This guarantees `session.revoked`, `business.deleted`, and `ownership.transferred` events are never silently dropped even if the tab was closed or the connection was interrupted.

---

## Transport

**Endpoint:** `GET /api/realtime`

**Auth:** cookie session (`withAuth`-equivalent — calls `auth.api.getSession`). Returns 401 on no session.

**CSRF:** `Sec-Fetch-Site: same-origin` required. Falls back to `Origin`-matches-`Host` for older Safari. Non-browser clients are rejected.

**Query params:**

| Param | Required | Description |
|-------|----------|-------------|
| `businessId` | No | When set, the server subscribes to the `business:{id}` channel in addition to `user:{id}`. Verified via `requireBusinessAccessForRealtime` (cached 30s). |
| `deviceId` | No | The client's stable device id (from localStorage). Passed through so the publishing server can tag events with `originDeviceId` for echo suppression. |

**Response headers:**

```
content-type: text/event-stream
cache-control: no-cache, no-transform
connection: keep-alive
x-accel-buffering: no
```

**SSE frame format:**

```
id: <stream-entry-id or omitted>
event: <event.type>
data: <JSON payload>

```

**Heartbeat:** the server emits `:hb\n\n` (SSE comment) every 15 seconds to keep the TCP connection alive through proxy idle-timeouts. Browser `EventSource` parsers consume comments silently — they never reach JS callbacks. The client watchdog therefore resets on real message frames only (see [Client lifecycle](#client-lifecycle)).

**Rate limit:** per-user mutation bucket (30/min) on reconnects. Protects against reconnect storms.

**Region:** `preferredRegion = 'iad1'`. All SSE connections are pinned to one Vercel region so every Lambda instance that subscribes to the broker is in the same region as the Upstash Redis instance. This keeps subscriber connection count bounded — if connections scattered globally each Lambda in each region would open its own subscriber connection.

---

## Channel model

Three channel types exist, each serving a different scope and durability requirement.

### `business:{businessId}`

**Type:** pub/sub only (no stream persistence).

**Subscribers:** open clients that passed a `businessId` query param to `/api/realtime`.

**UI hints published here:**

- Team membership changes (join, remove, role, status)
- Invite code lifecycle (create, regenerate, delete, consumed)
- Business metadata changes (`business.updated`)

These events tell other-device team members to refresh their team or business view. They are missable — a tab that was closed or in the background will catch up via focus refetch or `system.resync` on reconnect.

### `user:{userId}`

**Type:** pub/sub only (no stream persistence).

**Subscribers:** every open client for that user (always subscribed, regardless of `businessId`).

**UI hints published here:**

- `profile.updated` — display name, email, or language changed
- `business.list.changed` — hub list needs refetch

**Security events also published here (but written to the stream first):**

- `session.revoked`, `business.deleted`, `ownership.transferred` — these are delivered here for immediate effect on connected clients and also written to `stream:user:{userId}` for replay on reconnect.

### `stream:user:{userId}` (Redis Stream)

**Type:** durable Redis stream. Max 100 entries; 90-day TTL refreshed on each write.

**Purpose:** replay buffer for critical events. On reconnect, the SSE handler reads from the stream since `Last-Event-ID` and replays missed critical events before subscribing to the live channels. If no `Last-Event-ID` is present (first connect), the handler reads the stream tip and emits `system.resync` tagged with that ID so future reconnects know where to resume.

---

## Event taxonomy

All types are defined in `packages/shared/src/realtime/types.ts`. The TypeScript discriminated union is the authoritative source — this table documents intent.

### BusinessRealtimeEvent (channel: `business:{id}`, fail-open)

| Event type | Payload fields | Published by route | Handler action |
|---|---|---|---|
| `team.member.joined` | `memberId` | `POST /invite/join` | refetch `team`, `invites` |
| `team.member.removed` | `memberId` | `POST /users/remove` | refetch `team`, `invites` |
| `team.member.role_changed` | `memberId`, `role` | `POST /users/change-role` | refetch `team`, `invites` |
| `team.member.status_changed` | `memberId`, `status` | `POST /users/toggle-status` | refetch `team`, `invites` |
| `team.invite.created` | `inviteId` | `POST /invite/create` | refetch `invites` |
| `team.invite.regenerated` | `inviteId` | `POST /invite/regenerate` | refetch `invites` |
| `team.invite.consumed` | `inviteId`, `consumedByName` | `POST /invite/join` | refetch `invites` |
| `team.invite.deleted` | `inviteId` | `POST /invite/delete` | refetch `invites` |
| `business.updated` | `fields: Array<'name'\|'locale'\|'currency'\|'iconUrl'>` | `PATCH /businesses/[id]` | refetch `business` |
| `product.created` | `productId` | `POST /products` | refetch `products` |
| `product.updated` | `productId`, `fields: Array<'name'\|'price'\|'categoryId'\|'icon'\|'barcode'\|'stock'\|'active'>` | `PATCH /products/[id]`, `PATCH /products/[id]/stock` | refetch `products`; if `!isSelfEcho`: emit entity-updated |
| `product.deleted` | `productId` | `DELETE /products/[id]` | refetch `products`; if `!isSelfEcho`: emit entity-deleted |
| `product.settings.updated` | `fields: Array<'defaultCategoryId'\|'sortPreference'>` | `PATCH /product-settings` | refetch `product-settings` |
| `category.created` | `categoryId` | `POST /categories` | refetch `categories` |
| `category.updated` | `categoryId`, `fields: Array<'name'\|'sortOrder'>` | `PATCH /categories/[id]` | refetch `categories`; if `!isSelfEcho`: emit entity-updated |
| `category.deleted` | `categoryId` | `DELETE /categories/[id]` | refetch `categories`; if `!isSelfEcho`: emit entity-deleted |
| `category.reordered` | — | `POST /categories/reorder` | refetch `categories` |
| `expense.created` | `expenseId` | `POST /expenses` | refetch `expenses` |
| `expense.updated` | `expenseId` | `PATCH /expenses/[id]` | refetch `expenses`; if `!isSelfEcho`: emit entity-updated |
| `expense.deleted` | `expenseId` | `DELETE /expenses/[id]` | refetch `expenses`; if `!isSelfEcho`: emit entity-deleted |
| `expense_category.created` | `categoryId` | `POST /expense-categories` | refetch `expenses` |
| `expense_category.updated` | `categoryId` | `PATCH /expense-categories/[id]` | refetch `expenses` |
| `expense_category.deleted` | `categoryId` | `DELETE /expense-categories/[id]` | refetch `expenses` |
| `sale.created` | `saleId` | `POST /sales` | refetch `sales` + `products` (stock cascade) |
| `sale.voided` | `saleId` | `POST /sales/[id]/void` | refetch `sales` + `products` (stock restore cascade) |
| `inventory.adjusted` | `adjustmentId`, `productId`, `relatedExpenseId` | `PATCH /products/[id]/stock` | refetch `products` |
| `sales_session.opened` | `sessionId` | `POST /sales-sessions/open` | refetch `sales-sessions` |
| `sales_session.closed` | `sessionId` | `POST /sales-sessions/close` | refetch `sales-sessions` |

Every payload also has an optional `originDeviceId?: string` that the handler layer uses for echo suppression.

### UserRealtimeEvent (channel: `user:{id}`, fail-open)

| Event type | Payload fields | Published by | Handler action |
|---|---|---|---|
| `profile.updated` | `fields: Array<'displayName'\|'email'\|'language'>` | better-auth `after.user.update` hook, `POST /account/change-email` | refetch `profile` |
| `business.list.changed` | `reason: 'added'\|'removed'\|'renamed'` | `POST /businesses/create`, `POST /invite/join`, `POST /transfer/accept`, `DELETE /businesses/[id]` | refetch `businesses-list` |

`publishBatchedToUsers` is used for `business.list.changed` when a business rename or delete must notify all members at once — a single Redis pipeline round-trip regardless of member count.

### CriticalUserRealtimeEvent (channel: `user:{id}` + stream, fail-CLOSED)

Published via `publishCriticalToUser`. Writes to `stream:user:{id}` first (capped at 100 entries), then PUBLISH on `user:{id}`, then refreshes the stream TTL — all in a single Redis MULTI/EXEC. Throws `RealtimeUnavailableError` on any failure; calling routes return 503 `REALTIME_PUBLISH_UNAVAILABLE`.

| Event type | Payload fields | Published by | Handler action |
|---|---|---|---|
| `session.revoked` | `businessId`, `reason: 'removed'\|'business_deleted'\|'ownership_transferred'` | `POST /users/remove`, `DELETE /businesses/[id]` | `revokeBusinessContext` |
| `business.deleted` | `businessId` | `DELETE /businesses/[id]` | `revokeBusinessContext` (reason: `business_deleted`) |
| `ownership.transferred` | `businessId`, `role: 'former_owner'\|'new_owner'` | `POST /transfer/accept` | former owner → `revokeBusinessContext`; new owner → refetch `businesses-list` |

### SystemRealtimeEvent (emitted by SSE handler, never via Redis)

| Event type | Payload fields | When emitted | Handler action |
|---|---|---|---|
| `system.resync` | — | first connect (stream tip), reconnect with nothing to replay, broker Redis reconnect | `callAllRefetches()` |
| `system.error` | `code: ApiMessageCode` | stream read failure | show error toast |
| `system.auth_expired` | — | Declared in the shared union; handled by `routeToLogin()` in `dispatchRealtimeEvent`. The 3-consecutive-error circuit breaker in `RealtimeProvider` currently calls `routeToLogin()` directly rather than emitting this frame — so this event type is wired end-to-end but not actively published. | `routeToLogin()` |

---

## Publisher API

All publisher helpers are in `apps/api/src/lib/realtime/` and exported from its barrel `index.ts`. Import via `@/lib/realtime`.

```typescript
import {
  publishToBusiness,
  publishToUser,
  publishCriticalToUser,
  publishBatchedToUsers,
  getOriginDeviceId,
} from '@/lib/realtime'
```

### `publishToBusiness(businessId, event, originDeviceId?): Promise<void>`

Fail-open. Publishes to `business:{businessId}`. Swallows errors with a `console.warn`.

```typescript
await publishToBusiness(access.businessId, {
  type: 'team.invite.created',
  inviteId: newInvite.id,
}, originDeviceId)
```

### `publishToUser(userId, event, originDeviceId?): Promise<void>`

Fail-open. Publishes to `user:{userId}`. Same semantics as `publishToBusiness`.

```typescript
await publishToUser(user.userId, {
  type: 'business.list.changed',
  reason: 'added',
}, originDeviceId)
```

### `publishCriticalToUser(userId, event, originDeviceId?): Promise<void>`

Fail-CLOSED. Writes to `stream:user:{userId}` + PUBLISH on `user:{userId}` in a MULTI/EXEC. Throws `RealtimeUnavailableError` on failure. The calling route must catch and return 503 `REALTIME_PUBLISH_UNAVAILABLE`.

```typescript
try {
  await publishCriticalToUser(targetUserId, {
    type: 'session.revoked',
    businessId: access.businessId,
    reason: 'removed',
  }, originDeviceId)
} catch (err) {
  if (err instanceof RealtimeUnavailableError) {
    return errorResponse(ApiMessageCode.REALTIME_PUBLISH_UNAVAILABLE, 503)
  }
  throw err
}
```

### `publishBatchedToUsers(userIds, event, originDeviceId?): Promise<void>`

Fail-open. Pipelines PUBLISH commands to multiple `user:{id}` channels in a single Redis round-trip. Used when a mutation must notify all members of a business at once (e.g., business rename → everyone needs `business.list.changed`).

```typescript
const memberIds = members.map((m) => m.userId)
await publishBatchedToUsers(memberIds, {
  type: 'business.list.changed',
  reason: 'renamed',
}, originDeviceId)
```

### `getOriginDeviceId(request): string | undefined`

Reads the `X-Device-Id` header that the web client attaches to every mutating request. Pass the returned value as `originDeviceId` to any publisher call. Not an auth factor — used only for self-echo suppression on the publishing client.

```typescript
const originDeviceId = getOriginDeviceId(request)
```

---

## Adding a new event type

**Step 1: Add to the shared union.**

Edit `packages/shared/src/realtime/types.ts`. Decide which tier:

- Missable UI hint visible to the whole team → add to `BusinessRealtimeEvent`
- Missable UI hint for one user → add to `UserRealtimeEvent`
- Must survive a reconnect (security, ownership, account changes) → add to `CriticalUserRealtimeEvent`

```typescript
// Example: adding a product.created hint to the business channel
export type BusinessRealtimeEvent =
  | ...existing variants...
  | ({ type: 'product.created'; productId: string } & WithOrigin)
```

**Step 2: Add a handler branch.**

Edit `apps/web/src/lib/realtime/handlers.ts`. The `switch` has no `default` — TypeScript will fail to compile if `event` is not fully narrowed to `never` at the exhaustiveness assertion. Add the new `case` branch before the exhaustiveness check.

```typescript
case 'product.created':
  callRefetch('products')
  return
```

**Step 3: Publish from the API route.**

After the DB write succeeds, add the publish call. Read `getOriginDeviceId` once at the top of the handler and pass it through.

```typescript
const originDeviceId = getOriginDeviceId(request)
// ... DB write ...
await publishToBusiness(access.businessId, {
  type: 'product.created',
  productId: newProduct.id,
}, originDeviceId)
return successResponse({ product: newProduct })
```

**Step 4: Write tests.**

Unit tests adjacent to the route file. Mock the publisher via `vi.mock` (see [Testing](#testing)).

---

## Adding a publish to an existing route

Pattern:

1. Import `getOriginDeviceId` and the appropriate publisher(s) from `@/lib/realtime`.
2. Read `originDeviceId` once at the top of the handler, before any early-return branches:
   ```typescript
   const originDeviceId = getOriginDeviceId(request)
   ```
3. Place the publish call after the DB write succeeds, before `successResponse`.
4. For fail-open (hints): do not `await` inside a try/catch — just `await publishToBusiness(...)` and let the publisher's internal swallow logic handle errors.
5. For fail-closed (security events): `await publishCriticalToUser(...)` inside a try/catch. On `RealtimeUnavailableError`, return `errorResponse(ApiMessageCode.REALTIME_PUBLISH_UNAVAILABLE, 503)`.

Full fail-closed example:

```typescript
import {
  publishToBusiness,
  publishCriticalToUser,
  getOriginDeviceId,
  RealtimeUnavailableError,
} from '@/lib/realtime'

export const POST = withBusinessAuth(async (request, access) => {
  const originDeviceId = getOriginDeviceId(request)
  const body = await request.json()
  // ...validation...

  const [updated] = await db.update(...).returning()
  if (!updated) return errorResponse(ApiMessageCode.NOT_FOUND, 404)

  // Fail-open hint to all team members
  await publishToBusiness(access.businessId, {
    type: 'team.member.role_changed',
    memberId: targetUserId,
    role: newRole,
  }, originDeviceId)

  // Fail-closed security event to the affected user
  try {
    await publishCriticalToUser(targetUserId, {
      type: 'session.revoked',
      businessId: access.businessId,
      reason: 'removed',
    }, originDeviceId)
  } catch (err) {
    if (err instanceof RealtimeUnavailableError) {
      return errorResponse(ApiMessageCode.REALTIME_PUBLISH_UNAVAILABLE, 503)
    }
    throw err
  }

  return successResponse({ member: updated })
})
```

---

## Client lifecycle

`RealtimeProvider` in `apps/web/src/contexts/realtime-context.tsx` owns the single `EventSource` per browser tab.

**Open:** on `isAuthenticated` becoming true. The URL is `/api/realtime?businessId=<current>&deviceId=<stable-local-device-id>`. First connect: server reads the stream tip, emits `system.resync` tagged with the tip id. The browser stores this as `Last-Event-ID` automatically.

**Business switch:** `setActiveBusinessId(id)` is debounced 250ms. After the debounce, the current `EventSource` is closed and a new one is opened with the updated `businessId` param. The browser carries `Last-Event-ID` on the new connection, triggering a stream replay.

**45-second watchdog:** resets on every real message frame. If 45s pass without a frame, the provider closes the `EventSource` and reopens it. Browser carries `Last-Event-ID` so no critical events are lost.

**3-strike error close:** if 3 consecutive `error` events fire without an intervening `open`, the provider treats this as auth expiry (browsers retry 401 indefinitely without a circuit breaker) and calls `logout()`.

**Echo suppression:** `getDeviceId()` generates a stable UUID in `localStorage` on first call. Every API request from the client attaches `X-Device-Id: <deviceId>`. The publisher reads this via `getOriginDeviceId(request)` and merges it onto the event payload. `dispatchRealtimeEvent` in `handlers.ts` drops any event whose `originDeviceId` matches `ownDeviceId` so the publishing tab does not see its own mutation reflected back.

**Event dispatch:** `dispatchRealtimeEvent(event, ctx)` in `apps/web/src/lib/realtime/handlers.ts` is the exhaustive switch. It routes events to the refetch-registry (`callRefetch`, `callAllRefetches`) or calls `ctx.revokeBusinessContext` / `ctx.routeToLogin` for security events.

**Refetch registry:** `apps/web/src/lib/realtime/refetch-registry.ts` holds a `Map<key, callback>`. Business contexts register their `refetch` callbacks under named keys (`'team'`, `'invites'`, `'business'`, `'businesses-list'`, `'profile'`, `'products'`). The handler layer calls `callRefetch('key')` or `callAllRefetches()` without needing a direct reference to any context.

**Close:** on `isAuthenticated` becoming false (logout, account delete) or component unmount. The watchdog timer is also cleared.

**Focus refetch backstop:** `useRevalidateOnFocus` in each resource context (products, sales, expenses, categories, etc.) debounces a re-`ensureLoaded()` on every tab/window focus event (5s debounce). This backs up pub/sub events that were dropped during a subscriber reconnect gap. The 30s context freshness window (`STALE_AFTER_MS`) still applies — quick alt-tabs within 30s of the last fetch are no-ops. Together, the `system.resync` path (fired on reconnect) and `useRevalidateOnFocus` ensure the UI converges even when SSE delivery fails.

---

## Service worker note

`apps/web/src/pwa/sw.ts` contains an explicit bypass for the SSE endpoint:

```typescript
// Bypass the service worker for /api/realtime (SSE stream).
// The SW must not intercept this request — it would buffer the stream.
if (url.pathname === '/api/realtime') {
  return // falls through to the browser's native fetch
}
```

If you add another long-lived HTTP endpoint (e.g., a future WebSocket upgrade URL) that must not be intercepted by the SW, replicate this pattern before the `NetworkOnly` `/api/*` route. The `/api/*` NetworkOnly strategy alone is not sufficient — the SW still reads the response before passing it through, which prevents `ReadableStream` streaming from working correctly.

---

## Dev backend

When `UPSTASH_REDIS_URL` is **not** set (local dev), the realtime layer uses an in-memory backend (`apps/api/src/lib/realtime/in-memory-backend.ts`). This is a node `EventEmitter` + `Map` that satisfies the same publish/subscribe/stream interface as the real Redis client. It is single-process only — events published by one Lambda instance are not visible to another. In local dev there is one process, so it works correctly.

**Never set `UPSTASH_REDIS_URL` in `apps/api/.env.local`.** The in-memory backend is the correct local dev path. Setting the env var locally would route realtime events through the production Upstash instance, polluting production subscribers with dev mutations.

The dev backend activates automatically: `apps/api/src/lib/realtime/redis.ts` calls `getPublisher()` and `getSubscriber()`, both of which check `process.env.UPSTASH_REDIS_URL` and return the in-memory backend when it is absent.

---

## Testing

Unit tests live adjacent to each source file (`*.test.ts`).

### Mocking the publisher in route tests

```typescript
// At the top of your route.test.ts
const publishToBusiness = vi.fn()
vi.mock('@/lib/realtime', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/realtime')>()
  return { ...real, publishToBusiness }
})

beforeEach(() => {
  publishToBusiness.mockReset()
  publishToBusiness.mockResolvedValue(undefined)
})

it('publishes after the DB write', async () => {
  const res = await POST(makeRequest())
  expect(publishToBusiness).toHaveBeenCalledTimes(1)
  expect(publishToBusiness).toHaveBeenCalledWith(
    'biz-id',
    { type: 'team.invite.created', inviteId: expect.any(String) },
    undefined,
  )
})
```

For routes using `publishCriticalToUser`, mock it the same way and test that the route returns 503 when the mock throws a `RealtimeUnavailableError`.

### Mocking the broker in SSE route tests

```typescript
vi.mock('@/lib/realtime', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/realtime')>()
  return {
    ...real,
    subscribe: vi.fn(() => () => {}),
    getUserStreamTip: vi.fn().mockResolvedValue('0-0'),
    readUserStreamSince: vi.fn().mockResolvedValue([]),
  }
})
```

---

## Production deployment

**`UPSTASH_REDIS_URL`** must be set in Vercel Production and Preview environments. The value is the Upstash `ioredis`-compatible TCP/TLS connection string (`rediss://...`). This is different from `UPSTASH_REDIS_REST_URL` (the HTTP REST endpoint used by the rate-limiter) — realtime uses `ioredis` for subscribe/publish semantics, not the REST API.

> `UPSTASH_REDIS_URL` is a Vercel-only env var. It is intentionally absent from `apps/api/.env.local` — local dev uses the in-memory backend. The canonical value is stored in the Bitwarden note `Kasero — Vercel project envs`.

The realtime endpoint is pinned to `iad1` via `export const preferredRegion = 'iad1'` in `apps/api/src/app/api/realtime/route.ts`. All Lambdas that subscribe to the broker are in the same region as the Upstash Redis replica, bounding the total subscriber connection count.

---

## File reference

| File | Purpose |
|------|---------|
| `packages/shared/src/realtime/types.ts` | Discriminated union — all event types, channel name helpers. Single source of truth. |
| `apps/api/src/lib/realtime/publisher.ts` | `publishToBusiness`, `publishToUser`, `publishCriticalToUser`, `publishBatchedToUsers` |
| `apps/api/src/lib/realtime/broker.ts` | Per-instance subscriber broker — refcounted channels, resync flow, 30s watchdog |
| `apps/api/src/lib/realtime/streams.ts` | `getUserStreamTip`, `readUserStreamSince` — stream replay helpers |
| `apps/api/src/lib/realtime/redis.ts` | `getPublisher()` / `getSubscriber()` — returns Upstash ioredis or the in-memory backend |
| `apps/api/src/lib/realtime/in-memory-backend.ts` | EventEmitter-based in-memory backend for local dev |
| `apps/api/src/lib/realtime/origin-device-id.ts` | `getOriginDeviceId(request)` — reads `X-Device-Id` header |
| `apps/api/src/lib/realtime/errors.ts` | `RealtimeUnavailableError` |
| `apps/api/src/lib/realtime/index.ts` | Barrel — re-exports everything above |
| `apps/api/src/app/api/realtime/route.ts` | SSE handler — auth, CSRF, rate-limit, replay, subscribe, heartbeat |
| `apps/web/src/lib/realtime/handlers.ts` | `dispatchRealtimeEvent` — exhaustive event switch |
| `apps/web/src/lib/realtime/refetch-registry.ts` | `registerRefetch`, `callRefetch`, `callAllRefetches` |
| `apps/web/src/lib/realtime/device-id.ts` | `getDeviceId()` — stable UUID in localStorage |
| `apps/web/src/lib/realtime/index.ts` | Client barrel |
| `apps/web/src/contexts/realtime-context.tsx` | `RealtimeProvider`, `useRealtime()` — EventSource lifecycle, watchdog, revoke flow |
| `apps/web/src/pwa/sw.ts` | Service worker — `/api/realtime` bypass |
