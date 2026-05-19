# Realtime over Upstash — Design

**Date:** 2026-05-19
**Status:** Draft (v2 — post-adversarial-review)
**Revision history:**
- v1 (2026-05-19): Initial draft.
- v2 (2026-05-19): Reviewed adversarially. Fixed blockers around React-Query assumption, CSRF on SSE GET, XREAD semantics, serverless ioredis durability, subscriber-reconnect message loss, client-side handler architecture, EventSource auth-expiry handling, server-side access enforcement, lazy env-var loading. Added missing publish sites and the `team.member.status_changed` event. Committed to single-PR rollout. Promoted prerequisites.

## 1. Goals

Push state changes from the API to all interested connected clients without polling, so that:

1. **Team management is live.** When a member joins / leaves / has their role changed (or is activated/deactivated), the owner's team list and pending-invites list update in real time on every open device.
2. **Multi-device sync works.** A user with the app open on phone + tablet sees profile, business-list, business-settings, and language changes propagate across their own devices.
3. **Session revocation is enforced live.** When a user is removed from a business (or the business is deleted), their active sessions for that business are torn down without waiting for the next protected request to 403 them.
4. **The mechanism scales past the free-tier connection cap.** Connection consumption is bounded by *Vercel Fluid Compute instance count*, not by device count. From day one this requires (a) region pinning of the SSE route, (b) empirical verification of the Upstash free-tier connection cap, and (c) a documented load-test acceptance bar.

## 2. Non-Goals

- Two-way realtime. Clients write via the existing REST API; only the server pushes.
- Presence ("X is online", "Y is editing this product"). Defer.
- Realtime POS / orders / inventory / product-catalog sync. The transport supports them trivially, but wiring publishes into every product/inventory route is out of scope.
- WebSocket transport. SSE is sufficient for one-way push.
- Cross-region replication. Upstash free tier is single-region; the SSE route is also pinned to one region (§13).
- A second realtime vendor. We stay on Upstash to avoid a new platform and a new bill.
- Adopting React Query / SWR as a client cache. The realtime client integrates with the existing context-provider architecture (§8).

## 3. Background — the bug we are solving

`apps/web/src/components/team/TeamDrilldown.tsx` lists active members and pending invite codes for the business. When a second user accepts an invite via `POST /api/invite/join`, the joiner's device updates correctly but the owner's device — which may still have the invite-code modal open — keeps showing the now-consumed code and never sees the new member. The owner has to manually refresh.

The same staleness window exists for: removing a member, changing a member's role, regenerating an invite code, deleting an invite, activating/deactivating a member, ownership transfer, deleting a business, and any business / profile change replicated across a user's own devices.

We need server→client push. We already pay for and depend on Upstash for rate limiting (`apps/api/src/lib/rate-limit.ts`), so we extend that dependency to pub/sub instead of adding a new vendor.

## 4. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Vercel Fluid Compute instance N  (region-pinned: see §13)                │
│                                                                         │
│  ┌────────────────────────┐    ┌──────────────────────────────────┐     │
│  │ SSE handler request 1  │    │  realtime broker (module-scope,  │     │
│  │ (business owner, web)  ├────┤   globalThis-keyed for HMR)       │     │
│  └────────────────────────┘    │  - ioredis subscriber (1 conn)   │     │
│                                │  - EventEmitter (per-channel)    │     │
│  ┌────────────────────────┐    │  - channel refcount map          │     │
│  │ SSE handler request 2  ├────┤  - liveness watchdog             │     │
│  │ (same owner, phone)    │    │                                  │     │
│  └────────────────────────┘    │  SUBSCRIBE/UNSUBSCRIBE only      │     │
│                                │  on 0↔1 transitions; resync       │     │
│  ┌────────────────────────┐    │  signal on subscriber reconnect  │     │
│  │ SSE handler request 3  ├────┤                                  │     │
│  │ (staff member)         │    └─────────────┬────────────────────┘     │
│  └────────────────────────┘                  │                          │
└────────────────────────────────────────────────┬────────────────────────┘
                                                 │ 1 TCP connection
                                                 ▼
                                  ┌──────────────────────────────┐
                                  │ Upstash Redis                │
                                  │  - Pub/Sub channels          │
                                  │  - Streams (XADD/XREAD)      │
                                  │  - Existing rate-limit keys  │
                                  └──────────────────────────────┘
                                                 ▲
                                                 │ ioredis publisher (singleton, lazy)
                                                 │
┌──────────────────────────────────────────────────────────────────────────┐
│ Any API route — invite/join, businesses/.../team, account/..., etc.      │
│                                                                          │
│   await db.insert(...).execute()                                         │
│   await publishToBusiness(businessId, { type: 'team.member.joined' })    │
│   await publishCriticalToUser(userId, { type: 'session.revoked' })       │
└──────────────────────────────────────────────────────────────────────────┘
```

**Transport.** Server-Sent Events over an authenticated Next.js route at `GET /api/realtime`. One-way server→client. Same-origin (no CSP change). Cookie-authenticated via the existing better-auth session. The `EventSource` browser API handles reconnect with built-in exponential backoff; client-side watchdog (§8.4) augments this for the failure modes EventSource can't detect on its own.

**Fan-out.** Upstash Redis over the standard Redis TCP protocol (`rediss://`) using `ioredis`. Same Upstash database as the existing rate limiter — separate credentials for the standard-protocol endpoint, same store.

**Two delivery modes:**
- **Pub/sub** for live UI updates (team-list refresh hints, business-updated, profile-updated). Fire-and-forget. Missed events are tolerated and backstopped by `useRevalidateOnFocus`, augmented with an explicit `system.resync` event the server emits when the broker re-subscribes after a connection drop (§12).
- **Redis Streams** for security-critical events (`session.revoked`, `business.deleted`, `ownership.transferred`). Capped at exactly 100 entries per user via `MAXLEN 100` (exact, not approximate — see §7.4). Replayed on every SSE reconnect from the `Last-Event-ID` header. **Skipped on first-ever connect** (§7.4).

**Connection scaling.** A module-scoped, globalThis-keyed broker per Vercel Fluid Compute instance owns a single `ioredis` subscriber connection. SSE handler requests register listeners on the broker's `EventEmitter`. Reference counting on each channel ensures we only issue `SUBSCRIBE`/`UNSUBSCRIBE` to Redis when a channel goes 0→1 / 1→0 listeners. The SSE route is **pinned to a single Vercel region** (§13) so instance count is small and bounded.

## 5. Channel Model

Two channel namespaces, no others:

| Channel | Subscribed by | Carries |
|---|---|---|
| `user:{userId}` | every authenticated SSE stream owned by that user | Multi-device sync events for that user, security events targeting that user |
| `business:{businessId}` | every SSE stream whose active business is this one | Team events, business-settings events, invite events |

A user inside business X is subscribed to **exactly two** live channels: `user:{userId}` and `business:{X}`. Switching business closes the current SSE connection and opens a fresh one with the new `businessId` query parameter — the broker handles refcounted unsubscribe-then-subscribe transparently. Business switches at the client are debounced 250 ms (§11) to defeat rapid back-and-forth churn.

Critical streams parallel the user channel:

| Stream | Written by | Read by |
|---|---|---|
| `stream:user:{userId}` | `publishCriticalToUser` | SSE endpoint replays from `Last-Event-ID` on **reconnect** (not first connect) |

We do not maintain a `stream:business:{id}` — business-channel events are all UI staleness hints, not security-critical.

## 6. Event Taxonomy

All events are JSON. The discriminated union lives in `packages/shared/src/types/realtime.ts` so both apps consume the same type. Payloads carry an `originDeviceId` so the publishing client can suppress echoes of its own events (§7.3, §10).

### Business-channel events (`business:{id}`, pub/sub only)

```ts
| { type: 'team.member.joined';         memberId: string }
| { type: 'team.member.removed';        memberId: string }
| { type: 'team.member.role_changed';   memberId: string; role: BusinessRole }
| { type: 'team.member.status_changed'; memberId: string; status: 'active'|'disabled' }
| { type: 'team.invite.created';        inviteId: string }
| { type: 'team.invite.regenerated';    inviteId: string }
| { type: 'team.invite.consumed';       inviteId: string; consumedByName: string }
| { type: 'team.invite.deleted';        inviteId: string }
| { type: 'business.updated';           fields: Array<'name'|'locale'|'currency'|'iconUrl'> }
```

All trigger a context-provider refetch on the receiving client (§8.2). Payloads send the changed identity, not the new value — clients refetch to learn the new state.

`team.invite.consumed` is the only exception that includes a denormalized field (`consumedByName`): the owner's open invite modal needs to render "code used by Alice" without an extra fetch. The name is rendered verbatim per CLAUDE.md rule 7 (never translate user-entered content).

### User-channel events (`user:{id}`)

**Pub/sub for UI sync (missable, backstopped by focus refetch and resync signal):**
```ts
| { type: 'profile.updated';            fields: Array<'displayName'|'email'|'language'> }
| { type: 'business.list.changed';      reason: 'added'|'removed'|'renamed' }
```

**Stream + pub/sub for security events (must not be missed across a reconnect):**
```ts
| { type: 'session.revoked';            businessId: string; reason: 'removed'|'business_deleted'|'ownership_transferred' }
| { type: 'business.deleted';           businessId: string }
| { type: 'ownership.transferred';      businessId: string; role: 'former_owner'|'new_owner' }
```

### System events (server→client, not derived from API mutations)

These are emitted by the SSE handler itself, not via Redis pub/sub. They never carry an `id:` (i.e., they are not stream-replayable).

```ts
| { type: 'system.resync' }                                     // broker reconnected; refetch everything
| { type: 'system.error';        code: ApiMessageCode }         // mid-stream error; client maps via useApiMessage
| { type: 'system.auth_expired' }                                // server-driven close before browser retries on a stale cookie
```

The `system.*` namespace lets the client distinguish protocol events from application events; handlers are written in separate files (§8.3).

## 7. Server-Side Components

### 7.1 `apps/api/src/lib/realtime/redis.ts` — TCP Redis client (truly lazy)

Two `ioredis` instances, both lazily constructed on first use:

```ts
let _subscriber: Redis | null = null
let _publisher: Redis | null = null

export function getSubscriber(): Redis { /* construct on first call */ }
export function getPublisher(): Redis { /* construct on first call */ }
```

No env-var reads at module evaluation time. The realtime module imports must not crash `next dev` on a clean clone with no Upstash creds — every non-realtime route must still work. The 503 path in §7.5 catches the missing-creds case at request time.

Both clients use `lazyConnect: true`, `enableReadyCheck: true`, exponential backoff with `retryStrategy`, and `maxRetriesPerRequest: 1` for the publisher (we'd rather throw than block a route forever; the calling route translates to a 503).

Same `VERCEL_ENV === 'production'` + `NEXT_PHASE !== 'phase-production-build'` gating pattern as `rate-limit.ts` lives on the lazy getters: the first call in a production runtime context with no creds throws `RealtimeUnavailableError`.

### 7.2 `apps/api/src/lib/realtime/broker.ts` — Shared-subscriber broker

Module-scoped singleton, but **stored on `globalThis`** under `Symbol.for('kasero.realtime.broker')` so Next.js dev-mode HMR does not leak subscriber connections across reloads. Disposed via `module.hot?.dispose` in dev.

Public surface:
```ts
function subscribe(
  channel: string,
  listener: (payload: unknown) => void
): () => void  // unsubscribe
```

Internals:
- `channelListeners: Map<string, Set<Listener>>`
- On first listener: `subscriber.subscribe(channel)`. On last listener removed: `subscriber.unsubscribe(channel)`.
- `subscriber.on('message', (channel, raw) => { /* try/catch JSON.parse; try/catch each listener dispatch; both log on failure */ })`.
- **Resync flow.** The broker tracks subscriber connection generations. When `subscriber` emits `end` or `error` with `readyState !== 'ready'`, the broker enters a "resyncing" state. When `ready` fires again, the broker:
  1. Re-issues `SUBSCRIBE` for every channel in `channelListeners`.
  2. Emits a synthetic `__resync__` event to every active listener.
  This is the only way active SSE handlers learn that messages may have been dropped during the gap. They translate the synthetic event into a `system.resync` SSE frame and let the client trigger a full refetch (§8). Without this signal, pub/sub message loss during reconnect is silent.

- **Liveness watchdog.** A 30-second interval pings the subscriber with a no-op `subscriber.ping()` (allowed on subscriber connections in ioredis). On failure, force a reconnect. Defends against Vercel Fluid Compute idle-suspend silently killing the socket (§12).

### 7.3 `apps/api/src/lib/realtime/publisher.ts` — Publish helpers

Public surface:

```ts
publishToBusiness(
  businessId: string,
  event: BusinessRealtimeEvent,
  originDeviceId?: string,
): Promise<void>

publishToUser(
  userId: string,
  event: UserRealtimeEvent,
  originDeviceId?: string,
): Promise<void>

publishCriticalToUser(
  userId: string,
  event: CriticalUserRealtimeEvent,
  originDeviceId?: string,
): Promise<void>  // throws RealtimeUnavailableError on failure
```

`originDeviceId` is read from the publishing request's `X-Device-Id` header (each client generates and persists one in localStorage). The publisher attaches it to the event payload so the client can suppress its own echoes (§10).

`publishToBusiness` and `publishToUser` are a single `PUBLISH` command, fail-open with a logged warning on Upstash error.

`publishCriticalToUser` is a **single pipelined transaction** to avoid 2× round-trip:
```
MULTI
  XADD stream:user:{id} MAXLEN 100 * type <type> payload <json>
  PUBLISH user:{id} <json>
EXEC
```
Fails closed: throws `RealtimeUnavailableError`. The calling route translates to a 503 with `ApiMessageCode.REALTIME_PUBLISH_UNAVAILABLE` (new code, see §15).

For broadcasts to many users (e.g., business-renamed → publish to every member's user channel for switcher refresh), the publisher exposes a batched helper that pipelines all PUBLISHes in one round-trip.

### 7.4 `apps/api/src/lib/realtime/streams.ts` — Stream replay helper

```ts
readUserStreamSince(
  userId: string,
  lastEventId: string,  // never null; caller decides whether to read
): Promise<Array<{ id: string; event: CriticalUserRealtimeEvent }>>
```

Internals: `XREAD COUNT 100 STREAMS stream:user:{userId} <lastEventId>`. `XREAD` returns entries with ID strictly greater than the supplied ID.

**First-connect rule.** If the SSE request has no `Last-Event-ID` header, the server **does NOT replay**. It calls `XREVRANGE stream:user:{userId} + - COUNT 1` to obtain the current stream tip and emits one synthetic `system.resync` frame with `id:` set to that tip. The client now knows: "you may have missed everything before this point — refetch your state." Subsequent reconnects send `Last-Event-ID = <last seen tip>` and get a strict replay.

This rule has two consequences:
1. A user opening the app for the first time on a new device never sees a six-month-old `session.revoked` from a long-ago removal.
2. The stream's job is bounded: replay-since-last-seen-by-this-device, not "all history forever".

**MAXLEN exact (`MAXLEN 100`, not `MAXLEN ~ 100`).** Predictable storage. With Upstash's free-tier per-stream cost, this matters at scale.

**Stream TTL.** Each successful `XADD` is followed by `PEXPIRE stream:user:{id} <90 days>`. Long enough to survive a vacation; short enough to bound stale state if a user account goes dormant.

### 7.5 `apps/api/src/app/api/realtime/route.ts` — SSE endpoint

```ts
export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'
```

Handler outline:

1. **Auth.** Resolve session via `auth.api.getSession({ headers: request.headers })`. 401 if missing. Confirmed during the integration test (E4 from the review) that better-auth works in the node serverless runtime for this case.
2. **CSRF defense for GETs.** Even though `enforceSameOrigin` returns early on GET in `api-middleware.ts`, the SSE endpoint adds its own check: require `Sec-Fetch-Site: same-origin` OR (`Origin` header matches the request host). Reject with 403 otherwise. The `Sec-Fetch-Site` header is set by all modern browsers on EventSource requests; absence is an indicator of a non-browser client and is rejected.
3. **Authorization.** If `businessId` query param is present, run the server-side membership check via the existing `requireBusinessAccess` helper in `business-auth.ts` (the *server-side* check — not the client-side `getCachedBusiness` cache). Failed → 403.
4. **Server-side access cache.** Wrap the membership check in a per-instance in-memory `Map<({userId},{businessId}), { expiresAt, granted }>` with a 30-second TTL. Reduces DB queries during reconnect storms. TTL is short enough that revocation propagates promptly via the next reconnect's check; security is still anchored to the *next* protected REST request, not the cache.
5. **Rate limit.** Apply `RateLimits.userMutation` keyed by `userId`. Defends against reconnect-storm abuse.
6. **Read `Last-Event-ID` header.** Decide first-connect vs reconnect per §7.4.
7. **Construct `ReadableStream`.** In `start(controller)`:
   - Emit the initial `system.resync` event (first connect) OR replay events (reconnect).
   - Register a listener on the broker for `user:{userId}`. The broker's `__resync__` events translate to `system.resync` SSE frames.
   - If `businessId`: register a listener for `business:{businessId}`.
   - Heartbeat `:hb\n\n` every 15 seconds. On write failure, abort cleanup.
   - On `request.signal.abort`: clear interval, call all unsubscribe fns, close controller.
8. **Auth-expiry handling.** Watch for an explicit invalidation signal from the auth layer (TBD during plan — the simplest is to do nothing server-side and rely on the next reconnect 401ing). Emit `system.auth_expired` and close the stream on detected expiry. Client treats this as terminal (§8.4).
9. **Errors mid-stream.** Wrap each frame write in try/catch. On failure: emit a final `system.error` event with `code: ApiMessageCode.REALTIME_UNAVAILABLE`, close.
10. **Response headers.** `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`. Constructed via `new Response(stream, { headers })` directly — not via `NextResponse.json` (which would coerce to JSON).

### 7.6 Wiring publishes into existing routes

| Event | Triggered from |
|---|---|
| `team.member.joined` + `team.invite.consumed` (business chan) AND `business.list.changed reason:'added'` (user chan, joiner) | `POST /api/invite/join` |
| `team.member.removed` (business chan) AND `session.revoked reason:'removed'` + `business.list.changed reason:'removed'` (user chan, target) | Member-removal route under `/api/businesses/[businessId]/team/...` (exact path verified during plan) |
| `team.member.role_changed` | `PATCH` on member route |
| `team.member.status_changed` | Member status toggle route |
| `team.invite.created` | `POST /api/businesses/[businessId]/invite/create` |
| `team.invite.regenerated` | `POST /api/businesses/[businessId]/invite/regenerate` |
| `team.invite.deleted` | `POST /api/businesses/[businessId]/invite/delete` |
| `business.updated fields:['name'\|...]` (business chan) AND `business.list.changed reason:'renamed'` to every member's user channel (only for name) | `PATCH /api/businesses/[businessId]` |
| `business.list.changed reason:'added'` (user chan, owner) | `POST /api/businesses` (create) |
| `business.deleted` (business chan) AND `session.revoked reason:'business_deleted'` + `business.list.changed reason:'removed'` (user chan, every member) | `DELETE /api/businesses/[businessId]` |
| `ownership.transferred role:'new_owner'` + `business.list.changed reason:'added'` (new owner's user chan) AND `session.revoked reason:'ownership_transferred'` + `business.list.changed reason:'removed'` (former owner's user chan) | `POST /api/transfer/accept` |
| `profile.updated fields:[...]` to user chan | Account/profile mutation routes (exact paths enumerated during plan) |

Each publish sits **after** the DB commit succeeds. We never publish on a transaction that may roll back. For multi-recipient broadcasts (e.g., business renamed), the route calls the batched-publish helper from §7.3 so all PUBLISHes go in one Upstash round-trip.

**Initiator UX:** Anywhere the action initiator is also a revocation target (a user deleting their own business; a user accepting ownership-transfer-to-someone-else), they receive the same `session.revoked`/`business.list.changed` events as any other affected user. Their own device translates that into the same UX as any other revoked user (§9). The route returns 200 first; the SSE event arrives microseconds later and triggers the navigation.

## 8. Client-Side Components

The client uses the codebase's existing **context-provider** architecture (`apps/web/src/contexts/`) — there is no React Query. The realtime layer is a thin handler registry that calls `refetch()` on registered providers and dispatches security events to navigation/UI side-effects.

### 8.1 Refetch registry

`apps/web/src/lib/realtime/refetch-registry.ts` — a global keyed map that providers register against on mount and the realtime handlers dispatch through:

```ts
type RefetchKey =
  | 'team'
  | 'invites'
  | 'business'
  | 'businesses-list'
  | 'profile'

function registerRefetch(key: RefetchKey, fn: () => Promise<void>): () => void  // unregister
function callRefetch(key: RefetchKey): void
```

Each existing provider (`business-context.tsx`, the to-be-built `team-context` if it doesn't exist as a provider yet, etc.) imports `registerRefetch` and registers its `refetch` method on mount, unregisters on unmount. `callRefetch` no-ops gracefully if no provider has registered (e.g., realtime event arrives while user is on a screen that doesn't have the relevant provider mounted — covered by `useRevalidateOnFocus` next time they navigate there).

Handlers are idempotent: calling `callRefetch('team')` twice in quick succession debounces to one refetch via a leading-edge-100ms gate in the registry.

### 8.2 Handler registry — `apps/web/src/lib/realtime/handlers.ts`

A pure mapping from event type to side-effect. A `switch` over `RealtimeEvent['type']` with no `default` branch — TypeScript's exhaustiveness check fails the build if a new event type is added without a handler. This is the single most important guard against server/client drift.

Side-effects map approximately:

| Event | Side-effect |
|---|---|
| `team.*` | `callRefetch('team')`, `callRefetch('invites')` |
| `business.updated` | `callRefetch('business')` |
| `business.list.changed` | `callRefetch('businesses-list')` |
| `profile.updated fields:['language']` | refetch profile, then load new locale bundle (async, with a `LocaleProvider`-managed loading state) |
| `profile.updated` (other fields) | `callRefetch('profile')` |
| `session.revoked` | `revokeBusinessContext(event.businessId, event.reason)` |
| `business.deleted` | `revokeBusinessContext(event.businessId, 'business_deleted')` |
| `ownership.transferred` | refetch businesses-list; if active business changed role, `revokeBusinessContext` or full refresh |
| `system.resync` | refetch *everything currently registered* |
| `system.error` | display toast via `useApiMessage` mapping of the code |
| `system.auth_expired` | force logout flow |

**Idempotency contract:** every handler must be safe to call N times. `revokeBusinessContext` no-ops if the business has already been removed from the user's list.

### 8.3 `apps/web/src/components/providers/RealtimeProvider.tsx`

Owns the single `EventSource` instance for this device. Mounts **inside the auth provider** (needs the session) and **above all business/data providers** (needs to drive their refetch).

Responsibilities:
- Open EventSource when authenticated.
- Send `X-Device-Id` (read from localStorage; generated on first run) via the URL: `/api/realtime?businessId={id}&deviceId={id}`. EventSource cannot send custom headers, so identifiers travel in the query string. The server uses `deviceId` only for echo-suppression — it is **not** an authentication factor.
- Debounce active-business changes 250 ms before tearing down and reopening the EventSource.
- Close explicitly on logout.
- Echo suppression: drop events whose `originDeviceId === ownDeviceId`.
- Expose `revokeBusinessContext(businessId, reason)` to handlers.

### 8.4 Client heartbeat watchdog

EventSource does not detect half-open connections (NAT timeout on wifi/cell handoff, mobile-tab background suspend, etc.). The provider runs a watchdog:

- On every received message *or* heartbeat comment, reset a 45-second timer.
- On timer expiry: call `eventSource.close()`, immediately open a new one. The new connection sends `Last-Event-ID` so critical events are replayed.

This pairs with the server-side heartbeat (15 s) so the client expects ≥3 chances to receive a heartbeat before declaring the connection dead.

### 8.5 EventSource auth-expiry handling

EventSource's built-in retry on a 401 will loop forever — JS cannot disable it. Two server-driven mitigations and one client-side belt:

- **Server-driven:** SSE handler emits `system.auth_expired` and closes the stream when the session is invalid mid-stream (when this is detectable; primary path is "next reconnect 401s").
- **Server-driven:** On a 401 response to the EventSource HTTP request, the server includes `Retry-After: 600` so the browser backs off significantly between retries.
- **Client-side belt:** After three consecutive `error` events without an intervening `open`, the provider explicitly calls `eventSource.close()` and routes to the existing logged-out UX.

### 8.6 `revokeBusinessContext(businessId, reason)`

Concrete behavior — option B from the brainstorming Q&A:

1. **If `businessId` is not the currently active business:** silently drop it from the business list cache, refetch the businesses list, no toast. The user keeps doing what they're doing.
2. **If `businessId` is the currently active business:**
   - Close any open business-scoped modal explicitly via the modal system's programmatic close (per `modal-system.md`). The modal's own state cleanup runs via `onExitComplete` as required.
   - Show an Ionic toast with one of three react-intl keys (§15).
   - Navigate via `useIonRouter()` to the business-switcher route.
   - Refetch the businesses list so the removed business disappears.
   - Clear in-memory provider state for that business (business-context, products-context, etc.).
3. **If the user has no remaining businesses:** route to the create-or-join entry point. Cookie remains valid — the user is still logged in, just has nowhere to go.

`revokeBusinessContext` is idempotent — if called for a business that's already been cleared, it is a no-op.

## 9. Multi-Device Sync

The user channel carries non-critical UI hints. Concrete cases:

- **Profile updates.** User edits display name on the phone. Phone's API response updates `users.displayName` server-side and the local profile state. Server publishes `profile.updated { fields: ['displayName'], originDeviceId: 'phone-id' }` on `user:{id}`. Tablet receives, ignores nothing (different `originDeviceId`), calls `callRefetch('profile')`. Phone also receives its own event, but the echo-suppression in §8.3 filters it out — no flicker.
- **Language change.** Special case of `profile.updated { fields: ['language'] }`. Tablet receives, refetches profile, then asynchronously loads the new locale bundle via `LocaleProvider`. A loading indicator covers the swap; the user sees no broken state.
- **Business added/removed.** `business.list.changed` fires on the user channel when membership changes; switcher refetches.
- **Business renamed.** Triggers `business.updated { fields: ['name'] }` on the business channel for everyone *inside* that business AND a batched `business.list.changed { reason: 'renamed' }` on the user channel of every member (publisher iterates the member list — see §7.3 batched helper).

## 10. Session-Revocation Flow

Detailed in §8.6. Server-side, the member-removal handler and business-deletion handler MUST `await publishCriticalToUser` **before** responding 200. The stream `XADD` is what guarantees the revocation reaches the user even if they're offline at the moment of revocation — on their next SSE connect (which will reach the server's `XREAD`-from-`Last-Event-ID`), the event replays.

We do **not** invalidate JWTs server-side as part of this design. The existing 403-on-no-membership check at the route level remains the source of truth. Realtime revocation is a UX layer that converts "stale-until-next-request" into "live-within-seconds".

## 11. Lifecycle & Reconnection

| Trigger | Behaviour |
|---|---|
| User logs in | RealtimeProvider opens EventSource. |
| Active business changes | Provider closes and reopens with new `businessId` param, **debounced 250 ms**. |
| Active business cleared (back to switcher) | Provider closes and reopens *without* the param. |
| Tab backgrounds (`visibilitychange → hidden`) | Stream stays open until the browser kills the socket (mobile Safari/Chrome may do this aggressively). |
| Tab returns to foreground | The 45s watchdog timer (§8.4) is reset; if the underlying socket died during background, the watchdog detects within 45s and reconnects. Also `useRevalidateOnFocus` triggers (with its 5s debounce) for screens that wire it. |
| User logs out | Provider closes EventSource explicitly. |
| Server reaches 300s `maxDuration` | Server emits a final heartbeat and closes. Browser auto-reconnects with `Last-Event-ID`; replay covers any critical event in the gap. |
| Network blip | Browser auto-reconnects; or client watchdog forces reconnect within 45s. |
| Auth cookie expires mid-stream | Server emits `system.auth_expired` and closes. Client routes to logged-out UX (§8.5). |
| Upstash subscriber connection dies | Broker liveness watchdog (§7.2) detects within 30s; ioredis reconnects; broker re-issues SUBSCRIBE and emits synthetic `__resync__` → all SSE handlers emit `system.resync` to their clients → clients refetch everything currently registered. |
| Vercel rotates a Fluid instance | All SSE handlers on that instance get their `request.signal` aborted; each cleans up its broker listeners. Subscriber disconnects on process exit. Clients reconnect and land on a (possibly different) instance with no observable difference beyond the brief reconnect. |
| Vercel idle-suspends an instance | Liveness watchdog catches stale subscriber on next ping; forced reconnect on instance unfreeze. New SSE arrivals reopen the broker if needed. |

## 12. Failure Modes & Degradation

| Failure | Symptom | Behaviour |
|---|---|---|
| Upstash subscriber down at connect | SSE endpoint cannot subscribe | 503 HTTP response. Client maps the status to `REALTIME_UNAVAILABLE` (locale key) via the EventSource `error` handler. After 3 errors the client backs off the realtime layer for 5 minutes; REST + `useRevalidateOnFocus` carry the UI. |
| Upstash publisher down (`publishToBusiness` / `publishToUser`) | Non-critical event lost | Log warning, return successfully from the publish helper. Affected users see staleness covered by the next focus-refetch (≤5s after foregrounding). |
| Upstash publisher down (`publishCriticalToUser`) | Critical event might not be replayable | Throw `RealtimeUnavailableError`. Calling route returns 503 with `REALTIME_PUBLISH_UNAVAILABLE`. The DB write either rolls back (when wrapped in a transaction) or proceeds and we accept that the user learns of revocation only when their next protected REST call returns 403. |
| Subscriber re-subscribes after disconnect — events lost during gap | Pub/sub events between disconnect and `ready` are dropped | **`system.resync` event is emitted to all SSE clients on broker `ready`.** Each client refetches every registered scope. No silent staleness window. |
| Broker leak (listener not removed) | Channel never unsubscribes | `subscribe()` returns an unsubscribe fn. SSE handler MUST call it on `request.signal.abort`. Test coverage in §17 verifies. |
| Heartbeat write fails server-side | Half-open from server's view | Write throws inside the broker's listener; broker catches, logs, calls unsubscribe. Browser may also catch via watchdog. |
| Heartbeat not received client-side | Half-open from client's view | 45s watchdog (§8.4) closes and reopens EventSource. Replay via `Last-Event-ID` recovers any critical event. |
| Two `PUBLISH`es for the same logical event | Client receives duplicate | Acceptable — handlers are idempotent. Echo-suppression filters self-publishes. |
| `Last-Event-ID` forged by attacker | Replay arbitrary stream entries | The stream is `stream:user:{userId}` derived from the *authenticated session*, not the header. The attacker can only replay their own stream. Worst case: legitimate self-replay. Harmless. |
| User has many devices open | More connections per user | Each device = 1 SSE connection on (potentially the same) Vercel instance. Broker SUBSCRIBEs to `user:{id}` once regardless. No additional Upstash load. |
| Cross-origin EventSource open from a malicious page | Resource-only DoS | §7.5 step 2 rejects on missing `Sec-Fetch-Site: same-origin`. Browser sends this header automatically. |
| JSON parse failure on a Redis message | Bad payload | Wrapped in try/catch in broker (§7.2); logged; not propagated to listeners. |
| Dev-mode HMR reload | Old broker subscriber leaks | `globalThis` keying + `module.hot.dispose` cleanup (§7.2). Verified by repeated edits during `npm run dev`. |

## 13. Connection-Scaling Math

**Region pinning.** The SSE route is pinned to `iad1` (or whichever single region is closest to the primary user base — confirm during implementation) via Next.js's route segment config:

```ts
// apps/api/src/app/api/realtime/route.ts
export const preferredRegion = 'iad1'
```

This bounds the active-instance count to one region's Fluid pool.

**Naive baseline (no broker, no pinning):** 50 businesses × 5 members × 1.5 devices = ~375 simultaneous SSE streams = ~375 Upstash TCP connections.

**With broker + pinning:** Upstash TCP connections = `2 × instance_count` (one subscriber + one publisher per instance). At early-stage Kasero scale, expect 5–15 active Fluid instances in one region under organic load; ~30–50 instances during a spike.

**Prerequisite (was Open Q #1; promoted):** Before merge, verify the Upstash free-tier connection cap from the Upstash dashboard. If the cap is ≤ 50, the broker + region pin still gives us 1×–2× headroom under realistic load but no spike headroom; in that case, document the connection-cap monitor and a graceful-degrade path (502 on subscriber unavailable, client falls back to focus-refetch for ~5 minutes).

**Load-test acceptance bar:**
- 200 concurrent EventSource clients across 10 simulated businesses, sustained for 10 minutes. Upstash connections observed < 30, no event-loss in event-delivery probes.
- 50 reconnect storms in 10 seconds (simulating a network blip across all users). Upstash connections observed < 50, system.resync delivered to ≥ 95% of reconnected clients, no broker crash.

## 14. Code Organization

### Shared

```
packages/shared/src/realtime/
├── types.ts          # RealtimeEvent discriminated union + channel name helpers + originDeviceId
└── index.ts
```

### API

```
apps/api/src/lib/realtime/
├── redis.ts          # lazy ioredis subscriber + publisher
├── broker.ts         # per-instance shared-subscriber broker (globalThis-keyed)
├── publisher.ts      # publishToBusiness / publishToUser / publishCriticalToUser + batched broadcast helper
├── streams.ts        # readUserStreamSince + XINFO/XREVRANGE first-connect tip helper
├── errors.ts         # RealtimeUnavailableError
└── index.ts

apps/api/src/app/api/realtime/
└── route.ts          # SSE endpoint
```

### Web

```
apps/web/src/lib/realtime/
├── refetch-registry.ts  # global registry of refetch callbacks
├── handlers.ts          # event → side-effect mapping (exhaustive switch)
├── device-id.ts         # localStorage-backed stable device ID
└── index.ts

apps/web/src/components/providers/
└── RealtimeProvider.tsx # owns EventSource, watchdog, echo suppression
```

Provider stack position (in the existing tree under `apps/web/src/components/providers/`): inside auth provider, above all business/data providers. The exact insertion point is named explicitly during the implementation plan.

## 15. Environment Variables, Secrets, Locale Keys, and ApiMessageCodes

### Env

New `apps/api/.env.local` key:
```
UPSTASH_REDIS_URL=rediss://default:<password>@<host>:<port>
```

Bitwarden note `Kasero — apps/api/.env.local` updated in the same PR. Web app needs no new env vars. `apps/api/.env.example` updated.

### Dependencies

`apps/api/package.json` gets `ioredis`. No new web deps.

### New ApiMessageCodes (added to `packages/shared/src/api-messages.ts`)

- `REALTIME_UNAVAILABLE` — SSE subscribe or stream replay failed; client falls back to focus refetch.
- `REALTIME_PUBLISH_UNAVAILABLE` — Critical publish failed; route returns 503.

### New react-intl keys (en-US.json, es.json, ja.json — all three languages per CLAUDE.md rule 3)

| Key | Use |
|---|---|
| `session_revoked_removed` | "You've been removed from {businessName}." |
| `session_revoked_business_deleted` | "{businessName} was deleted by the owner." |
| `session_revoked_ownership_transferred` | "{businessName} ownership was transferred." |
| `realtime_disconnected_banner` | "Live updates paused. Reconnecting…" (shown after 3 failed reconnects) |
| `error_realtime_unavailable` | Fallback for `REALTIME_UNAVAILABLE` envelope. |
| `error_realtime_publish_unavailable` | Fallback for `REALTIME_PUBLISH_UNAVAILABLE`. |

After adding keys, regenerate `apps/web/src/i18n/messageIds.d.ts` via `npm run i18n:types --workspace=apps/web`.

## 16. CSP & Service Worker

**CSP:** No directive changes needed (same-origin SSE). Verify in DevTools Console after merge per the Content Security Policy section of CLAUDE.md.

**Service Worker:** The existing `NetworkOnly` route for `/api/*` in `sw.ts` already prevents Workbox from caching SSE responses, but the request still passes through the SW. To remove the SW from the SSE chain entirely, add a top-level fetch-event bypass:

```ts
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.pathname === '/api/realtime') {
    return  // do not call respondWith; browser fetches directly
  }
})
```

This event listener is registered **before** any Workbox `registerRoute` calls. Verified via DevTools: the request for `/api/realtime` shows no ServiceWorker entry in its initiator chain.

## 17. Testing Strategy

### Server unit tests (`apps/api/src/test/`)

- **Broker refcounting.** Two listeners → one SUBSCRIBE. Removing one → no UNSUBSCRIBE. Removing the last → UNSUBSCRIBE.
- **Broker resync.** Simulate subscriber `end` then `ready`. Assert SUBSCRIBE re-issued for every active channel. Assert synthetic `__resync__` emitted to every active listener.
- **Broker liveness watchdog.** Simulate `ping()` failure. Assert force-reconnect attempted.
- **Stream replay.** Seed `stream:user:U` with three entries. `readUserStreamSince(U, secondEntry.id)` → only third entry returns.
- **Stream first-connect.** `XREVRANGE` returns current tip. `readUserStreamSince(U, tip)` → empty.
- **Stream MAXLEN 100 exact.** Write 105 entries. Assert length == 100.
- **Stream TTL.** After XADD, assert `PTTL` is set.
- **Publisher fail-open.** Mock publisher disconnect. `publishToBusiness` → no throw, warning logged.
- **Publisher fail-closed.** Mock publisher disconnect. `publishCriticalToUser` → throws `RealtimeUnavailableError`.
- **Publisher pipeline.** `publishCriticalToUser` issues a single MULTI/EXEC with XADD+PUBLISH.
- **Batched broadcast.** Renaming a business iterates members and pipelines all PUBLISHes in one round-trip.

### Server integration tests

- **End-to-end pub/sub.** SSE route + real Upstash test DB (or `ioredis-mock` if it covers MULTI semantics). Publish from publisher → SSE response chunk contains the event.
- **End-to-end stream replay.** Publish a critical event with no client connected. Connect with `Last-Event-ID = 0`. Event arrives in response.
- **Authorization.** GET `/api/realtime?businessId=X` as a user not in X → 403.
- **CSRF defense.** GET without `Sec-Fetch-Site: same-origin` → 403.
- **Auth.** GET without session cookie → 401.
- **Better-auth in node runtime.** Confirm `auth.api.getSession` resolves under streaming response (E4 from review).
- **Resync on subscriber bounce.** Bounce the subscriber. Connected client receives `system.resync`.

### Client tests (`apps/web/src/test/...`)

- **Handler exhaustiveness.** TS-level test: a switch over `RealtimeEvent['type']` with no default branch compiles.
- **Refetch registry.** Register two refetches under same key, call → both invoked (leading-edge 100ms debounced).
- **Handler dispatch.** Mock EventSource emits `team.member.joined` → `callRefetch('team')` invoked.
- **Revoke flow.** Active business → toast shown, router pushed to switcher, in-memory provider cleared. Non-active business → no toast, list refetched.
- **Echo suppression.** Emit event with `originDeviceId == ownDeviceId` → handler skipped.
- **Watchdog.** No heartbeat for 45s → EventSource.close + new open.
- **Auth-expiry.** 3× error events without intervening open → close + route to logged-out UX.

### Manual verification (browser, prod-preview)

- Owner on device A, invite modal open. Joiner on device B accepts. Within 1s, owner's modal updates: invite gone, member appears.
- Owner removes a member. Member's device routes to switcher with toast.
- Owner deletes business. All members route to switcher with toast.
- Language change on phone → tablet swaps within 1s (with loading indicator).
- Hard-reload owner page mid-session → reconnect with replay covers any critical event missed during the reload.
- Simulate Upstash blip via `redis-cli FLUSHALL` (test DB only) → connected client receives `system.resync`, UI refetches.
- Open EventSource with a forged `Last-Event-ID` → only own-user stream entries replay.
- DevTools network tab confirms `/api/realtime` shows no ServiceWorker initiator.

### Load test

Per §13 acceptance bar: 200 concurrent clients sustained, 50 reconnect storms.

## 18. Migration & Rollout

**Single PR.** No phasing. The PR contains:

1. New `ioredis` dep and lazy redis singletons.
2. Broker + publisher + streams libs with unit tests.
3. SSE route with auth/CSRF/auth-z/access cache/heartbeat/resync/error/auth-expiry plumbing.
4. All publish-site wirings (every row in §7.6).
5. Client refetch registry, handler registry, RealtimeProvider, device-id, watchdog, revoke flow.
6. New `ApiMessageCode` entries.
7. New react-intl keys across `en-US`, `es`, `ja`, with regenerated `messageIds.d.ts`.
8. SW fetch-bypass for `/api/realtime`.
9. Tests at every level enumerated in §17.
10. Updated `apps/api/.env.example` and Bitwarden notes.
11. New `realtime-system.md` doc under `.claude/docs/` linked from `backend-patterns.md`, `performance-patterns.md`, and the project tree.

Load test (§13 bar) runs against a Vercel preview before merge. CI is unchanged.

**Prereqs (must be answered before code lands):**
1. Empirical Upstash free-tier connection cap.
2. Exact route paths for member-removal, role-change, status-change, profile-mutation.
3. Confirm `ioredis` over Vite dev proxy works with SSE streaming. If not, dev workflow runs against `http://localhost:8000` directly.
4. Confirm Vercel Fluid Compute keeps module-scope state under expected concurrency. Verified via a one-off probe in a preview env.

No feature flag. If the SSE layer fails entirely, the app degrades to today's behavior (poll-on-focus). No flag UX overhead.

## 19. Definition of Done

- All §6 events publish from their respective routes.
- All §6 + §7 system events have client handlers with exhaustive switch typing.
- Broker has unit tests for refcounting, resync, and liveness.
- Stream tests for replay, first-connect tip, MAXLEN 100, TTL.
- SSE route tests for auth, CSRF, authorization, resync, better-auth-in-node-runtime.
- Client tests for handler dispatch, revoke flow, echo suppression, watchdog, auth-expiry.
- Manual verification scenarios all pass against a Vercel preview.
- Load test acceptance bar met.
- New env var documented in `apps/api/.env.example` + Bitwarden.
- New `ApiMessageCode` entries land with translations in en/es/ja.
- New react-intl keys translated and `messageIds.d.ts` regenerated.
- `ioredis` listed in `apps/api/package.json`.
- SW fetch-bypass landed and verified.
- `realtime-system.md` written and cross-referenced from `backend-patterns.md` and `performance-patterns.md`.
- CSP audit clean in DevTools Console on a deployed preview.
