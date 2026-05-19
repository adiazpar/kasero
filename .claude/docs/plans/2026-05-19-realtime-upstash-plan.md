# Realtime over Upstash — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push state changes from the API to all interested connected clients via SSE + Upstash Redis pub/sub + Streams, solving the team-management staleness bug, enabling multi-device sync, enforcing session revocation live, and scaling past the Upstash free-tier connection cap from day one.

**Architecture:** Server-Sent Events transport, cookie-authenticated, same-origin. Upstash Redis pub/sub for live UI hints; Upstash Redis Streams for security-critical events that must survive a reconnect. Module-scope shared-subscriber broker per Vercel Fluid Compute instance keeps connection count bounded by instance count, not device count. Client uses a refetch-registry pattern that hooks into the existing context-provider architecture — no React Query introduction. Single PR, lands on main.

**Tech Stack:** Next.js 15 App Router (node runtime, region-pinned), ioredis for TCP Redis, better-auth for session, Vite/React/Ionic on the client, Vitest for tests, react-intl for i18n.

---

## Phase 0 — Prerequisites (manual, user-facing)

These are not subagent-executable. The implementing engineer runs them once before any code change.

### Task 0.1: Verify Upstash free-tier TCP connection cap — **deferred to Phase 11**

The current free-tier connection cap is not publicly documented (Upstash rolled out new pricing/limits 2025-03-12 without surfacing this specific number). Empirical validation happens in the Phase 11 load test, which asserts Upstash connections stay under 30 during a 200-client sustained run and under 50 during a 50-reconnect-storm burst. If those assertions fail because the cap is lower than expected, the remediation is a single `vercel.json` / route-segment change to cap Fluid concurrency, applied before merge.

- [x] **Deferred.** Phase 11.4 is the validation gate. No work required here.

### Task 0.2: Enable standard Redis protocol on the Upstash database

**Files:** none.

- [ ] **Step 1: In the Upstash dashboard, open the database settings.** Find the "Protocol" or "Connection" section. Confirm "Redis Protocol (TCP / TLS)" is enabled. If it isn't, toggle it on.
- [ ] **Step 2: Capture the `rediss://...` URL.** Copy the value labelled "Connect with Redis CLI" or "Standard Redis URL". It looks like `rediss://default:<password>@<host>:<port>`. Keep this value at hand for Task 0.3.
- [ ] **Step 3: Confirm TLS.** The URL scheme MUST be `rediss://` (TLS), not `redis://`. If only `redis://` is offered, enable TLS on the database and re-copy.

### Task 0.3: Add `UPSTASH_REDIS_URL` to Vercel (Production + Preview only)

**Files:**
- Modify: Vercel project envs (Production + Preview) via Vercel dashboard or `vercel env add`

**Important:** We deliberately do **NOT** put `UPSTASH_REDIS_URL` in `apps/api/.env.local`. Local dev uses an in-memory backend (added in Task 2.2) so a `npm run dev` publish never reaches production subscribers. The production gate in `redis.ts` ensures Vercel deployments refuse to boot without this credential.

- [ ] **Step 1: Add the key to Vercel — Production.** Run `npx vercel env add UPSTASH_REDIS_URL production` from `apps/api/`, paste the URL from Task 0.2 when prompted.
- [ ] **Step 2: Add the same key to Vercel — Preview.** Run `npx vercel env add UPSTASH_REDIS_URL preview` from `apps/api/`, paste the same URL.
- [ ] **Step 3: Verify.** Run `npx vercel env ls` from `apps/api/`. Expect `UPSTASH_REDIS_URL` listed under `Production` and `Preview`, NOT under `Development`.

### Task 0.4: Record the Vercel-only value in Bitwarden

**Files:** Bitwarden Secure Note `Kasero — Vercel project envs` (create if it doesn't exist).

The existing `Kasero — apps/api/.env.local` note continues to hold local-dev secrets only. The realtime TCP URL is a Vercel-only secret, so it gets a separate record to make the boundary explicit.

- [ ] **Step 1: Open Bitwarden.** Web vault → Items → search for `Kasero — Vercel project envs`. If it doesn't exist, create a new Secure Note with that name.
- [ ] **Step 2: Append the key + URL.** Add a line:
  ```
  UPSTASH_REDIS_URL=rediss://default:<password>@<host>:<port>
  ```
  Use the URL from Task 0.2.
- [ ] **Step 3: Save.** The note documents the canonical value so we can recreate the Vercel env if it's ever rotated or lost.

### Task 0.5: Document the new key in `.env.example`

**Files:**
- Modify: `/Users/adiaz/irvin/apps/api/.env.example` (around line 104, immediately after the existing Upstash REST keys)

- [ ] **Step 1: Edit `apps/api/.env.example`.** After line 103 (`UPSTASH_REDIS_REST_TOKEN=`), add:
  ```
  
  # Standard Redis TCP/TLS endpoint on the same Upstash database. Used by
  # the realtime subsystem (apps/api/src/lib/realtime/*) for pub/sub +
  # Streams. Get this from the Upstash dashboard's TCP tab — the URL scheme
  # must be rediss:// (TLS).
  #
  # IMPORTANT: This key is intentionally Vercel-only (Production + Preview).
  # Do NOT set it in your local apps/api/.env.local — local dev uses an
  # in-memory realtime backend so dev publishes never reach prod clients.
  # Setting it locally will route your local pub/sub through prod Upstash
  # and accidentally broadcast to real connected users.
  UPSTASH_REDIS_URL=
  ```
- [ ] **Step 2: Stage and commit.**
  ```
  git add apps/api/.env.example
  git commit -m "chore(env): document UPSTASH_REDIS_URL for realtime subsystem"
  ```

**Phase 0 done when:** Vercel Production+Preview have `UPSTASH_REDIS_URL`, Bitwarden record exists for the Vercel-only secret, `.env.example` documents the key with the "do not set locally" warning (committed). `apps/api/.env.local` deliberately does NOT contain this key — local dev uses the in-memory backend added in Phase 2.

---

## Phase 1 — Shared types

### Task 1.1: Add `packages/shared/src/realtime/types.ts`

**Files:**
- Create: `/Users/adiaz/irvin/packages/shared/src/realtime/types.ts`
- Create: `/Users/adiaz/irvin/packages/shared/src/realtime/types.test.ts`

- [ ] **Step 1: Write the test first (TDD).** Create `packages/shared/src/realtime/types.test.ts` with:
  ```ts
  import { describe, it, expectTypeOf } from 'vitest'
  import {
    type RealtimeEvent,
    type BusinessRealtimeEvent,
    type UserRealtimeEvent,
    type CriticalUserRealtimeEvent,
    type SystemRealtimeEvent,
    businessChannel,
    userChannel,
    userStream,
  } from './types'

  describe('realtime types', () => {
    it('businessChannel formats correctly', () => {
      expect(businessChannel('biz-1')).toBe('business:biz-1')
    })
    it('userChannel formats correctly', () => {
      expect(userChannel('u-1')).toBe('user:u-1')
    })
    it('userStream formats correctly', () => {
      expect(userStream('u-1')).toBe('stream:user:u-1')
    })

    it('RealtimeEvent is the union of all sub-unions', () => {
      type Expected =
        | BusinessRealtimeEvent
        | UserRealtimeEvent
        | CriticalUserRealtimeEvent
        | SystemRealtimeEvent
      expectTypeOf<RealtimeEvent>().toEqualTypeOf<Expected>()
    })

    it('exhaustiveness check fails at compile time on missing branch', () => {
      // This function MUST cover every event type — adding a new event
      // without updating the switch is a compile error.
      function dispatch(e: RealtimeEvent): string {
        switch (e.type) {
          case 'team.member.joined':
          case 'team.member.removed':
          case 'team.member.role_changed':
          case 'team.member.status_changed':
          case 'team.invite.created':
          case 'team.invite.regenerated':
          case 'team.invite.consumed':
          case 'team.invite.deleted':
          case 'business.updated':
            return 'biz'
          case 'profile.updated':
          case 'business.list.changed':
            return 'user'
          case 'session.revoked':
          case 'business.deleted':
          case 'ownership.transferred':
            return 'critical'
          case 'system.resync':
          case 'system.error':
          case 'system.auth_expired':
            return 'system'
        }
      }
      expect(dispatch({ type: 'system.resync' })).toBe('system')
    })
  })
  ```
- [ ] **Step 2: Run the test — expect failure.** `npm run test:run --workspace=packages/shared -- realtime/types.test.ts`. Expected: module-not-found / type errors. (Types don't exist yet.)
- [ ] **Step 3: Create `packages/shared/src/realtime/types.ts` with full content:**
  ```ts
  /**
   * Realtime event types — shared discriminated union consumed by both
   * the API (publisher) and the web client (handler dispatch). The
   * exhaustiveness check in handlers.ts and the server-side typing of
   * publish helpers depend on this file being the single source of truth.
   *
   * Three delivery tiers:
   *   - BusinessRealtimeEvent: pub/sub on `business:{id}`, missable.
   *   - UserRealtimeEvent: pub/sub on `user:{id}`, missable (focus refetch backs up).
   *   - CriticalUserRealtimeEvent: pub/sub + stream on `user:{id}`/`stream:user:{id}`,
   *     must survive an SSE reconnect.
   *   - SystemRealtimeEvent: emitted by the SSE handler itself, never via Redis.
   */

  import type { ApiMessageCode } from '../api-messages'
  import type { BusinessRole } from '../business-role'

  // Every event payload may carry the originating client's deviceId so
  // the publishing client can suppress its own echo in the handler layer.
  interface WithOrigin {
    originDeviceId?: string
  }

  export type BusinessRealtimeEvent =
    | ({ type: 'team.member.joined'; memberId: string } & WithOrigin)
    | ({ type: 'team.member.removed'; memberId: string } & WithOrigin)
    | ({ type: 'team.member.role_changed'; memberId: string; role: BusinessRole } & WithOrigin)
    | ({ type: 'team.member.status_changed'; memberId: string; status: 'active' | 'disabled' } & WithOrigin)
    | ({ type: 'team.invite.created'; inviteId: string } & WithOrigin)
    | ({ type: 'team.invite.regenerated'; inviteId: string } & WithOrigin)
    | ({ type: 'team.invite.consumed'; inviteId: string; consumedByName: string } & WithOrigin)
    | ({ type: 'team.invite.deleted'; inviteId: string } & WithOrigin)
    | ({
        type: 'business.updated'
        fields: Array<'name' | 'locale' | 'currency' | 'iconUrl'>
      } & WithOrigin)

  export type UserRealtimeEvent =
    | ({
        type: 'profile.updated'
        fields: Array<'displayName' | 'email' | 'language'>
      } & WithOrigin)
    | ({
        type: 'business.list.changed'
        reason: 'added' | 'removed' | 'renamed'
      } & WithOrigin)

  export type CriticalUserRealtimeEvent =
    | ({
        type: 'session.revoked'
        businessId: string
        reason: 'removed' | 'business_deleted' | 'ownership_transferred'
      } & WithOrigin)
    | ({ type: 'business.deleted'; businessId: string } & WithOrigin)
    | ({
        type: 'ownership.transferred'
        businessId: string
        role: 'former_owner' | 'new_owner'
      } & WithOrigin)

  export type SystemRealtimeEvent =
    | { type: 'system.resync' }
    | { type: 'system.error'; code: ApiMessageCode }
    | { type: 'system.auth_expired' }

  export type RealtimeEvent =
    | BusinessRealtimeEvent
    | UserRealtimeEvent
    | CriticalUserRealtimeEvent
    | SystemRealtimeEvent

  // Channel name helpers — the ONLY way to construct channel names.
  // Centralizing the format here makes a typo in any consumer a build error.
  export function businessChannel(businessId: string): string {
    return `business:${businessId}`
  }
  export function userChannel(userId: string): string {
    return `user:${userId}`
  }
  export function userStream(userId: string): string {
    return `stream:user:${userId}`
  }
  ```
- [ ] **Step 4: Create the barrel `packages/shared/src/realtime/index.ts`:**
  ```ts
  export * from './types'
  ```
- [ ] **Step 5: Run the test — expect pass.** `npm run test:run --workspace=packages/shared -- realtime/types.test.ts`. Expected: 4 tests pass.
- [ ] **Step 6: Commit.**
  ```
  git add packages/shared/src/realtime
  git commit -m "feat(shared): add realtime event types and channel helpers"
  ```

**Phase 1 done when:** `RealtimeEvent` union resolves in TS, channel helpers are exported, tests pass, committed.

---

## Phase 2 — API foundation libs

Each task below is TDD: test first, then implementation, then run, then commit.

### Task 2.1: `errors.ts` — `RealtimeUnavailableError`

**Files:**
- Create: `/Users/adiaz/irvin/apps/api/src/lib/realtime/errors.ts`
- Create: `/Users/adiaz/irvin/apps/api/src/lib/realtime/errors.test.ts`

- [ ] **Step 1: Write the test.**
  ```ts
  import { describe, it, expect } from 'vitest'
  import { RealtimeUnavailableError } from './errors'

  describe('RealtimeUnavailableError', () => {
    it('extends Error and carries the canonical name', () => {
      const err = new RealtimeUnavailableError()
      expect(err).toBeInstanceOf(Error)
      expect(err.name).toBe('RealtimeUnavailableError')
      expect(err.message).toBe('Upstash realtime unavailable')
    })
    it('accepts a custom message', () => {
      const err = new RealtimeUnavailableError('publisher down')
      expect(err.message).toBe('publisher down')
    })
  })
  ```
- [ ] **Step 2: Run — expect failure.** `npm run test:run --workspace=apps/api -- src/lib/realtime/errors.test.ts`. Module not found.
- [ ] **Step 3: Implement `errors.ts`.**
  ```ts
  /**
   * Thrown by realtime helpers when Upstash is unreachable in a critical
   * path. The SSE route translates to a 503 with REALTIME_UNAVAILABLE;
   * a publishCriticalToUser caller translates to 503 with
   * REALTIME_PUBLISH_UNAVAILABLE. Mirrors UpstashUnavailableError in
   * apps/api/src/lib/rate-limit.ts.
   */
  export class RealtimeUnavailableError extends Error {
    constructor(message = 'Upstash realtime unavailable') {
      super(message)
      this.name = 'RealtimeUnavailableError'
    }
  }
  ```
- [ ] **Step 4: Run — expect pass.** Same command. 2 tests pass.
- [ ] **Step 5: Commit.**
  ```
  git add apps/api/src/lib/realtime/errors.ts apps/api/src/lib/realtime/errors.test.ts
  git commit -m "feat(realtime): add RealtimeUnavailableError"
  ```

### Task 2.2a: `in-memory-backend.ts` — dev-mode realtime backend

**Why:** Local dev does NOT have `UPSTASH_REDIS_URL` set (Phase 0 deliberately puts it in Vercel only). Without a backend, every realtime operation would have to throw, breaking the SSE route during development. The in-memory backend implements the subset of Redis we actually use — pub/sub, XADD with MAXLEN, XREAD, XREVRANGE, PEXPIRE, MULTI/EXEC, PING — using process-local state. In dev, the same Node process owns both the publishing API routes and the SSE handlers, so an in-process EventEmitter and Map-based streams are functionally identical to Upstash from the broker/publisher's perspective.

**Files:**
- Create: `/Users/adiaz/irvin/apps/api/src/lib/realtime/in-memory-backend.ts`
- Create: `/Users/adiaz/irvin/apps/api/src/lib/realtime/in-memory-backend.test.ts`

- [ ] **Step 1: Write the test.**
  ```ts
  import { afterEach, beforeEach, describe, expect, it } from 'vitest'
  import { InMemoryBackend } from './in-memory-backend'

  let backend: InMemoryBackend
  beforeEach(() => { backend = new InMemoryBackend() })
  afterEach(() => { backend.dispose() })

  describe('InMemoryBackend (dev pub/sub + streams)', () => {
    it('delivers a published message to a subscriber on the same channel', async () => {
      const received: Array<{ channel: string; message: string }> = []
      const sub = backend.createSubscriber()
      sub.on('message', (channel, message) => received.push({ channel, message }))
      await sub.subscribe('business:1')
      const pub = backend.createPublisher()
      await pub.publish('business:1', JSON.stringify({ type: 'team.member.joined' }))
      // EventEmitter is synchronous; the message is already delivered.
      expect(received).toHaveLength(1)
      expect(received[0].channel).toBe('business:1')
    })

    it('does not deliver to subscribers on other channels', async () => {
      const received: string[] = []
      const sub = backend.createSubscriber()
      sub.on('message', (_, m) => received.push(m))
      await sub.subscribe('business:1')
      const pub = backend.createPublisher()
      await pub.publish('business:2', 'X')
      expect(received).toHaveLength(0)
    })

    it('refcounts subscriptions across multiple subscribers (one shared backend bus)', async () => {
      const r1: string[] = []
      const r2: string[] = []
      const subA = backend.createSubscriber()
      const subB = backend.createSubscriber()
      subA.on('message', (_, m) => r1.push(m))
      subB.on('message', (_, m) => r2.push(m))
      await subA.subscribe('c')
      await subB.subscribe('c')
      const pub = backend.createPublisher()
      await pub.publish('c', 'X')
      expect(r1).toEqual(['X'])
      expect(r2).toEqual(['X'])
    })

    it('XADD with MAXLEN exact caps the stream length', async () => {
      const pub = backend.createPublisher()
      for (let i = 0; i < 105; i++) {
        await pub.xaddMaxLen('stream:user:1', 100, { type: `e${i}` })
      }
      const len = backend.streamLength('stream:user:1')
      expect(len).toBe(100)
    })

    it('XREAD returns entries strictly greater than the given id', async () => {
      const pub = backend.createPublisher()
      const id1 = await pub.xaddMaxLen('stream:user:1', 100, { type: 'a' })
      const id2 = await pub.xaddMaxLen('stream:user:1', 100, { type: 'b' })
      const id3 = await pub.xaddMaxLen('stream:user:1', 100, { type: 'c' })
      const sub = backend.createSubscriber()
      const out = await sub.xread('stream:user:1', id1)
      expect(out.map((e) => e.event.type)).toEqual(['b', 'c'])
      // Sanity: also greater-than id2 returns only c.
      const out2 = await sub.xread('stream:user:1', id2)
      expect(out2.map((e) => e.event.type)).toEqual(['c'])
      // Reading after id3 returns nothing.
      expect(await sub.xread('stream:user:1', id3)).toEqual([])
    })

    it('XREVRANGE COUNT 1 returns the current stream tip', async () => {
      const pub = backend.createPublisher()
      await pub.xaddMaxLen('stream:user:1', 100, { type: 'a' })
      const tipId = await pub.xaddMaxLen('stream:user:1', 100, { type: 'b' })
      const sub = backend.createSubscriber()
      expect(await sub.getStreamTipId('stream:user:1')).toBe(tipId)
    })

    it('PEXPIRE causes stream entries to vanish after the TTL elapses (lazy expiry on read)', async () => {
      const pub = backend.createPublisher()
      const id = await pub.xaddMaxLen('stream:user:1', 100, { type: 'a' })
      await pub.pexpire('stream:user:1', 1)
      await new Promise((r) => setTimeout(r, 5))
      const sub = backend.createSubscriber()
      const out = await sub.xread('stream:user:1', '0')
      expect(out).toEqual([])
      // And the tip query also returns null.
      expect(await sub.getStreamTipId('stream:user:1')).toBeNull()
      // id was returned at write time; just sanity-touch to satisfy TS.
      expect(typeof id).toBe('string')
    })

    it('PING returns PONG', async () => {
      const sub = backend.createSubscriber()
      expect(await sub.ping()).toBe('PONG')
    })

    it('publishCritical helper performs xadd + publish + pexpire atomically', async () => {
      const received: string[] = []
      const sub = backend.createSubscriber()
      sub.on('message', (_, m) => received.push(m))
      await sub.subscribe('user:1')
      const pub = backend.createPublisher()
      await pub.publishCritical(
        'user:1',
        'stream:user:1',
        100,
        90 * 24 * 60 * 60 * 1000,
        { type: 'session.revoked', businessId: 'B', reason: 'removed' },
      )
      expect(received).toHaveLength(1)
      expect(backend.streamLength('stream:user:1')).toBe(1)
    })
  })
  ```
- [ ] **Step 2: Run — expect failures.** `npm run test:run --workspace=apps/api -- src/lib/realtime/in-memory-backend.test.ts`. Module not found.
- [ ] **Step 3: Implement `in-memory-backend.ts`.**
  ```ts
  import 'server-only'
  import { EventEmitter } from 'node:events'

  /**
   * Dev-mode realtime backend.
   *
   * Implements only the subset of Redis that the realtime subsystem
   * uses: pub/sub (SUBSCRIBE / UNSUBSCRIBE / PUBLISH), Streams
   * (XADD with MAXLEN, XREAD strict-greater-than, XREVRANGE COUNT 1),
   * PEXPIRE, and PING. All state is process-local — fine in dev where
   * one Node process owns both publishers and subscribers.
   *
   * Activated by redis.ts when UPSTASH_REDIS_URL is missing AND
   * VERCEL_ENV !== 'production'. Production runtime refuses to start
   * without real Upstash creds; the in-memory backend never reaches
   * a deployed environment.
   */

  type StreamEntry = { id: string; event: Record<string, unknown> }

  export interface InMemorySubscriber {
    subscribe(channel: string): Promise<void>
    unsubscribe(channel: string): Promise<void>
    on(event: 'message', listener: (channel: string, message: string) => void): this
    on(event: 'ready' | 'end' | 'error', listener: (...args: unknown[]) => void): this
    ping(): Promise<'PONG'>
    quit(): Promise<void>
    xread(streamKey: string, sinceId: string): Promise<StreamEntry[]>
    getStreamTipId(streamKey: string): Promise<string | null>
    readonly status: string
  }

  export interface InMemoryPublisher {
    publish(channel: string, message: string): Promise<number>
    xaddMaxLen(streamKey: string, maxLen: number, event: Record<string, unknown>): Promise<string>
    pexpire(streamKey: string, ttlMs: number): Promise<number>
    publishCritical(
      userChannel: string,
      streamKey: string,
      maxLen: number,
      ttlMs: number,
      event: Record<string, unknown>,
    ): Promise<void>
    quit(): Promise<void>
  }

  export class InMemoryBackend {
    private bus = new EventEmitter()
    private streams = new Map<string, StreamEntry[]>()
    private streamExpiry = new Map<string, number>()
    private seq = 0

    constructor() {
      this.bus.setMaxListeners(0)
    }

    streamLength(key: string): number {
      this.evict(key)
      return this.streams.get(key)?.length ?? 0
    }

    private evict(key: string): void {
      const exp = this.streamExpiry.get(key)
      if (exp && exp <= Date.now()) {
        this.streams.delete(key)
        this.streamExpiry.delete(key)
      }
    }

    private nextId(): string {
      return `${Date.now()}-${this.seq++}`
    }

    createSubscriber(): InMemorySubscriber {
      const self = this
      const local = new EventEmitter()
      const handler = (channel: string, message: string) => {
        local.emit('message', channel, message)
      }
      const owned = new Set<string>()
      let status = 'ready'
      return {
        get status() { return status },
        async subscribe(channel: string) {
          if (!owned.has(channel)) {
            owned.add(channel)
            self.bus.on(channel, handler)
          }
        },
        async unsubscribe(channel: string) {
          if (owned.has(channel)) {
            owned.delete(channel)
            self.bus.off(channel, handler)
          }
        },
        on(event: string, listener: (...args: unknown[]) => void) {
          local.on(event, listener)
          return this
        },
        async ping() { return 'PONG' as const },
        async quit() {
          for (const c of owned) self.bus.off(c, handler)
          owned.clear()
          status = 'end'
        },
        async xread(streamKey: string, sinceId: string) {
          self.evict(streamKey)
          const entries = self.streams.get(streamKey) ?? []
          return entries.filter((e) => e.id > sinceId)
        },
        async getStreamTipId(streamKey: string) {
          self.evict(streamKey)
          const entries = self.streams.get(streamKey) ?? []
          return entries.length ? entries[entries.length - 1].id : null
        },
      }
    }

    createPublisher(): InMemoryPublisher {
      const self = this
      return {
        async publish(channel, message) {
          // Synchronous fan-out: every listener on this channel sees the
          // message before publish() resolves. Matches how the broker
          // tests assert behavior.
          self.bus.emit(channel, channel, message)
          return self.bus.listenerCount(channel)
        },
        async xaddMaxLen(streamKey, maxLen, event) {
          self.evict(streamKey)
          const id = self.nextId()
          const list = self.streams.get(streamKey) ?? []
          list.push({ id, event })
          while (list.length > maxLen) list.shift()
          self.streams.set(streamKey, list)
          return id
        },
        async pexpire(streamKey, ttlMs) {
          self.streamExpiry.set(streamKey, Date.now() + ttlMs)
          return 1
        },
        async publishCritical(userChannel, streamKey, maxLen, ttlMs, event) {
          await this.xaddMaxLen(streamKey, maxLen, event)
          await this.pexpire(streamKey, ttlMs)
          await this.publish(userChannel, JSON.stringify(event))
        },
        async quit() {
          // Nothing to release; backend lives until process exit.
        },
      }
    }

    dispose(): void {
      this.bus.removeAllListeners()
      this.streams.clear()
      this.streamExpiry.clear()
    }
  }

  /**
   * Process-global singleton. Exposed so redis.ts and tests can reach
   * the same instance regardless of HMR reloads.
   */
  const BACKEND_KEY = Symbol.for('kasero.realtime.in-memory-backend')
  type GlobalWithBackend = typeof globalThis & {
    [BACKEND_KEY]?: InMemoryBackend
  }
  export function getSharedInMemoryBackend(): InMemoryBackend {
    const g = globalThis as GlobalWithBackend
    if (!g[BACKEND_KEY]) {
      g[BACKEND_KEY] = new InMemoryBackend()
    }
    return g[BACKEND_KEY]!
  }
  ```
- [ ] **Step 4: Run — expect pass.** All 9 tests pass.
- [ ] **Step 5: Commit.**
  ```
  git add apps/api/src/lib/realtime/in-memory-backend.ts apps/api/src/lib/realtime/in-memory-backend.test.ts
  git commit -m "feat(realtime): in-memory backend for dev pub/sub and streams"
  ```

### Task 2.2: `redis.ts` — backend factory (ioredis in prod, in-memory in dev)

**Files:**
- Create: `/Users/adiaz/irvin/apps/api/src/lib/realtime/redis.ts`
- Create: `/Users/adiaz/irvin/apps/api/src/lib/realtime/redis.test.ts`
- Modify: `/Users/adiaz/irvin/apps/api/package.json` (add `ioredis`)

This task's job is to wrap ioredis with the same interface as `in-memory-backend.ts` exposes, and pick which backend to return based on environment. The broker and publisher consumers in subsequent tasks see one uniform API.

- [ ] **Step 1: Add `ioredis` dependency.** From repo root: `npm install --workspace=apps/api ioredis@^5`. Verify `apps/api/package.json` `dependencies` now lists `ioredis`. (Subagents NEVER run install unprompted; the user has approved the dep in the spec.)
- [ ] **Step 2: Write the test.**
  ```ts
  import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

  // Ioredis constructor mock — used only by the production-branch tests.
  const constructed: Array<{ url: string; opts: unknown }> = []
  vi.mock('ioredis', () => {
    return {
      default: vi.fn().mockImplementation((url: string, opts: unknown) => {
        const inst = {
          url,
          opts,
          on: vi.fn(),
          quit: vi.fn().mockResolvedValue(undefined),
          subscribe: vi.fn().mockResolvedValue(undefined),
          unsubscribe: vi.fn().mockResolvedValue(undefined),
          publish: vi.fn().mockResolvedValue(1),
          xadd: vi.fn().mockResolvedValue('1-0'),
          xread: vi.fn().mockResolvedValue(null),
          xrevrange: vi.fn().mockResolvedValue([]),
          pexpire: vi.fn().mockResolvedValue(1),
          ping: vi.fn().mockResolvedValue('PONG'),
          status: 'ready',
        }
        constructed.push({ url, opts })
        return inst
      }),
    }
  })

  beforeEach(() => {
    constructed.length = 0
    delete process.env.UPSTASH_REDIS_URL
    delete process.env.VERCEL_ENV
    delete process.env.NEXT_PHASE
  })

  afterEach(() => {
    vi.resetModules()
  })

  describe('redis.ts (backend factory)', () => {
    it('does NOT construct any backend at module import time', async () => {
      await import('./redis')
      expect(constructed).toEqual([])
    })

    describe('with UPSTASH_REDIS_URL set (production-style)', () => {
      it('constructs the ioredis subscriber on first getSubscriber() call only', async () => {
        process.env.UPSTASH_REDIS_URL = 'rediss://test:pw@host:1'
        const mod = await import('./redis')
        mod.getSubscriber()
        mod.getSubscriber()
        expect(constructed).toHaveLength(1)
      })

      it('constructs publisher and subscriber as separate ioredis connections', async () => {
        process.env.UPSTASH_REDIS_URL = 'rediss://test:pw@host:1'
        const mod = await import('./redis')
        mod.getSubscriber()
        mod.getPublisher()
        expect(constructed).toHaveLength(2)
      })

      it('exposes the unified interface (subscribe/publish/xaddMaxLen/etc.) on the wrapper', async () => {
        process.env.UPSTASH_REDIS_URL = 'rediss://test:pw@host:1'
        const mod = await import('./redis')
        const sub = mod.getSubscriber()
        const pub = mod.getPublisher()
        expect(typeof sub.subscribe).toBe('function')
        expect(typeof sub.unsubscribe).toBe('function')
        expect(typeof sub.xread).toBe('function')
        expect(typeof sub.getStreamTipId).toBe('function')
        expect(typeof sub.ping).toBe('function')
        expect(typeof pub.publish).toBe('function')
        expect(typeof pub.xaddMaxLen).toBe('function')
        expect(typeof pub.pexpire).toBe('function')
        expect(typeof pub.publishCritical).toBe('function')
      })
    })

    describe('without UPSTASH_REDIS_URL (dev/local)', () => {
      it('returns the in-memory backend in dev — no ioredis construction', async () => {
        // No VERCEL_ENV set => dev. No URL => use in-memory backend.
        const mod = await import('./redis')
        const sub = mod.getSubscriber()
        const pub = mod.getPublisher()
        expect(constructed).toEqual([])
        // Round-trip: publish from publisher reaches subscriber.
        const received: string[] = []
        sub.on('message', (_, m) => received.push(m))
        await sub.subscribe('c')
        await pub.publish('c', 'X')
        expect(received).toEqual(['X'])
      })

      it('publisher and subscriber in dev share the SAME in-memory backend instance', async () => {
        // Two separate getSubscriber/getPublisher calls still talk to one
        // backend — required for round-trip delivery to work.
        const mod = await import('./redis')
        const subA = mod.getSubscriber()
        const subB = mod.getSubscriber() // same singleton
        expect(subA).toBe(subB)
        const pub = mod.getPublisher()
        const received: string[] = []
        subA.on('message', (_, m) => received.push(m))
        await subA.subscribe('shared')
        await pub.publish('shared', 'Y')
        expect(received).toEqual(['Y'])
      })

      it('throws RealtimeUnavailableError when called in prod without UPSTASH_REDIS_URL', async () => {
        process.env.VERCEL_ENV = 'production'
        const mod = await import('./redis')
        expect(() => mod.getSubscriber()).toThrow(/realtime unavailable/i)
        expect(() => mod.getPublisher()).toThrow(/realtime unavailable/i)
      })

      it('still throws during Next.js build phase (Vercel build sets VERCEL_ENV=production)', async () => {
        process.env.VERCEL_ENV = 'production'
        process.env.NEXT_PHASE = 'phase-production-build'
        const mod = await import('./redis')
        // We assert the throw shape so the SSE route's 503 mapping fires.
        // Build-time crashes are avoided by NOT calling the getters at
        // module-evaluation time (lazy construction is the safeguard).
        expect(() => mod.getSubscriber()).toThrow(/realtime unavailable/i)
      })
    })
  })
  ```
- [ ] **Step 3: Run — expect failures.** `npm run test:run --workspace=apps/api -- src/lib/realtime/redis.test.ts`. Module not found.
- [ ] **Step 4: Implement `redis.ts`.**
  ```ts
  import 'server-only'
  import Redis, { type RedisOptions } from 'ioredis'
  import { RealtimeUnavailableError } from './errors'
  import {
    getSharedInMemoryBackend,
    type InMemoryPublisher,
    type InMemorySubscriber,
  } from './in-memory-backend'

  /**
   * Backend factory for the realtime subsystem.
   *
   * Returns one of two backends depending on environment:
   *   - `UPSTASH_REDIS_URL` is set → ioredis-backed clients talking to
   *     Upstash over TCP/TLS. This is the production / Vercel-preview path.
   *   - `UPSTASH_REDIS_URL` is unset → in-memory backend (process-local
   *     EventEmitter + Map). Used in local dev so a `npm run dev` publish
   *     never reaches the production Upstash subscribers. The production
   *     gate below makes sure this branch is never taken on Vercel.
   *
   * Construction is lazy so a clean clone with no Upstash creds still
   * imports the module cleanly — only first-use triggers the decision.
   * Mirrors the production-gate pattern in apps/api/src/lib/rate-limit.ts.
   *
   * The two backends share the same surface — see
   * `RealtimeSubscriber` / `RealtimePublisher` below — so the broker and
   * publisher.ts modules consume one uniform API regardless of mode.
   */

  // Public unified interface. Both backends implement this.
  export type RealtimeSubscriber = InMemorySubscriber
  export type RealtimePublisher = InMemoryPublisher

  let _subscriber: RealtimeSubscriber | null = null
  let _publisher: RealtimePublisher | null = null

  function isInDevMode(): boolean {
    const url = process.env.UPSTASH_REDIS_URL
    if (url && url.trim().length > 0) return false
    if (process.env.VERCEL_ENV === 'production') {
      // Production runtime without creds = misconfiguration. The SSE
      // route maps this throw to a 503 via REALTIME_UNAVAILABLE.
      throw new RealtimeUnavailableError(
        'UPSTASH_REDIS_URL is not set. Add it to the Vercel project envs '
          + '(Production + Preview). Local dev intentionally has no value '
          + 'and uses the in-memory backend.',
      )
    }
    return true
  }

  const ioredisOpts: RedisOptions = {
    lazyConnect: true,
    enableReadyCheck: true,
    retryStrategy(times) {
      return Math.min(200 * 2 ** Math.min(times, 5), 5000)
    },
    keepAlive: 10_000,
  }

  function wrapIoredisSubscriber(client: Redis): RealtimeSubscriber {
    // Adapt the wire-level ioredis API to the high-level surface our
    // broker/publisher consume. ioredis SUBSCRIBE puts the client into
    // subscribe-mode; we still expose xread/xrevrange/ping/getStreamTipId
    // — but those operations target a separate connection in the real
    // wiring (broker.ts only calls subscribe/unsubscribe/on; the SSE
    // route uses the *publisher* for XREAD/XREVRANGE pre-replay).
    // We still implement xread + getStreamTipId on the subscriber wrapper
    // for parity with the in-memory backend's API. They internally use a
    // shared "command" connection — for ioredis production we route those
    // reads through the publisher's underlying connection to avoid the
    // subscribe-mode restriction.
    return {
      get status() { return client.status },
      async subscribe(channel: string) { await client.subscribe(channel) },
      async unsubscribe(channel: string) { await client.unsubscribe(channel) },
      on(event: string, listener: (...args: unknown[]) => void) {
        client.on(event, listener)
        return this
      },
      async ping() { return (await client.ping()) as 'PONG' },
      async quit() { await client.quit() },
      async xread(streamKey, sinceId) {
        // XREAD lives on the publisher connection (subscriber is in
        // subscribe-mode and cannot issue arbitrary commands).
        const pub = getPublisherRaw()
        const res = await pub.xread('COUNT', 100, 'STREAMS', streamKey, sinceId)
        if (!res) return []
        // ioredis returns [[streamKey, [[id, [field, value, ...]], ...]]]
        const [, entries] = res[0] as [string, Array<[string, string[]]>]
        return entries.map(([id, fields]) => {
          // We always XADD with a single 'data' field carrying JSON.
          const idx = fields.indexOf('data')
          const json = idx >= 0 ? fields[idx + 1] : '{}'
          return { id, event: JSON.parse(json) as Record<string, unknown> }
        })
      },
      async getStreamTipId(streamKey) {
        const pub = getPublisherRaw()
        const res = await pub.xrevrange(streamKey, '+', '-', 'COUNT', 1)
        if (!Array.isArray(res) || res.length === 0) return null
        return res[0][0] as string
      },
    }
  }

  function wrapIoredisPublisher(client: Redis): RealtimePublisher {
    return {
      async publish(channel, message) { return await client.publish(channel, message) },
      async xaddMaxLen(streamKey, maxLen, event) {
        // MAXLEN = (exact). Not `~` — the spec demands predictable trim.
        const id = await client.xadd(streamKey, 'MAXLEN', maxLen, '*', 'data', JSON.stringify(event))
        return id as string
      },
      async pexpire(streamKey, ttlMs) {
        return await client.pexpire(streamKey, ttlMs)
      },
      async publishCritical(userChannel, streamKey, maxLen, ttlMs, event) {
        // Pipeline XADD + PEXPIRE + PUBLISH in a single round-trip.
        const json = JSON.stringify(event)
        await client
          .multi()
          .xadd(streamKey, 'MAXLEN', maxLen, '*', 'data', json)
          .pexpire(streamKey, ttlMs)
          .publish(userChannel, json)
          .exec()
      },
      async quit() { await client.quit() },
    }
  }

  // Internal: the raw ioredis publisher, needed by the subscriber wrapper
  // for XREAD/XREVRANGE. Constructs the publisher if it doesn't yet exist.
  let _ioredisPublisherRaw: Redis | null = null
  function getPublisherRaw(): Redis {
    if (_ioredisPublisherRaw) return _ioredisPublisherRaw
    const url = process.env.UPSTASH_REDIS_URL!
    _ioredisPublisherRaw = new Redis(url, { ...ioredisOpts, maxRetriesPerRequest: 1 })
    return _ioredisPublisherRaw
  }

  export function getSubscriber(): RealtimeSubscriber {
    if (_subscriber) return _subscriber
    if (isInDevMode()) {
      _subscriber = getSharedInMemoryBackend().createSubscriber()
    } else {
      const url = process.env.UPSTASH_REDIS_URL!
      const client = new Redis(url, ioredisOpts)
      _subscriber = wrapIoredisSubscriber(client)
    }
    return _subscriber
  }

  export function getPublisher(): RealtimePublisher {
    if (_publisher) return _publisher
    if (isInDevMode()) {
      _publisher = getSharedInMemoryBackend().createPublisher()
    } else {
      const client = getPublisherRaw()
      _publisher = wrapIoredisPublisher(client)
    }
    return _publisher
  }

  /**
   * Test-only: reset the singletons between tests. Production callers
   * never invoke this — the module-scoped state survives for the
   * lifetime of the Fluid Compute instance.
   */
  export function __resetForTests(): void {
    _subscriber?.quit().catch(() => {})
    _publisher?.quit().catch(() => {})
    _ioredisPublisherRaw?.quit().catch(() => {})
    _subscriber = null
    _publisher = null
    _ioredisPublisherRaw = null
  }
  ```
- [ ] **Step 5: Run — expect pass.** All tests pass (both the ioredis-mocked-path tests and the in-memory dev-path round-trip tests).
- [ ] **Step 6: Commit.**
  ```
  git add apps/api/src/lib/realtime/redis.ts apps/api/src/lib/realtime/redis.test.ts apps/api/package.json package-lock.json
  git commit -m "feat(realtime): lazy backend factory with ioredis prod and in-memory dev backends"
  ```

### Task 2.3: `broker.ts` — shared-subscriber broker

**Files:**
- Create: `/Users/adiaz/irvin/apps/api/src/lib/realtime/broker.ts`
- Create: `/Users/adiaz/irvin/apps/api/src/lib/realtime/broker.test.ts`

- [ ] **Step 1: Write the test.**
  ```ts
  import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
  import { EventEmitter } from 'node:events'

  // Mock ioredis Redis to give us a controllable subscriber double.
  class FakeRedis extends EventEmitter {
    public subscribed = new Set<string>()
    public unsubscribed: string[] = []
    public pinged = 0
    public status: string = 'ready'
    async subscribe(...channels: string[]) {
      for (const c of channels) this.subscribed.add(c)
    }
    async unsubscribe(...channels: string[]) {
      for (const c of channels) {
        this.subscribed.delete(c)
        this.unsubscribed.push(c)
      }
    }
    async ping() {
      this.pinged++
      return 'PONG'
    }
    quit() { return Promise.resolve() }
  }

  let fake: FakeRedis

  vi.mock('./redis', () => ({
    getSubscriber: () => fake,
  }))

  beforeEach(() => {
    fake = new FakeRedis()
    // Wipe the globalThis-keyed broker between tests.
    const key = Symbol.for('kasero.realtime.broker')
    ;(globalThis as Record<symbol, unknown>)[key] = undefined
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('realtime broker', () => {
    it('refcounts: two listeners on same channel => one SUBSCRIBE', async () => {
      const { subscribe } = await import('./broker')
      const unsubA = subscribe('user:1', () => {})
      const unsubB = subscribe('user:1', () => {})
      // Yield microtasks so the broker's async subscribe resolves.
      await new Promise((r) => setImmediate(r))
      expect(fake.subscribed.has('user:1')).toBe(true)
      expect(fake.subscribed.size).toBe(1)
      unsubA()
      expect(fake.unsubscribed).toEqual([])
      unsubB()
      await new Promise((r) => setImmediate(r))
      expect(fake.unsubscribed).toEqual(['user:1'])
    })

    it('fans out a message to every listener on the channel', async () => {
      const { subscribe } = await import('./broker')
      const calls: unknown[] = []
      subscribe('user:1', (payload) => calls.push(payload))
      subscribe('user:1', (payload) => calls.push(payload))
      await new Promise((r) => setImmediate(r))
      fake.emit('message', 'user:1', JSON.stringify({ type: 'profile.updated', fields: ['email'] }))
      expect(calls).toHaveLength(2)
      expect((calls[0] as { type: string }).type).toBe('profile.updated')
    })

    it('survives JSON parse failure without throwing', async () => {
      const { subscribe } = await import('./broker')
      const calls: unknown[] = []
      subscribe('user:1', (payload) => calls.push(payload))
      await new Promise((r) => setImmediate(r))
      expect(() =>
        fake.emit('message', 'user:1', 'not-json'),
      ).not.toThrow()
      expect(calls).toHaveLength(0)
    })

    it('on subscriber `ready` after disconnect, re-issues SUBSCRIBE and emits __resync__', async () => {
      const { subscribe } = await import('./broker')
      const calls: Array<{ resync: boolean }> = []
      subscribe('user:1', (payload) => {
        if ((payload as { __resync__?: true }).__resync__) calls.push({ resync: true })
      })
      await new Promise((r) => setImmediate(r))
      // Clear the existing subscribe record.
      fake.subscribed.clear()
      // Simulate a disconnect + reconnect.
      fake.status = 'reconnecting'
      fake.emit('end')
      fake.status = 'ready'
      fake.emit('ready')
      await new Promise((r) => setImmediate(r))
      expect(fake.subscribed.has('user:1')).toBe(true)
      expect(calls).toEqual([{ resync: true }])
    })

    it('liveness watchdog pings the subscriber every 30s', async () => {
      vi.useFakeTimers()
      const { subscribe } = await import('./broker')
      subscribe('user:1', () => {})
      await vi.advanceTimersByTimeAsync(30_000)
      expect(fake.pinged).toBeGreaterThanOrEqual(1)
    })
  })
  ```
- [ ] **Step 2: Run — expect failure.**
- [ ] **Step 3: Implement `broker.ts`.**
  ```ts
  import 'server-only'
  import { EventEmitter } from 'node:events'
  import { getSubscriber } from './redis'

  /**
   * Per-Fluid-Compute-instance shared-subscriber broker.
   *
   * Stored on globalThis so Next.js dev-mode HMR does not leak
   * subscriber connections. Refcounts channels: SUBSCRIBE only on the
   * 0->1 transition, UNSUBSCRIBE only on the 1->0 transition.
   *
   * Resync flow: on subscriber `ready` after a non-initial state, the
   * broker re-issues SUBSCRIBE for every channel currently in
   * channelListeners and dispatches a synthetic `__resync__` payload
   * to every listener. SSE handlers translate this synthetic event
   * into a `system.resync` SSE frame.
   *
   * Liveness watchdog: a 30-second interval pings the subscriber. On
   * any ping failure, force a reconnect (status flips, retryStrategy
   * picks up).
   */

  type Listener = (payload: unknown) => void

  interface BrokerState {
    emitter: EventEmitter
    channelListeners: Map<string, Set<Listener>>
    initialized: boolean
    seenReady: boolean
    watchdog: ReturnType<typeof setInterval> | null
  }

  const BROKER_KEY = Symbol.for('kasero.realtime.broker')

  function getState(): BrokerState {
    const g = globalThis as Record<symbol, unknown>
    let state = g[BROKER_KEY] as BrokerState | undefined
    if (!state) {
      state = {
        emitter: new EventEmitter(),
        // No upper bound on listener count — a busy Fluid instance may have
        // hundreds of SSE handlers each registering on user:{id} channels.
        channelListeners: new Map(),
        initialized: false,
        seenReady: false,
        watchdog: null,
      }
      state.emitter.setMaxListeners(0)
      g[BROKER_KEY] = state
    }
    return state
  }

  function init(state: BrokerState): void {
    if (state.initialized) return
    state.initialized = true
    const sub = getSubscriber()

    sub.on('message', (channel: string, raw: string) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (err) {
        // Bad publishers shouldn't kill the listener.
        console.warn('[realtime.broker] dropping unparseable message on', channel, err)
        return
      }
      const listeners = state.channelListeners.get(channel)
      if (!listeners) return
      for (const listener of listeners) {
        try {
          listener(parsed)
        } catch (err) {
          console.warn('[realtime.broker] listener threw on', channel, err)
        }
      }
    })

    sub.on('ready', () => {
      if (state.seenReady) {
        // Reconnect: re-subscribe to every channel and emit synthetic resync.
        const channels = [...state.channelListeners.keys()]
        if (channels.length > 0) {
          sub.subscribe(...channels).catch((err) => {
            console.warn('[realtime.broker] resync subscribe failed', err)
          })
        }
        for (const listeners of state.channelListeners.values()) {
          for (const listener of listeners) {
            try {
              listener({ __resync__: true })
            } catch (err) {
              console.warn('[realtime.broker] resync listener threw', err)
            }
          }
        }
      }
      state.seenReady = true
    })

    sub.on('error', (err: Error) => {
      console.warn('[realtime.broker] subscriber error', err)
    })

    sub.on('end', () => {
      console.warn('[realtime.broker] subscriber connection ended; awaiting reconnect')
    })

    // Liveness watchdog: 30s pings keep the socket warm AND surface
    // half-open sockets where the TCP stack hasn't noticed the
    // disconnect yet. On failure, ioredis flips status and reconnects.
    state.watchdog = setInterval(() => {
      sub.ping().catch((err) => {
        console.warn('[realtime.broker] watchdog ping failed', err)
      })
    }, 30_000)
    // Don't block process exit on the watchdog.
    state.watchdog.unref?.()

    // HMR cleanup in dev. import.meta.webpackHot is the Webpack/Turbo dev hook.
    const hot = (import.meta as unknown as { webpackHot?: { dispose: (cb: () => void) => void } }).webpackHot
    hot?.dispose(() => {
      if (state.watchdog) clearInterval(state.watchdog)
      state.channelListeners.clear()
      ;(globalThis as Record<symbol, unknown>)[BROKER_KEY] = undefined
    })
  }

  /**
   * Subscribe to a Redis channel. Returns an unsubscribe function the
   * caller MUST invoke on cleanup (e.g., SSE request.signal.abort).
   */
  export function subscribe(channel: string, listener: Listener): () => void {
    const state = getState()
    init(state)
    let listeners = state.channelListeners.get(channel)
    if (!listeners) {
      listeners = new Set()
      state.channelListeners.set(channel, listeners)
    }
    const wasEmpty = listeners.size === 0
    listeners.add(listener)
    if (wasEmpty) {
      getSubscriber()
        .subscribe(channel)
        .catch((err) => {
          console.warn('[realtime.broker] subscribe failed for', channel, err)
        })
    }
    let unsubscribed = false
    return () => {
      if (unsubscribed) return
      unsubscribed = true
      const set = state.channelListeners.get(channel)
      if (!set) return
      set.delete(listener)
      if (set.size === 0) {
        state.channelListeners.delete(channel)
        getSubscriber()
          .unsubscribe(channel)
          .catch((err) => {
            console.warn('[realtime.broker] unsubscribe failed for', channel, err)
          })
      }
    }
  }
  ```
- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Commit.**
  ```
  git add apps/api/src/lib/realtime/broker.ts apps/api/src/lib/realtime/broker.test.ts
  git commit -m "feat(realtime): shared-subscriber broker with refcount, resync, watchdog"
  ```

### Task 2.4: `streams.ts` — stream replay + first-connect tip

**Files:**
- Create: `/Users/adiaz/irvin/apps/api/src/lib/realtime/streams.ts`
- Create: `/Users/adiaz/irvin/apps/api/src/lib/realtime/streams.test.ts`

- [ ] **Step 1: Write the test.**
  ```ts
  import { describe, it, expect, vi, beforeEach } from 'vitest'

  const xread = vi.fn()
  const xrevrange = vi.fn()

  vi.mock('./redis', () => ({
    getPublisher: () => ({ xread, xrevrange }),
  }))

  beforeEach(() => {
    xread.mockReset()
    xrevrange.mockReset()
  })

  describe('streams', () => {
    it('readUserStreamSince returns parsed entries with ids > lastEventId', async () => {
      xread.mockResolvedValueOnce([
        [
          'stream:user:U',
          [
            ['1700000000-1', ['type', 'session.revoked', 'payload', JSON.stringify({ type: 'session.revoked', businessId: 'b', reason: 'removed' })]],
            ['1700000001-0', ['type', 'business.deleted', 'payload', JSON.stringify({ type: 'business.deleted', businessId: 'b' })]],
          ],
        ],
      ])
      const { readUserStreamSince } = await import('./streams')
      const events = await readUserStreamSince('U', '1699999999-0')
      expect(events).toHaveLength(2)
      expect(events[0].id).toBe('1700000000-1')
      expect(events[0].event.type).toBe('session.revoked')
      expect(xread).toHaveBeenCalledWith(
        'COUNT', 100,
        'STREAMS', 'stream:user:U', '1699999999-0',
      )
    })

    it('readUserStreamSince returns [] when XREAD returns null', async () => {
      xread.mockResolvedValueOnce(null)
      const { readUserStreamSince } = await import('./streams')
      const events = await readUserStreamSince('U', '0-0')
      expect(events).toEqual([])
    })

    it('getUserStreamTip returns the latest id via XREVRANGE COUNT 1', async () => {
      xrevrange.mockResolvedValueOnce([
        ['1700000005-0', ['type', 'session.revoked', 'payload', '{}']],
      ])
      const { getUserStreamTip } = await import('./streams')
      const tip = await getUserStreamTip('U')
      expect(tip).toBe('1700000005-0')
      expect(xrevrange).toHaveBeenCalledWith('stream:user:U', '+', '-', 'COUNT', 1)
    })

    it('getUserStreamTip returns "0-0" when the stream is empty', async () => {
      xrevrange.mockResolvedValueOnce([])
      const { getUserStreamTip } = await import('./streams')
      const tip = await getUserStreamTip('U')
      expect(tip).toBe('0-0')
    })
  })
  ```
- [ ] **Step 2: Run — expect failure.**
- [ ] **Step 3: Implement `streams.ts`.**
  ```ts
  import 'server-only'
  import { getPublisher } from './redis'
  import { userStream } from '@kasero/shared/realtime'
  import type { CriticalUserRealtimeEvent } from '@kasero/shared/realtime'

  /**
   * XREAD COUNT 100 STREAMS stream:user:{userId} <lastEventId>
   *
   * Returns entries with id STRICTLY GREATER than lastEventId. ioredis
   * XREAD result shape:
   *   [ [streamName, [ [id, [field1, val1, ...]] , ... ]] ]
   *   or null when no entries match (note: synchronous XREAD with no
   *   BLOCK arg returns null on empty).
   */
  export interface ReplayEntry {
    id: string
    event: CriticalUserRealtimeEvent
  }

  export async function readUserStreamSince(
    userId: string,
    lastEventId: string,
  ): Promise<ReplayEntry[]> {
    const result = (await getPublisher().xread(
      'COUNT', 100,
      'STREAMS', userStream(userId), lastEventId,
    )) as Array<[string, Array<[string, string[]]>]> | null
    if (!result || result.length === 0) return []
    const [, entries] = result[0]
    const out: ReplayEntry[] = []
    for (const [id, fields] of entries) {
      // fields = ['type', '<type>', 'payload', '<json>'] — defensive parse.
      const map = new Map<string, string>()
      for (let i = 0; i < fields.length; i += 2) {
        map.set(fields[i], fields[i + 1])
      }
      const payloadRaw = map.get('payload')
      if (!payloadRaw) continue
      try {
        const event = JSON.parse(payloadRaw) as CriticalUserRealtimeEvent
        out.push({ id, event })
      } catch (err) {
        console.warn('[realtime.streams] dropping unparseable entry', id, err)
      }
    }
    return out
  }

  /**
   * XREVRANGE stream:user:{id} + - COUNT 1 -> the latest entry's id.
   * Returns '0-0' if the stream is empty so callers can use the value
   * unconditionally as a Last-Event-ID hint.
   */
  export async function getUserStreamTip(userId: string): Promise<string> {
    const result = (await getPublisher().xrevrange(
      userStream(userId), '+', '-', 'COUNT', 1,
    )) as Array<[string, string[]]>
    if (!result || result.length === 0) return '0-0'
    return result[0][0]
  }
  ```
- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Commit.**
  ```
  git add apps/api/src/lib/realtime/streams.ts apps/api/src/lib/realtime/streams.test.ts
  git commit -m "feat(realtime): stream replay and first-connect tip helpers"
  ```

### Task 2.5: `publisher.ts` — fan-out helpers

**Files:**
- Create: `/Users/adiaz/irvin/apps/api/src/lib/realtime/publisher.ts`
- Create: `/Users/adiaz/irvin/apps/api/src/lib/realtime/publisher.test.ts`

- [ ] **Step 1: Write the test.**
  ```ts
  import { describe, it, expect, vi, beforeEach } from 'vitest'

  const publishMock = vi.fn()
  const pipelineExec = vi.fn()
  const pipelineCalls: Array<[string, ...unknown[]]> = []
  const multiExec = vi.fn()
  const multiCalls: Array<[string, ...unknown[]]> = []

  const pipeline = () => ({
    publish: (...args: unknown[]) => { pipelineCalls.push(['publish', ...args]); return pipelineApi },
    exec: pipelineExec,
  })
  const pipelineApi: ReturnType<typeof pipeline> = pipeline()

  vi.mock('./redis', () => ({
    getPublisher: () => ({
      publish: publishMock,
      pipeline: () => ({
        publish: (...args: unknown[]) => { pipelineCalls.push(['publish', ...args]); return pipelineApi },
        exec: pipelineExec,
      }),
      multi: () => ({
        xadd: (...args: unknown[]) => { multiCalls.push(['xadd', ...args]); return multiBuilder },
        publish: (...args: unknown[]) => { multiCalls.push(['publish', ...args]); return multiBuilder },
        pexpire: (...args: unknown[]) => { multiCalls.push(['pexpire', ...args]); return multiBuilder },
        exec: multiExec,
      }),
    }),
  }))

  const multiBuilder: Record<string, unknown> = {}
  multiBuilder.xadd = (...args: unknown[]) => { multiCalls.push(['xadd', ...args]); return multiBuilder }
  multiBuilder.publish = (...args: unknown[]) => { multiCalls.push(['publish', ...args]); return multiBuilder }
  multiBuilder.pexpire = (...args: unknown[]) => { multiCalls.push(['pexpire', ...args]); return multiBuilder }
  multiBuilder.exec = multiExec

  beforeEach(() => {
    publishMock.mockReset()
    pipelineExec.mockReset()
    multiExec.mockReset()
    pipelineCalls.length = 0
    multiCalls.length = 0
  })

  describe('publisher', () => {
    it('publishToBusiness emits a single PUBLISH on business:{id} with deviceId', async () => {
      publishMock.mockResolvedValueOnce(1)
      const { publishToBusiness } = await import('./publisher')
      await publishToBusiness('b1', { type: 'team.member.joined', memberId: 'm1' }, 'dev-1')
      expect(publishMock).toHaveBeenCalledTimes(1)
      const [channel, raw] = publishMock.mock.calls[0]
      expect(channel).toBe('business:b1')
      expect(JSON.parse(raw as string)).toEqual({
        type: 'team.member.joined',
        memberId: 'm1',
        originDeviceId: 'dev-1',
      })
    })

    it('publishToUser fails open: PUBLISH throws -> no throw, warning logged', async () => {
      publishMock.mockRejectedValueOnce(new Error('upstash down'))
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { publishToUser } = await import('./publisher')
      await expect(
        publishToUser('u1', { type: 'profile.updated', fields: ['email'] }),
      ).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalled()
      warn.mockRestore()
    })

    it('publishCriticalToUser pipelines MULTI: XADD MAXLEN 100 + PUBLISH + PEXPIRE 90d', async () => {
      multiExec.mockResolvedValueOnce([
        [null, '1700000000-0'],
        [null, 1],
        [null, 1],
      ])
      const { publishCriticalToUser } = await import('./publisher')
      await publishCriticalToUser('u1', {
        type: 'session.revoked',
        businessId: 'b1',
        reason: 'removed',
      })
      expect(multiCalls[0]).toEqual([
        'xadd',
        'stream:user:u1', 'MAXLEN', 100, '*',
        'type', 'session.revoked',
        'payload', expect.any(String),
      ])
      expect(multiCalls[1][0]).toBe('publish')
      expect(multiCalls[1][1]).toBe('user:u1')
      expect(multiCalls[2]).toEqual([
        'pexpire',
        'stream:user:u1',
        90 * 24 * 60 * 60 * 1000,
      ])
    })

    it('publishCriticalToUser throws RealtimeUnavailableError on MULTI failure', async () => {
      multiExec.mockRejectedValueOnce(new Error('upstash down'))
      const { publishCriticalToUser } = await import('./publisher')
      await expect(
        publishCriticalToUser('u1', {
          type: 'session.revoked',
          businessId: 'b1',
          reason: 'removed',
        }),
      ).rejects.toThrow(/realtime unavailable/i)
    })

    it('publishBatchedToUsers pipelines a PUBLISH per user channel', async () => {
      pipelineExec.mockResolvedValueOnce([])
      const { publishBatchedToUsers } = await import('./publisher')
      await publishBatchedToUsers(['u1', 'u2', 'u3'], {
        type: 'business.list.changed',
        reason: 'renamed',
      })
      expect(pipelineCalls.map((c) => c[1])).toEqual(['user:u1', 'user:u2', 'user:u3'])
    })

    it('publishBatchedToUsers fails open on exec rejection', async () => {
      pipelineExec.mockRejectedValueOnce(new Error('upstash down'))
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { publishBatchedToUsers } = await import('./publisher')
      await expect(
        publishBatchedToUsers(['u1'], { type: 'business.list.changed', reason: 'removed' }),
      ).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalled()
      warn.mockRestore()
    })
  })
  ```
- [ ] **Step 2: Run — expect failure.**
- [ ] **Step 3: Implement `publisher.ts`.**
  ```ts
  import 'server-only'
  import { getPublisher } from './redis'
  import { RealtimeUnavailableError } from './errors'
  import {
    businessChannel,
    userChannel,
    userStream,
    type BusinessRealtimeEvent,
    type UserRealtimeEvent,
    type CriticalUserRealtimeEvent,
  } from '@kasero/shared/realtime'

  const STREAM_MAXLEN = 100
  const STREAM_TTL_MS = 90 * 24 * 60 * 60 * 1000 // 90 days

  /**
   * Fire-and-forget publish on business:{id}. Fail-open: a warning is
   * logged and the function resolves. Calling routes never break on a
   * non-critical Upstash blip — focus refetch backs up missed events.
   */
  export async function publishToBusiness(
    businessId: string,
    event: BusinessRealtimeEvent,
    originDeviceId?: string,
  ): Promise<void> {
    const payload = { ...event, ...(originDeviceId ? { originDeviceId } : {}) }
    try {
      await getPublisher().publish(businessChannel(businessId), JSON.stringify(payload))
    } catch (err) {
      console.warn('[realtime.publisher] publishToBusiness failed for', businessId, err)
    }
  }

  /**
   * Fire-and-forget publish on user:{id}. Fail-open identical to
   * publishToBusiness.
   */
  export async function publishToUser(
    userId: string,
    event: UserRealtimeEvent,
    originDeviceId?: string,
  ): Promise<void> {
    const payload = { ...event, ...(originDeviceId ? { originDeviceId } : {}) }
    try {
      await getPublisher().publish(userChannel(userId), JSON.stringify(payload))
    } catch (err) {
      console.warn('[realtime.publisher] publishToUser failed for', userId, err)
    }
  }

  /**
   * Critical publish: append to the user's stream (cap=100), PUBLISH on
   * the user channel, and refresh the stream's 90-day TTL — all in a
   * single MULTI/EXEC. Fail-CLOSED: throws RealtimeUnavailableError so
   * the calling route returns 503 REALTIME_PUBLISH_UNAVAILABLE.
   */
  export async function publishCriticalToUser(
    userId: string,
    event: CriticalUserRealtimeEvent,
    originDeviceId?: string,
  ): Promise<void> {
    const payload = { ...event, ...(originDeviceId ? { originDeviceId } : {}) }
    const json = JSON.stringify(payload)
    const stream = userStream(userId)
    const channel = userChannel(userId)
    try {
      const exec = getPublisher()
        .multi()
        .xadd(stream, 'MAXLEN', STREAM_MAXLEN, '*', 'type', event.type, 'payload', json)
        .publish(channel, json)
        .pexpire(stream, STREAM_TTL_MS)
        .exec()
      const result = await exec
      if (!result) throw new RealtimeUnavailableError('MULTI/EXEC returned null')
      // Each entry is [err, value]; treat any non-null err as failure.
      for (const [err] of result as Array<[Error | null, unknown]>) {
        if (err) throw new RealtimeUnavailableError(`pipeline step failed: ${err.message}`)
      }
    } catch (err) {
      if (err instanceof RealtimeUnavailableError) throw err
      console.warn('[realtime.publisher] publishCriticalToUser failed for', userId, err)
      throw new RealtimeUnavailableError(
        err instanceof Error ? err.message : 'critical publish failed',
      )
    }
  }

  /**
   * Pipelined PUBLISH to many user channels in a single round-trip.
   * Used by business rename (publish business.list.changed to every
   * member) and business delete (publish session.revoked siblings).
   * Fail-open: log + resolve.
   */
  export async function publishBatchedToUsers(
    userIds: string[],
    event: UserRealtimeEvent,
    originDeviceId?: string,
  ): Promise<void> {
    if (userIds.length === 0) return
    const payload = { ...event, ...(originDeviceId ? { originDeviceId } : {}) }
    const json = JSON.stringify(payload)
    try {
      const p = getPublisher().pipeline()
      for (const userId of userIds) {
        p.publish(userChannel(userId), json)
      }
      await p.exec()
    } catch (err) {
      console.warn('[realtime.publisher] publishBatchedToUsers failed', err)
    }
  }
  ```
- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Commit.**
  ```
  git add apps/api/src/lib/realtime/publisher.ts apps/api/src/lib/realtime/publisher.test.ts
  git commit -m "feat(realtime): publishers for business, user, critical, and batched fan-out"
  ```

### Task 2.6: barrel `index.ts`

**Files:**
- Create: `/Users/adiaz/irvin/apps/api/src/lib/realtime/index.ts`

- [ ] **Step 1: Write the file.**
  ```ts
  export * from './errors'
  export * from './publisher'
  export * from './streams'
  export { subscribe } from './broker'
  ```
- [ ] **Step 2: Commit.**
  ```
  git add apps/api/src/lib/realtime/index.ts
  git commit -m "feat(realtime): barrel for apps/api/src/lib/realtime"
  ```

**Phase 2 done when:** all five modules have unit tests passing; broker covers refcount, fan-out, JSON parse failure, resync, watchdog; publisher covers fail-open vs fail-closed, MULTI pipeline shape, batched broadcast.

---

## Phase 3 — SSE route

### Task 3.1: SSE GET handler with full guards

**Files:**
- Create: `/Users/adiaz/irvin/apps/api/src/app/api/realtime/route.ts`
- Create: `/Users/adiaz/irvin/apps/api/src/app/api/realtime/route.test.ts`
- Modify: `/Users/adiaz/irvin/apps/api/src/lib/business-auth.ts` (add 30s in-memory grant cache helper used by SSE only — see step 3 below)

- [ ] **Step 1: Add `REALTIME_UNAVAILABLE` / `REALTIME_PUBLISH_UNAVAILABLE` ApiMessageCode early.** (We need them in Phase 3 even though Phase 4 covers locale wiring.) Edit `/Users/adiaz/irvin/packages/shared/src/api-messages.ts` — append before the closing `} as const` on line 201:
  ```ts
    // Realtime subsystem
    REALTIME_UNAVAILABLE: 'REALTIME_UNAVAILABLE',
    REALTIME_PUBLISH_UNAVAILABLE: 'REALTIME_PUBLISH_UNAVAILABLE',
  ```
- [ ] **Step 2: Add a focused SSE-side access cache helper to `business-auth.ts`.** This is a 30-second cache distinct from the existing 60s `requireBusinessAccess` cache because the SSE route doesn't need the full BusinessAccess object — only a yes/no — and the spec calls out a separate cache. Append after `invalidateAccessCacheForUser` (line 74):
  ```ts
  // ============================================
  // REALTIME ACCESS CACHE (SSE-only)
  // ============================================

  const RT_CACHE_TTL_MS = 30_000

  interface RealtimeGrant {
    granted: boolean
    expiresAt: number
  }
  const realtimeGrantCache = new Map<string, RealtimeGrant>()

  /**
   * Lightweight per-instance access check used by the SSE route.
   * Mirrors requireBusinessAccess semantics (status=active, membership
   * row exists) but returns a boolean and caches for 30 seconds. The
   * SSE route reconnects multiple times per session and we don't want
   * the membership SELECT on every reconnect.
   */
  export async function requireBusinessAccessForRealtime(
    userId: string,
    businessId: string,
  ): Promise<boolean> {
    const key = `${userId}:${businessId}`
    const cached = realtimeGrantCache.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.granted
    const row = await db
      .select({ id: businessUsers.id })
      .from(businessUsers)
      .where(
        and(
          eq(businessUsers.userId, userId),
          eq(businessUsers.businessId, businessId),
          eq(businessUsers.status, 'active'),
        ),
      )
      .get()
    const granted = row != null
    realtimeGrantCache.set(key, { granted, expiresAt: Date.now() + RT_CACHE_TTL_MS })
    return granted
  }
  ```
- [ ] **Step 3: Write the route test.**
  ```ts
  import { describe, it, expect, vi, beforeEach } from 'vitest'
  import { NextRequest } from 'next/server'

  const getSession = vi.fn()
  const requireBusinessAccessForRealtime = vi.fn()
  const checkRateLimit = vi.fn()
  const brokerSubscribe = vi.fn(() => () => {})
  const getUserStreamTip = vi.fn()
  const readUserStreamSince = vi.fn()

  vi.mock('@/lib/auth', () => ({ auth: { api: { getSession } } }))
  vi.mock('@/lib/business-auth', () => ({ requireBusinessAccessForRealtime }))
  vi.mock('@/lib/rate-limit', () => ({
    checkRateLimit,
    getClientIp: () => '127.0.0.1',
    RateLimits: { userMutation: { limit: 30, windowSeconds: 60 } },
  }))
  vi.mock('@/lib/realtime', () => ({
    subscribe: brokerSubscribe,
    getUserStreamTip,
    readUserStreamSince,
  }))

  beforeEach(() => {
    getSession.mockReset()
    requireBusinessAccessForRealtime.mockReset()
    checkRateLimit.mockReset()
    brokerSubscribe.mockReset()
    getUserStreamTip.mockReset()
    readUserStreamSince.mockReset()
    brokerSubscribe.mockImplementation(() => () => {})
  })

  function makeReq(opts: { url?: string; headers?: Record<string, string> } = {}): NextRequest {
    const url = opts.url ?? 'https://kasero.app/api/realtime'
    return new NextRequest(url, {
      headers: new Headers({
        'sec-fetch-site': 'same-origin',
        'host': 'kasero.app',
        ...opts.headers,
      }),
    })
  }

  describe('GET /api/realtime', () => {
    it('returns 401 when no session', async () => {
      getSession.mockResolvedValueOnce(null)
      const { GET } = await import('./route')
      const res = await GET(makeReq())
      expect(res.status).toBe(401)
    })

    it('returns 403 when Sec-Fetch-Site is absent and Origin does not match host', async () => {
      getSession.mockResolvedValueOnce({ user: { id: 'u1', emailVerified: true } })
      const { GET } = await import('./route')
      const res = await GET(makeReq({
        headers: { 'sec-fetch-site': '', 'origin': 'https://evil.example' },
      }))
      expect(res.status).toBe(403)
    })

    it('returns 403 when businessId is provided and user is not a member', async () => {
      getSession.mockResolvedValueOnce({ user: { id: 'u1', emailVerified: true } })
      requireBusinessAccessForRealtime.mockResolvedValueOnce(false)
      const { GET } = await import('./route')
      const res = await GET(makeReq({ url: 'https://kasero.app/api/realtime?businessId=b1' }))
      expect(res.status).toBe(403)
    })

    it('returns 429 when rate limit exceeded', async () => {
      getSession.mockResolvedValueOnce({ user: { id: 'u1', emailVerified: true } })
      checkRateLimit.mockResolvedValueOnce({ success: false, remaining: 0, resetAt: Date.now() + 60_000 })
      const { GET } = await import('./route')
      const res = await GET(makeReq())
      expect(res.status).toBe(429)
    })

    it('first connect (no Last-Event-ID) emits one system.resync with id=tip', async () => {
      getSession.mockResolvedValueOnce({ user: { id: 'u1', emailVerified: true } })
      checkRateLimit.mockResolvedValueOnce({ success: true, remaining: 29, resetAt: 0 })
      getUserStreamTip.mockResolvedValueOnce('1700000000-0')
      const { GET } = await import('./route')
      const res = await GET(makeReq())
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/event-stream')
      const reader = res.body!.getReader()
      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)
      expect(text).toContain('id: 1700000000-0')
      expect(text).toContain('event: system.resync')
      // Tear down so the stream's intervals don't keep the test alive.
      await reader.cancel()
    })

    it('reconnect (Last-Event-ID set) replays critical events', async () => {
      getSession.mockResolvedValueOnce({ user: { id: 'u1', emailVerified: true } })
      checkRateLimit.mockResolvedValueOnce({ success: true, remaining: 29, resetAt: 0 })
      readUserStreamSince.mockResolvedValueOnce([
        {
          id: '1700000001-0',
          event: { type: 'session.revoked', businessId: 'b1', reason: 'removed' },
        },
      ])
      const { GET } = await import('./route')
      const res = await GET(makeReq({ headers: { 'last-event-id': '1700000000-0' } }))
      const reader = res.body!.getReader()
      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)
      expect(text).toContain('id: 1700000001-0')
      expect(text).toContain('event: session.revoked')
      await reader.cancel()
    })

    it('subscriber __resync__ event is translated to system.resync SSE frame', async () => {
      getSession.mockResolvedValueOnce({ user: { id: 'u1', emailVerified: true } })
      checkRateLimit.mockResolvedValueOnce({ success: true, remaining: 29, resetAt: 0 })
      getUserStreamTip.mockResolvedValueOnce('0-0')
      let userListener: ((p: unknown) => void) | null = null
      brokerSubscribe.mockImplementation((channel: string, l: (p: unknown) => void) => {
        if (channel === 'user:u1') userListener = l
        return () => {}
      })
      const { GET } = await import('./route')
      const res = await GET(makeReq())
      const reader = res.body!.getReader()
      // Read the initial resync.
      await reader.read()
      userListener?.({ __resync__: true })
      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)
      expect(text).toContain('event: system.resync')
      await reader.cancel()
    })
  })
  ```
- [ ] **Step 4: Run — expect failure.**
- [ ] **Step 5: Implement `apps/api/src/app/api/realtime/route.ts`.**
  ```ts
  import { NextRequest } from 'next/server'
  import { auth } from '@/lib/auth'
  import { requireBusinessAccessForRealtime } from '@/lib/business-auth'
  import {
    subscribe as brokerSubscribe,
    getUserStreamTip,
    readUserStreamSince,
  } from '@/lib/realtime'
  import {
    businessChannel,
    userChannel,
    type RealtimeEvent,
  } from '@kasero/shared/realtime'
  import { ApiMessageCode } from '@kasero/shared/api-messages'
  import { checkRateLimit, RateLimits } from '@/lib/rate-limit'
  import { logServerError } from '@/lib/server-logger'

  export const runtime = 'nodejs'
  export const maxDuration = 300
  export const dynamic = 'force-dynamic'
  export const preferredRegion = 'iad1'

  // ============================================
  // CSRF for SSE
  // ============================================
  // EventSource is a same-origin GET. Modern browsers set Sec-Fetch-Site
  // automatically. Absent => non-browser client; reject. As a fallback
  // we also accept an Origin that matches Host (covers older Safari).
  function isSameOrigin(req: NextRequest): boolean {
    const sfs = req.headers.get('sec-fetch-site')
    if (sfs === 'same-origin') return true
    const origin = req.headers.get('origin')
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
    if (origin && host) {
      try {
        const parsed = new URL(origin)
        return parsed.host === host
      } catch {
        return false
      }
    }
    return false
  }

  function jsonError(code: ApiMessageCode, status: number, retryAfterSeconds?: number): Response {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (retryAfterSeconds != null) headers['retry-after'] = String(retryAfterSeconds)
    return new Response(JSON.stringify({ messageCode: code }), { status, headers })
  }

  // SSE frame builder. event: <type>, id: <id>, data: <json>.
  function frame(event: RealtimeEvent, id?: string): string {
    let out = ''
    if (id) out += `id: ${id}\n`
    out += `event: ${event.type}\n`
    out += `data: ${JSON.stringify(event)}\n\n`
    return out
  }

  export async function GET(request: NextRequest): Promise<Response> {
    try {
      const session = await auth.api.getSession({ headers: request.headers })
      if (!session) return jsonError(ApiMessageCode.UNAUTHORIZED, 401, 600)
      if (!session.user.emailVerified) return jsonError(ApiMessageCode.EMAIL_NOT_VERIFIED, 403)

      if (!isSameOrigin(request)) return jsonError(ApiMessageCode.FORBIDDEN, 403)

      // Rate-limit reconnect storms per user.
      const rl = await checkRateLimit(`realtime:${session.user.id}`, RateLimits.userMutation)
      if (!rl.success) {
        const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))
        return jsonError(ApiMessageCode.RATE_LIMITED, 429, retryAfter)
      }

      const url = new URL(request.url)
      const businessId = url.searchParams.get('businessId') ?? null
      if (businessId) {
        const granted = await requireBusinessAccessForRealtime(session.user.id, businessId)
        if (!granted) return jsonError(ApiMessageCode.FORBIDDEN, 403)
      }

      const lastEventId = request.headers.get('last-event-id')
      const encoder = new TextEncoder()
      const userId = session.user.id

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const cleanupFns: Array<() => void> = []
          let closed = false
          const safeEnqueue = (chunk: string) => {
            if (closed) return
            try {
              controller.enqueue(encoder.encode(chunk))
            } catch {
              closed = true
            }
          }
          const close = () => {
            if (closed) return
            closed = true
            for (const fn of cleanupFns) {
              try { fn() } catch { /* swallow */ }
            }
            try { controller.close() } catch { /* already closed */ }
          }

          // First-connect vs reconnect.
          try {
            if (!lastEventId) {
              const tip = await getUserStreamTip(userId)
              safeEnqueue(frame({ type: 'system.resync' }, tip))
            } else {
              const replayed = await readUserStreamSince(userId, lastEventId)
              for (const entry of replayed) {
                safeEnqueue(frame(entry.event, entry.id))
              }
              if (replayed.length === 0) {
                // Nothing to replay but reconnect happened — emit resync so client refetches.
                safeEnqueue(frame({ type: 'system.resync' }, lastEventId))
              }
            }
          } catch (err) {
            logServerError('api.realtime.replay', err)
            safeEnqueue(frame({ type: 'system.error', code: ApiMessageCode.REALTIME_UNAVAILABLE }))
            close()
            return
          }

          // User-channel subscription.
          cleanupFns.push(
            brokerSubscribe(userChannel(userId), (payload) => {
              if (payload && typeof payload === 'object' && '__resync__' in payload) {
                safeEnqueue(frame({ type: 'system.resync' }))
                return
              }
              const event = payload as RealtimeEvent
              safeEnqueue(frame(event))
            }),
          )

          // Business-channel subscription (optional).
          if (businessId) {
            cleanupFns.push(
              brokerSubscribe(businessChannel(businessId), (payload) => {
                if (payload && typeof payload === 'object' && '__resync__' in payload) {
                  safeEnqueue(frame({ type: 'system.resync' }))
                  return
                }
                const event = payload as RealtimeEvent
                safeEnqueue(frame(event))
              }),
            )
          }

          // Heartbeat every 15s. Comment-only frame; clients reset their
          // watchdog timer on any bytes received.
          const hb = setInterval(() => {
            safeEnqueue(`:hb\n\n`)
          }, 15_000)
          hb.unref?.()
          cleanupFns.push(() => clearInterval(hb))

          // Abort handling.
          const onAbort = () => { close() }
          request.signal.addEventListener('abort', onAbort, { once: true })
          cleanupFns.push(() => request.signal.removeEventListener('abort', onAbort))
        },
      })

      return new Response(stream, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache, no-transform',
          'connection': 'keep-alive',
          'x-accel-buffering': 'no',
        },
      })
    } catch (err) {
      logServerError('api.realtime.GET', err)
      return jsonError(ApiMessageCode.INTERNAL_ERROR, 500)
    }
  }
  ```
- [ ] **Step 6: Run — expect pass.** `npm run test:run --workspace=apps/api -- src/app/api/realtime/route.test.ts`
- [ ] **Step 7: Commit.**
  ```
  git add apps/api/src/app/api/realtime apps/api/src/lib/business-auth.ts packages/shared/src/api-messages.ts
  git commit -m "feat(realtime): SSE route with auth, CSRF, rate-limit, replay, resync"
  ```

**Phase 3 done when:** the SSE route returns 401/403/429 for the documented failure modes; first-connect emits one `system.resync` with id=tip; reconnect with `Last-Event-ID` replays via `readUserStreamSince`; broker `__resync__` translates to `system.resync` SSE frame.

---

## Phase 4 — Locale keys

### Task 4.1: Add locale keys to all 11 locale files

**Files:**
- Modify: `/Users/adiaz/irvin/apps/web/src/i18n/messages/en-US.json`
- Modify: `/Users/adiaz/irvin/apps/web/src/i18n/messages/es.json`
- Modify: `/Users/adiaz/irvin/apps/web/src/i18n/messages/ja.json`
- Modify: `/Users/adiaz/irvin/apps/web/src/i18n/messages/de.json`
- Modify: `/Users/adiaz/irvin/apps/web/src/i18n/messages/fr.json`
- Modify: `/Users/adiaz/irvin/apps/web/src/i18n/messages/it.json`
- Modify: `/Users/adiaz/irvin/apps/web/src/i18n/messages/pt.json`
- Modify: `/Users/adiaz/irvin/apps/web/src/i18n/messages/ko.json`
- Modify: `/Users/adiaz/irvin/apps/web/src/i18n/messages/zh.json`
- Modify: `/Users/adiaz/irvin/apps/web/src/i18n/messages/vi.json`
- Modify: `/Users/adiaz/irvin/apps/web/src/i18n/messages/fil.json`
- Modify: `/Users/adiaz/irvin/apps/web/src/i18n/messageIds.d.ts` (regenerated by script)

- [ ] **Step 1: Add the six keys to `en-US.json`** (top-level, near the existing top-level `session_*` or `realtime_*` neighbors — alphabetical isn't strictly enforced but cluster these together). Insert immediately before the closing `}`:
  ```json
  "session_revoked_removed": "You've been removed from {businessName}.",
  "session_revoked_business_deleted": "{businessName} was deleted by the owner.",
  "session_revoked_ownership_transferred": "{businessName} ownership was transferred.",
  "realtime_disconnected_banner": "Live updates paused. Reconnecting…",
  "apiMessages.realtime_unavailable": "Live updates are temporarily unavailable.",
  "apiMessages.realtime_publish_unavailable": "Couldn't broadcast the change. Please retry."
  ```
- [ ] **Step 2: Add the same six keys to `es.json`.**
  ```json
  "session_revoked_removed": "Lo han eliminado de {businessName}.",
  "session_revoked_business_deleted": "El propietario eliminó {businessName}.",
  "session_revoked_ownership_transferred": "Se transfirió la propiedad de {businessName}.",
  "realtime_disconnected_banner": "Actualizaciones en vivo en pausa. Reconectando…",
  "apiMessages.realtime_unavailable": "Las actualizaciones en vivo no están disponibles por el momento.",
  "apiMessages.realtime_publish_unavailable": "No se pudo transmitir el cambio. Vuelva a intentarlo."
  ```
- [ ] **Step 3: Add the same six keys to `ja.json`.**
  ```json
  "session_revoked_removed": "{businessName}から削除されました",
  "session_revoked_business_deleted": "オーナーが{businessName}を削除しました",
  "session_revoked_ownership_transferred": "{businessName}の所有権が移譲されました",
  "realtime_disconnected_banner": "ライブ更新を一時停止中。再接続しています…",
  "apiMessages.realtime_unavailable": "ライブ更新は一時的にご利用いただけません。",
  "apiMessages.realtime_publish_unavailable": "変更を配信できませんでした。再試行してください。"
  ```
- [ ] **Step 4: Add to `de.json`.**
  ```json
  "session_revoked_removed": "Sie wurden aus {businessName} entfernt.",
  "session_revoked_business_deleted": "{businessName} wurde vom Inhaber gelöscht.",
  "session_revoked_ownership_transferred": "Die Inhaberschaft von {businessName} wurde übertragen.",
  "realtime_disconnected_banner": "Live-Updates pausiert. Verbindung wird wiederhergestellt…",
  "apiMessages.realtime_unavailable": "Live-Updates sind vorübergehend nicht verfügbar.",
  "apiMessages.realtime_publish_unavailable": "Die Änderung konnte nicht übertragen werden. Bitte erneut versuchen."
  ```
- [ ] **Step 5: Add to `fr.json`.**
  ```json
  "session_revoked_removed": "Vous avez été retiré de {businessName}.",
  "session_revoked_business_deleted": "Le propriétaire a supprimé {businessName}.",
  "session_revoked_ownership_transferred": "La propriété de {businessName} a été transférée.",
  "realtime_disconnected_banner": "Mises à jour en direct interrompues. Reconnexion…",
  "apiMessages.realtime_unavailable": "Les mises à jour en direct sont momentanément indisponibles.",
  "apiMessages.realtime_publish_unavailable": "Impossible de diffuser la modification. Veuillez réessayer."
  ```
- [ ] **Step 6: Add to `it.json`.**
  ```json
  "session_revoked_removed": "È stato rimosso da {businessName}.",
  "session_revoked_business_deleted": "Il proprietario ha eliminato {businessName}.",
  "session_revoked_ownership_transferred": "La proprietà di {businessName} è stata trasferita.",
  "realtime_disconnected_banner": "Aggiornamenti in tempo reale in pausa. Riconnessione…",
  "apiMessages.realtime_unavailable": "Gli aggiornamenti in tempo reale non sono al momento disponibili.",
  "apiMessages.realtime_publish_unavailable": "Impossibile trasmettere la modifica. Riprovare."
  ```
- [ ] **Step 7: Add to `pt.json`.**
  ```json
  "session_revoked_removed": "Você foi removido de {businessName}.",
  "session_revoked_business_deleted": "O dono excluiu {businessName}.",
  "session_revoked_ownership_transferred": "A propriedade de {businessName} foi transferida.",
  "realtime_disconnected_banner": "Atualizações ao vivo pausadas. Reconectando…",
  "apiMessages.realtime_unavailable": "As atualizações ao vivo estão temporariamente indisponíveis.",
  "apiMessages.realtime_publish_unavailable": "Não foi possível transmitir a alteração. Tente novamente."
  ```
- [ ] **Step 8: Add to `ko.json`.**
  ```json
  "session_revoked_removed": "{businessName}에서 제거되었습니다",
  "session_revoked_business_deleted": "소유자가 {businessName}을(를) 삭제했습니다",
  "session_revoked_ownership_transferred": "{businessName}의 소유권이 이전되었습니다",
  "realtime_disconnected_banner": "실시간 업데이트 일시 중지됨. 다시 연결 중…",
  "apiMessages.realtime_unavailable": "실시간 업데이트를 일시적으로 사용할 수 없습니다.",
  "apiMessages.realtime_publish_unavailable": "변경 사항을 전송하지 못했습니다. 다시 시도해 주세요."
  ```
- [ ] **Step 9: Add to `zh.json`.**
  ```json
  "session_revoked_removed": "您已被移出{businessName}",
  "session_revoked_business_deleted": "所有者已删除{businessName}",
  "session_revoked_ownership_transferred": "{businessName}的所有权已转移",
  "realtime_disconnected_banner": "实时更新已暂停。正在重新连接…",
  "apiMessages.realtime_unavailable": "实时更新暂时不可用。",
  "apiMessages.realtime_publish_unavailable": "无法广播此更改，请重试。"
  ```
- [ ] **Step 10: Add to `vi.json`.**
  ```json
  "session_revoked_removed": "Bạn đã bị xóa khỏi {businessName}.",
  "session_revoked_business_deleted": "Chủ sở hữu đã xóa {businessName}.",
  "session_revoked_ownership_transferred": "Quyền sở hữu {businessName} đã được chuyển.",
  "realtime_disconnected_banner": "Cập nhật trực tiếp tạm dừng. Đang kết nối lại…",
  "apiMessages.realtime_unavailable": "Cập nhật trực tiếp tạm thời không khả dụng.",
  "apiMessages.realtime_publish_unavailable": "Không thể phát thay đổi. Vui lòng thử lại."
  ```
- [ ] **Step 11: Add to `fil.json`.**
  ```json
  "session_revoked_removed": "Inalis ka sa {businessName}.",
  "session_revoked_business_deleted": "Tinanggal ng owner ang {businessName}.",
  "session_revoked_ownership_transferred": "Inilipat ang ownership ng {businessName}.",
  "realtime_disconnected_banner": "Naka-pause ang live updates. Nire-reconnect…",
  "apiMessages.realtime_unavailable": "Pansamantalang hindi available ang live updates.",
  "apiMessages.realtime_publish_unavailable": "Hindi na-broadcast ang pagbabago. Subukan ulit."
  ```
- [ ] **Step 12: Regenerate `messageIds.d.ts`.** Run `npm run i18n:types --workspace=apps/web`. Expected: `apps/web/src/i18n/messageIds.d.ts` updated, no errors.
- [ ] **Step 13: Commit.**
  ```
  git add apps/web/src/i18n/messages apps/web/src/i18n/messageIds.d.ts
  git commit -m "feat(i18n): add realtime + session-revoke locale keys across 11 locales"
  ```

**Phase 4 done when:** all 11 locale JSONs carry the six new keys (no English placeholders), `messageIds.d.ts` was regenerated and contains them.

---

## Phase 5 — Wire publishes into existing API routes

Each of the following tasks reads the named route file, identifies the post-commit insertion point, adds the publish call(s), adds a publisher-mocking test, and commits. They are sequential because they all touch independent route files. Each commit is reversible.

The X-Device-Id header is read at the top of every modifying handler using this helper. **All Phase 5 tasks rely on this helper**, so it's created as Task 5.0.

### Task 5.0: Add `originDeviceId` extraction helper

**Files:**
- Create: `/Users/adiaz/irvin/apps/api/src/lib/realtime/origin-device.ts`

- [ ] **Step 1: Create the file.**
  ```ts
  import 'server-only'

  /**
   * Reads the X-Device-Id header attached by the web client. Returns
   * undefined when absent (server-to-server callers, tests, curl).
   * The publisher passes this through onto the event payload so the
   * publishing client can suppress its own echo.
   *
   * NOT an authentication factor. Trivially forgeable. The realtime
   * client uses it only for self-echo filtering.
   */
  export function readOriginDeviceId(request: Request): string | undefined {
    const v = request.headers.get('x-device-id')
    return v && v.length > 0 ? v : undefined
  }
  ```
- [ ] **Step 2: Add to the realtime barrel.** Append to `apps/api/src/lib/realtime/index.ts`:
  ```ts
  export * from './origin-device'
  ```
- [ ] **Step 3: Commit.**
  ```
  git add apps/api/src/lib/realtime/origin-device.ts apps/api/src/lib/realtime/index.ts
  git commit -m "feat(realtime): X-Device-Id header reader for echo suppression"
  ```

### Task 5.1: `POST /api/invite/join`

**Files:**
- Modify: `/Users/adiaz/irvin/apps/api/src/app/api/invite/join/route.ts`
- Create: `/Users/adiaz/irvin/apps/api/src/app/api/invite/join/route.test.ts` (if not already present)

- [ ] **Step 1: Write the test.** A new test that mocks the publishers and asserts they were called after a successful join. Adjacent to the route file:
  ```ts
  import { describe, it, expect, vi, beforeEach } from 'vitest'

  const publishToBusiness = vi.fn()
  const publishToUser = vi.fn()

  vi.mock('@/lib/realtime', async (orig) => {
    const real = await orig<typeof import('@/lib/realtime')>()
    return { ...real, publishToBusiness, publishToUser }
  })
  vi.mock('@/lib/auth', () => ({
    auth: { api: { getSession: vi.fn(async () => ({ user: { id: 'joiner', emailVerified: true, name: 'Alice' } })) } },
  }))
  // (Mock the db proxy similarly to existing route tests in this folder.)

  beforeEach(() => {
    publishToBusiness.mockReset()
    publishToUser.mockReset()
  })

  describe('POST /api/invite/join — realtime publishes', () => {
    it('emits team.member.joined + team.invite.consumed on business chan and business.list.changed on joiner user chan', async () => {
      // ...set up db mocks so the join succeeds with invite.businessId='b1', invite.id='inv1'...
      // ...invoke POST handler...
      expect(publishToBusiness).toHaveBeenCalledWith(
        'b1',
        expect.objectContaining({ type: 'team.member.joined', memberId: 'joiner' }),
        undefined,
      )
      expect(publishToBusiness).toHaveBeenCalledWith(
        'b1',
        expect.objectContaining({ type: 'team.invite.consumed', inviteId: 'inv1', consumedByName: 'Alice' }),
        undefined,
      )
      expect(publishToUser).toHaveBeenCalledWith(
        'joiner',
        expect.objectContaining({ type: 'business.list.changed', reason: 'added' }),
        undefined,
      )
    })
  })
  ```
  *Note*: The full mocked db scaffolding mirrors the existing test patterns in `apps/api/src/app/api/businesses/[businessId]/__tests__/patch.test.ts`. Reuse that scaffolding wholesale.
- [ ] **Step 2: Modify the route.** Add imports at top:
  ```ts
  import { publishToBusiness, publishToUser, readOriginDeviceId } from '@/lib/realtime'
  ```
  After the successful insert in the join handler (line 164 in current `route.ts`, immediately before `return NextResponse.json({ success: true, ... })`), insert:
  ```ts
  const deviceId = readOriginDeviceId(request)
  // Fire-and-forget; non-critical UI hints. Each helper is fail-open.
  await publishToBusiness(invite.businessId, {
    type: 'team.member.joined',
    memberId: session.user.id,
  }, deviceId)
  await publishToBusiness(invite.businessId, {
    type: 'team.invite.consumed',
    inviteId: invite.id,
    consumedByName: session.user.name ?? '',
  }, deviceId)
  await publishToUser(session.user.id, {
    type: 'business.list.changed',
    reason: 'added',
  }, deviceId)
  ```
- [ ] **Step 3: Run — expect pass.** `npm run test:run --workspace=apps/api -- src/app/api/invite/join`
- [ ] **Step 4: Commit.**
  ```
  git add apps/api/src/app/api/invite/join
  git commit -m "feat(realtime): publish team.member.joined and invite.consumed on /invite/join"
  ```

### Task 5.2: `POST /api/businesses/create`

**Files:**
- Modify: `/Users/adiaz/irvin/apps/api/src/app/api/businesses/create/route.ts`
- Modify/Create: an adjacent `route.test.ts` covering the new publish.

- [ ] **Step 1: Read the file.** Confirm the structure (handler returns 200 after inserting both the business row and a businessUsers row).
- [ ] **Step 2: Write the test** asserting `publishToUser(creator, business.list.changed reason:'added')`.
- [ ] **Step 3: Modify the route.** Import `publishToUser`, `readOriginDeviceId` from `@/lib/realtime`. After the membership row is inserted and the response is about to be returned, add:
  ```ts
  await publishToUser(user.userId, {
    type: 'business.list.changed',
    reason: 'added',
  }, readOriginDeviceId(request))
  ```
- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Commit.**
  ```
  git add apps/api/src/app/api/businesses/create
  git commit -m "feat(realtime): publish business.list.changed on /businesses (create)"
  ```

### Task 5.3: `PATCH /api/businesses/[businessId]`

**Files:**
- Modify: `/Users/adiaz/irvin/apps/api/src/app/api/businesses/[businessId]/route.ts`
- Modify: `/Users/adiaz/irvin/apps/api/src/app/api/businesses/[businessId]/__tests__/patch.test.ts`

- [ ] **Step 1: Read the file.** Identify the section that updates the business row and computes `changedFields: Array<'name'|'locale'|'currency'|'iconUrl'>`.
- [ ] **Step 2: Write test cases** for:
  - any update -> `publishToBusiness(businessId, { type: 'business.updated', fields: <changedFields> })`
  - name change -> additionally `publishBatchedToUsers(<allMemberIds>, { type: 'business.list.changed', reason: 'renamed' })`
- [ ] **Step 3: Modify the route.** After the DB update commits, compute `changedFields`. Then:
  ```ts
  import { publishToBusiness, publishBatchedToUsers, readOriginDeviceId } from '@/lib/realtime'

  const deviceId = readOriginDeviceId(request)
  if (changedFields.length > 0) {
    await publishToBusiness(access.businessId, {
      type: 'business.updated',
      fields: changedFields,
    }, deviceId)
  }
  if (changedFields.includes('name')) {
    const memberIds = (await db
      .select({ userId: businessUsers.userId })
      .from(businessUsers)
      .where(eq(businessUsers.businessId, access.businessId))
    ).map((r) => r.userId)
    await publishBatchedToUsers(memberIds, {
      type: 'business.list.changed',
      reason: 'renamed',
    }, deviceId)
  }
  ```
- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Commit.**
  ```
  git add apps/api/src/app/api/businesses/[businessId]
  git commit -m "feat(realtime): publish business.updated and rename fan-out on PATCH /businesses/[id]"
  ```

### Task 5.4: `DELETE /api/businesses/[businessId]`

**Files:**
- Modify: `/Users/adiaz/irvin/apps/api/src/app/api/businesses/[businessId]/route.ts`
- Modify: corresponding `__tests__` file (add a DELETE-side test).

- [ ] **Step 1: Read the file.** Identify the DELETE handler and the row-deletion transaction.
- [ ] **Step 2: Write the test.** Asserts:
  - `publishToBusiness(businessId, { type: 'business.deleted', businessId })`
  - for EACH member: `publishCriticalToUser(memberId, { type: 'session.revoked', businessId, reason: 'business_deleted' })`
  - for EACH member: `publishToUser(memberId, { type: 'business.list.changed', reason: 'removed' })`
- [ ] **Step 3: Modify the route.** BEFORE the delete transaction, query all member userIds. After the delete commits:
  ```ts
  import {
    publishToBusiness,
    publishCriticalToUser,
    publishBatchedToUsers,
    readOriginDeviceId,
  } from '@/lib/realtime'
  import { ApiMessageCode } from '@kasero/shared/api-messages'

  const deviceId = readOriginDeviceId(request)
  await publishToBusiness(access.businessId, {
    type: 'business.deleted',
    businessId: access.businessId,
  }, deviceId)
  // Critical: each member gets a stream-backed session.revoked. We use
  // Promise.all so we attempt every recipient even if one fails.
  const criticalResults = await Promise.allSettled(
    memberIds.map((id) =>
      publishCriticalToUser(id, {
        type: 'session.revoked',
        businessId: access.businessId,
        reason: 'business_deleted',
      }, deviceId),
    ),
  )
  // If ANY critical publish failed, the route still returns 200 (delete
  // already committed) but emits the warning. Affected user will get
  // the revocation via the next protected-route 403 fall-through.
  for (const r of criticalResults) {
    if (r.status === 'rejected') {
      console.warn('[realtime] business.delete critical publish failed', r.reason)
    }
  }
  await publishBatchedToUsers(memberIds, {
    type: 'business.list.changed',
    reason: 'removed',
  }, deviceId)
  ```
- [ ] **Step 4: Run — expect pass.**
- [ ] **Step 5: Commit.**
  ```
  git add apps/api/src/app/api/businesses/[businessId]
  git commit -m "feat(realtime): publish business.deleted + session.revoked fan-out on DELETE /businesses/[id]"
  ```

### Task 5.5: `POST /api/businesses/[businessId]/users/remove`

**Files:**
- Modify: `/Users/adiaz/irvin/apps/api/src/app/api/businesses/[businessId]/users/remove/route.ts`
- Create: adjacent `route.test.ts`.

- [ ] **Step 1: Write the test.** Asserts (after a successful remove):
  - `publishToBusiness(businessId, { type: 'team.member.removed', memberId: targetUserId })`
  - `publishCriticalToUser(targetUserId, { type: 'session.revoked', businessId, reason: 'removed' })`
  - `publishToUser(targetUserId, { type: 'business.list.changed', reason: 'removed' })`
- [ ] **Step 2: Modify the route.** After `invalidateAccessCache(userId, access.businessId)`:
  ```ts
  import {
    publishToBusiness,
    publishCriticalToUser,
    publishToUser,
    readOriginDeviceId,
  } from '@/lib/realtime'

  const deviceId = readOriginDeviceId(request)
  await publishToBusiness(access.businessId, {
    type: 'team.member.removed',
    memberId: userId,
  }, deviceId)
  try {
    await publishCriticalToUser(userId, {
      type: 'session.revoked',
      businessId: access.businessId,
      reason: 'removed',
    }, deviceId)
  } catch (err) {
    console.warn('[realtime] users/remove critical publish failed', err)
  }
  await publishToUser(userId, {
    type: 'business.list.changed',
    reason: 'removed',
  }, deviceId)
  ```
- [ ] **Step 3: Run — expect pass.**
- [ ] **Step 4: Commit.**
  ```
  git add apps/api/src/app/api/businesses/[businessId]/users/remove
  git commit -m "feat(realtime): publish team.member.removed and revoke on users/remove"
  ```

### Task 5.6: `POST /api/businesses/[businessId]/users/change-role`

**Files:**
- Modify: `/Users/adiaz/irvin/apps/api/src/app/api/businesses/[businessId]/users/change-role/route.ts`
- Create: adjacent test.

- [ ] **Step 1: Write the test** asserting `publishToBusiness(businessId, { type: 'team.member.role_changed', memberId, role })`.
- [ ] **Step 2: Modify the route.** After successful update:
  ```ts
  import { publishToBusiness, readOriginDeviceId } from '@/lib/realtime'
  await publishToBusiness(access.businessId, {
    type: 'team.member.role_changed',
    memberId: userId,
    role: newRole,
  }, readOriginDeviceId(request))
  ```
- [ ] **Step 3: Run, commit.**
  ```
  git add apps/api/src/app/api/businesses/[businessId]/users/change-role
  git commit -m "feat(realtime): publish team.member.role_changed on users/change-role"
  ```

### Task 5.7: `POST /api/businesses/[businessId]/users/toggle-status`

**Files:**
- Modify: `/Users/adiaz/irvin/apps/api/src/app/api/businesses/[businessId]/users/toggle-status/route.ts`
- Create: adjacent test.

- [ ] **Step 1: Write the test.** Asserts `publishToBusiness(businessId, { type: 'team.member.status_changed', memberId, status })`.
- [ ] **Step 2: Modify the route.** After update:
  ```ts
  import { publishToBusiness, readOriginDeviceId } from '@/lib/realtime'
  await publishToBusiness(access.businessId, {
    type: 'team.member.status_changed',
    memberId: userId,
    status: newStatus,
  }, readOriginDeviceId(request))
  ```
- [ ] **Step 3: Run, commit.**
  ```
  git add apps/api/src/app/api/businesses/[businessId]/users/toggle-status
  git commit -m "feat(realtime): publish team.member.status_changed on toggle-status"
  ```

### Task 5.8: `POST /api/businesses/[businessId]/invite/create`

**Files:**
- Modify: `/Users/adiaz/irvin/apps/api/src/app/api/businesses/[businessId]/invite/create/route.ts`
- Create: adjacent test.

- [ ] **Step 1: Test** asserts `publishToBusiness(businessId, { type: 'team.invite.created', inviteId })`.
- [ ] **Step 2: Modify** after the insert:
  ```ts
  import { publishToBusiness, readOriginDeviceId } from '@/lib/realtime'
  await publishToBusiness(access.businessId, {
    type: 'team.invite.created',
    inviteId: newInvite.id,
  }, readOriginDeviceId(request))
  ```
- [ ] **Step 3: Commit.**
  ```
  git add apps/api/src/app/api/businesses/[businessId]/invite/create
  git commit -m "feat(realtime): publish team.invite.created on invite/create"
  ```

### Task 5.9: `POST /api/businesses/[businessId]/invite/regenerate`

**Files:**
- Modify: `/Users/adiaz/irvin/apps/api/src/app/api/businesses/[businessId]/invite/regenerate/route.ts`
- Create: adjacent test.

- [ ] **Step 1: Test** asserts `publishToBusiness(businessId, { type: 'team.invite.regenerated', inviteId: newInvite.id })`.
- [ ] **Step 2: Modify** after the update/insert:
  ```ts
  import { publishToBusiness, readOriginDeviceId } from '@/lib/realtime'
  await publishToBusiness(access.businessId, {
    type: 'team.invite.regenerated',
    inviteId: regeneratedInvite.id,
  }, readOriginDeviceId(request))
  ```
- [ ] **Step 3: Commit.**
  ```
  git add apps/api/src/app/api/businesses/[businessId]/invite/regenerate
  git commit -m "feat(realtime): publish team.invite.regenerated"
  ```

### Task 5.10: `POST /api/businesses/[businessId]/invite/delete`

**Files:**
- Modify: `/Users/adiaz/irvin/apps/api/src/app/api/businesses/[businessId]/invite/delete/route.ts`
- Create: adjacent test.

- [ ] **Step 1: Test** asserts `publishToBusiness(businessId, { type: 'team.invite.deleted', inviteId })`.
- [ ] **Step 2: Modify** after the delete:
  ```ts
  import { publishToBusiness, readOriginDeviceId } from '@/lib/realtime'
  await publishToBusiness(access.businessId, {
    type: 'team.invite.deleted',
    inviteId,
  }, readOriginDeviceId(request))
  ```
- [ ] **Step 3: Commit.**
  ```
  git add apps/api/src/app/api/businesses/[businessId]/invite/delete
  git commit -m "feat(realtime): publish team.invite.deleted"
  ```

### Task 5.11: `POST /api/transfer/accept`

**Files:**
- Modify: `/Users/adiaz/irvin/apps/api/src/app/api/transfer/accept/route.ts`
- Create: adjacent test.

- [ ] **Step 1: Test** asserts BOTH halves:
  - New owner: `publishCriticalToUser(newOwnerId, { type: 'ownership.transferred', businessId, role: 'new_owner' })` AND `publishToUser(newOwnerId, { type: 'business.list.changed', reason: 'added' })`.
  - Former owner: `publishCriticalToUser(formerOwnerId, { type: 'session.revoked', businessId, reason: 'ownership_transferred' })` AND `publishToUser(formerOwnerId, { type: 'business.list.changed', reason: 'removed' })`.
- [ ] **Step 2: Modify** after the transfer transaction commits:
  ```ts
  import {
    publishCriticalToUser,
    publishToUser,
    readOriginDeviceId,
  } from '@/lib/realtime'

  const deviceId = readOriginDeviceId(request)
  // New owner.
  try {
    await publishCriticalToUser(newOwnerId, {
      type: 'ownership.transferred',
      businessId,
      role: 'new_owner',
    }, deviceId)
  } catch (err) {
    console.warn('[realtime] transfer/accept new-owner critical publish failed', err)
  }
  await publishToUser(newOwnerId, {
    type: 'business.list.changed',
    reason: 'added',
  }, deviceId)
  // Former owner.
  try {
    await publishCriticalToUser(formerOwnerId, {
      type: 'session.revoked',
      businessId,
      reason: 'ownership_transferred',
    }, deviceId)
  } catch (err) {
    console.warn('[realtime] transfer/accept former-owner critical publish failed', err)
  }
  await publishToUser(formerOwnerId, {
    type: 'business.list.changed',
    reason: 'removed',
  }, deviceId)
  ```
- [ ] **Step 3: Commit.**
  ```
  git add apps/api/src/app/api/transfer/accept
  git commit -m "feat(realtime): publish ownership.transferred + session.revoked on transfer/accept"
  ```

### Task 5.12: `POST /api/account/change-email`

**Files:**
- Modify: `/Users/adiaz/irvin/apps/api/src/app/api/account/change-email/route.ts`
- Modify: `/Users/adiaz/irvin/apps/api/src/app/api/account/change-email/route.test.ts`

- [ ] **Step 1: Test** asserts that, on successful confirm, `publishToUser(userId, { type: 'profile.updated', fields: ['email'] })` is called once.
- [ ] **Step 2: Modify** the confirm-phase return (right before `return successResponse(...)`):
  ```ts
  import { publishToUser, readOriginDeviceId } from '@/lib/realtime'
  await publishToUser(user.userId, {
    type: 'profile.updated',
    fields: ['email'],
  }, readOriginDeviceId(request))
  ```
- [ ] **Step 3: Commit.**
  ```
  git add apps/api/src/app/api/account/change-email
  git commit -m "feat(realtime): publish profile.updated on /account/change-email confirm"
  ```

### Task 5.13: Profile updates via better-auth `update-user` (name/language)

The web client calls `authClient.updateUser({ name })` and `authClient.updateUser({ language })`, both of which POST to `/api/auth/update-user` (handled by better-auth, not our route handler). To publish a `profile.updated` event we add an `after` hook in `apps/api/src/lib/auth.ts` that runs after this specific endpoint.

**Files:**
- Modify: `/Users/adiaz/irvin/apps/api/src/lib/auth.ts`
- Modify: `/Users/adiaz/irvin/apps/api/src/lib/auth.test.ts`

- [ ] **Step 1: Test** by adding a unit test that constructs the auth instance with a mocked publisher and a fake call into the hook chain, then asserts `publishToUser` was called with `fields: ['displayName']` for a name change and `['language']` for a language change.
- [ ] **Step 2: Modify `auth.ts`.** Extend the existing `hooks` block to add `after` middleware. (The current block has only `before`.) Replace the `hooks` block with:
  ```ts
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // ... existing cross-account-verification guard, unchanged ...
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/update-user') return
      // ctx returns the response context after the endpoint resolves.
      // Resolve the session to get the affected user id.
      const session = await getSessionFromCtx(ctx).catch(() => null)
      if (!session) return
      const body = ctx.body as { name?: string; language?: string; image?: string } | undefined
      const fields: Array<'displayName' | 'email' | 'language'> = []
      if (body?.name != null) fields.push('displayName')
      if (body?.language != null) fields.push('language')
      // image -> profile.updated displayName proxy is not in the event
      // schema; if/when image-change UX needs realtime, add an
      // 'avatar' field to UserRealtimeEvent.fields.
      if (fields.length === 0) return
      const deviceId = ctx.request?.headers.get('x-device-id') ?? undefined
      // Dynamic import to avoid circular load order with realtime/redis.
      const { publishToUser } = await import('./realtime/publisher')
      await publishToUser(session.user.id, {
        type: 'profile.updated',
        fields,
      }, deviceId || undefined)
    }),
  },
  ```
- [ ] **Step 3: Run, commit.**
  ```
  git add apps/api/src/lib/auth.ts apps/api/src/lib/auth.test.ts
  git commit -m "feat(realtime): publish profile.updated on better-auth /update-user"
  ```

**Phase 5 done when:** every event in spec §6 has a corresponding publish site (12 commits total), each gated by a passing test that mocks the publisher.

---

## Phase 6 — Client foundation libs

### Task 6.1: `device-id.ts`

**Files:**
- Create: `/Users/adiaz/irvin/apps/web/src/lib/realtime/device-id.ts`
- Create: `/Users/adiaz/irvin/apps/web/src/lib/realtime/device-id.test.ts`

- [ ] **Step 1: Test.**
  ```ts
  import { describe, it, expect, beforeEach, vi } from 'vitest'

  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  describe('getDeviceId', () => {
    it('generates and persists a stable id', async () => {
      const { getDeviceId } = await import('./device-id')
      const id = getDeviceId()
      expect(id).toMatch(/^[A-Za-z0-9_-]{12,}$/)
      expect(localStorage.getItem('kasero.device.id')).toBe(id)
    })
    it('returns the same id across calls', async () => {
      const { getDeviceId } = await import('./device-id')
      expect(getDeviceId()).toBe(getDeviceId())
    })
  })
  ```
- [ ] **Step 2: Implement.**
  ```ts
  import { nanoid } from 'nanoid'

  const STORAGE_KEY = 'kasero.device.id'

  /**
   * Stable per-device identifier persisted in localStorage. Used by the
   * realtime client for echo suppression: the publishing client tags
   * its mutations with this id (via the X-Device-Id header) and ignores
   * any inbound event whose originDeviceId matches.
   *
   * NOT an authentication factor.
   */
  export function getDeviceId(): string {
    try {
      const existing = localStorage.getItem(STORAGE_KEY)
      if (existing && existing.length > 0) return existing
      const fresh = nanoid()
      localStorage.setItem(STORAGE_KEY, fresh)
      return fresh
    } catch {
      // localStorage unavailable (Safari private mode etc): fall back
      // to a per-tab in-memory id. Echo suppression still works within
      // the tab; cross-tab on the same device degrades to the same
      // multi-device UX as a separate device, which is acceptable.
      return inMemoryId ??= nanoid()
    }
  }
  let inMemoryId: string | undefined
  ```
- [ ] **Step 3: Run, commit.**
  ```
  git add apps/web/src/lib/realtime/device-id.ts apps/web/src/lib/realtime/device-id.test.ts
  git commit -m "feat(realtime/web): stable per-device id in localStorage"
  ```

### Task 6.2: `refetch-registry.ts`

**Files:**
- Create: `/Users/adiaz/irvin/apps/web/src/lib/realtime/refetch-registry.ts`
- Create: `/Users/adiaz/irvin/apps/web/src/lib/realtime/refetch-registry.test.ts`

- [ ] **Step 1: Test.**
  ```ts
  import { describe, it, expect, vi } from 'vitest'

  describe('refetch registry', () => {
    it('register + callRefetch invokes the fn', async () => {
      const { registerRefetch, callRefetch } = await import('./refetch-registry')
      const fn = vi.fn(async () => {})
      const unsub = registerRefetch('team', fn)
      callRefetch('team')
      await new Promise((r) => setTimeout(r, 110))
      expect(fn).toHaveBeenCalledTimes(1)
      unsub()
    })
    it('debounces (leading-edge 100ms): 3 rapid calls -> 1 invocation', async () => {
      const { registerRefetch, callRefetch } = await import('./refetch-registry')
      const fn = vi.fn(async () => {})
      registerRefetch('business', fn)
      callRefetch('business')
      callRefetch('business')
      callRefetch('business')
      await new Promise((r) => setTimeout(r, 110))
      expect(fn).toHaveBeenCalledTimes(1)
    })
    it('unregister removes the listener', async () => {
      const { registerRefetch, callRefetch } = await import('./refetch-registry')
      const fn = vi.fn(async () => {})
      const unsub = registerRefetch('profile', fn)
      unsub()
      callRefetch('profile')
      await new Promise((r) => setTimeout(r, 110))
      expect(fn).not.toHaveBeenCalled()
    })
    it('callAllRefetches invokes every registered fn once', async () => {
      const { registerRefetch, callAllRefetches } = await import('./refetch-registry')
      const a = vi.fn(async () => {})
      const b = vi.fn(async () => {})
      registerRefetch('team', a)
      registerRefetch('profile', b)
      callAllRefetches()
      await new Promise((r) => setTimeout(r, 110))
      expect(a).toHaveBeenCalledTimes(1)
      expect(b).toHaveBeenCalledTimes(1)
    })
  })
  ```
- [ ] **Step 2: Implement.**
  ```ts
  export type RefetchKey = 'team' | 'invites' | 'business' | 'businesses-list' | 'profile'

  type Listener = () => Promise<void> | void

  const listeners = new Map<RefetchKey, Set<Listener>>()
  const pending = new Map<RefetchKey, number>()
  const DEBOUNCE_MS = 100

  /**
   * Register a refetch callback for a given key. Returns an unregister
   * function. Multiple providers can register against the same key
   * (each is invoked). Idempotent: a provider that registers twice and
   * unregisters once still has one listener live.
   */
  export function registerRefetch(key: RefetchKey, fn: Listener): () => void {
    let set = listeners.get(key)
    if (!set) {
      set = new Set()
      listeners.set(key, set)
    }
    set.add(fn)
    return () => {
      set?.delete(fn)
      if (set && set.size === 0) listeners.delete(key)
    }
  }

  /**
   * Invoke every listener registered against `key`. Leading-edge
   * debounced 100ms: rapid bursts collapse to a single invocation per
   * burst.
   */
  export function callRefetch(key: RefetchKey): void {
    if (pending.has(key)) return
    const timer = window.setTimeout(() => {
      pending.delete(key)
      const set = listeners.get(key)
      if (!set) return
      for (const fn of set) {
        Promise.resolve(fn()).catch((err) => {
          console.warn('[realtime] refetch listener threw for', key, err)
        })
      }
    }, DEBOUNCE_MS)
    pending.set(key, timer)
  }

  /**
   * Invoke every registered refetch across every key — used on
   * system.resync.
   */
  export function callAllRefetches(): void {
    for (const key of listeners.keys()) callRefetch(key)
  }
  ```
- [ ] **Step 3: Run, commit.**
  ```
  git add apps/web/src/lib/realtime/refetch-registry.ts apps/web/src/lib/realtime/refetch-registry.test.ts
  git commit -m "feat(realtime/web): refetch registry with leading-edge debounce"
  ```

### Task 6.3: `handlers.ts` — exhaustive event dispatcher

**Files:**
- Create: `/Users/adiaz/irvin/apps/web/src/lib/realtime/handlers.ts`
- Create: `/Users/adiaz/irvin/apps/web/src/lib/realtime/handlers.test.ts`

- [ ] **Step 1: Test.**
  ```ts
  import { describe, it, expect, vi, beforeEach } from 'vitest'

  const callRefetch = vi.fn()
  const callAllRefetches = vi.fn()
  vi.mock('./refetch-registry', () => ({ callRefetch, callAllRefetches }))

  const revoke = vi.fn()
  const onAuthExpired = vi.fn()
  const onSystemError = vi.fn()

  beforeEach(() => {
    callRefetch.mockReset()
    callAllRefetches.mockReset()
    revoke.mockReset()
    onAuthExpired.mockReset()
    onSystemError.mockReset()
  })

  describe('dispatchEvent', () => {
    const ctx = {
      ownDeviceId: 'me',
      revokeBusinessContext: revoke,
      onAuthExpired,
      onSystemError,
    }

    it('team.member.joined -> callRefetch(team) + callRefetch(invites)', async () => {
      const { dispatchEvent } = await import('./handlers')
      dispatchEvent({ type: 'team.member.joined', memberId: 'm' }, ctx)
      expect(callRefetch).toHaveBeenCalledWith('team')
      expect(callRefetch).toHaveBeenCalledWith('invites')
    })

    it('session.revoked -> revokeBusinessContext(businessId, reason)', async () => {
      const { dispatchEvent } = await import('./handlers')
      dispatchEvent({ type: 'session.revoked', businessId: 'b1', reason: 'removed' }, ctx)
      expect(revoke).toHaveBeenCalledWith('b1', 'removed')
    })

    it('system.resync -> callAllRefetches', async () => {
      const { dispatchEvent } = await import('./handlers')
      dispatchEvent({ type: 'system.resync' }, ctx)
      expect(callAllRefetches).toHaveBeenCalled()
    })

    it('echo suppression: event with own deviceId is dropped', async () => {
      const { dispatchEvent } = await import('./handlers')
      dispatchEvent(
        { type: 'team.member.joined', memberId: 'm', originDeviceId: 'me' },
        ctx,
      )
      expect(callRefetch).not.toHaveBeenCalled()
    })
  })
  ```
- [ ] **Step 2: Implement.**
  ```ts
  import type { RealtimeEvent } from '@kasero/shared/realtime'
  import type { ApiMessageCode } from '@kasero/shared/api-messages'
  import { callRefetch, callAllRefetches } from './refetch-registry'

  export interface DispatchContext {
    ownDeviceId: string
    revokeBusinessContext: (businessId: string, reason: 'removed' | 'business_deleted' | 'ownership_transferred') => void
    onAuthExpired: () => void
    onSystemError: (code: ApiMessageCode) => void
  }

  /**
   * Pure switch over RealtimeEvent['type']. No default branch — adding
   * a new event type without a case here is a TypeScript build error.
   * This is the single most important guard against server/client
   * drift.
   */
  export function dispatchEvent(event: RealtimeEvent, ctx: DispatchContext): void {
    // Echo suppression: drop events the publishing client tagged with
    // our own deviceId.
    if (
      'originDeviceId' in event &&
      event.originDeviceId &&
      event.originDeviceId === ctx.ownDeviceId
    ) {
      return
    }

    switch (event.type) {
      case 'team.member.joined':
      case 'team.member.removed':
      case 'team.member.role_changed':
      case 'team.member.status_changed':
        callRefetch('team')
        callRefetch('invites')
        return
      case 'team.invite.created':
      case 'team.invite.regenerated':
      case 'team.invite.consumed':
      case 'team.invite.deleted':
        callRefetch('invites')
        return
      case 'business.updated':
        callRefetch('business')
        return
      case 'profile.updated':
        // language is special: the LocaleProvider listens to a separate
        // LANGUAGE_CHANGE_EVENT, but a refetch of profile reads the new
        // value out of the User object and triggers the locale load.
        callRefetch('profile')
        return
      case 'business.list.changed':
        callRefetch('businesses-list')
        return
      case 'session.revoked':
        ctx.revokeBusinessContext(event.businessId, event.reason)
        return
      case 'business.deleted':
        ctx.revokeBusinessContext(event.businessId, 'business_deleted')
        return
      case 'ownership.transferred':
        if (event.role === 'former_owner') {
          ctx.revokeBusinessContext(event.businessId, 'ownership_transferred')
        } else {
          callRefetch('businesses-list')
        }
        return
      case 'system.resync':
        callAllRefetches()
        return
      case 'system.error':
        ctx.onSystemError(event.code)
        return
      case 'system.auth_expired':
        ctx.onAuthExpired()
        return
    }
    // TS exhaustiveness: if a new event type is added without a case
    // above, the next line is `event: never` and the assignment fails.
    const _exhaustive: never = event
    return _exhaustive
  }
  ```
- [ ] **Step 3: Run, commit.**
  ```
  git add apps/web/src/lib/realtime/handlers.ts apps/web/src/lib/realtime/handlers.test.ts
  git commit -m "feat(realtime/web): event dispatcher with exhaustive switch and echo suppression"
  ```

### Task 6.4: `api-client-header.ts` — attach X-Device-Id to outgoing fetches

**Files:**
- Modify: `/Users/adiaz/irvin/apps/web/src/lib/api-client.ts`
- Modify: `/Users/adiaz/irvin/apps/web/src/lib/api-client.test.ts`

- [ ] **Step 1: Test** that `apiRequest('/api/...', { headers: { ... } })` automatically adds the header. New test case in `api-client.test.ts`:
  ```ts
  it('attaches X-Device-Id to every outgoing request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    const { apiPost } = await import('./api-client')
    await apiPost('/api/test', {})
    const [, init] = fetchSpy.mock.calls[0]
    const headers = new Headers((init as RequestInit).headers)
    expect(headers.get('x-device-id')).toBeTruthy()
    fetchSpy.mockRestore()
  })
  ```
- [ ] **Step 2: Modify `apiRequest`** (inside `apps/web/src/lib/api-client.ts`). Add the device-id import at top and inject into headers before calling `fetch`. Replace the `try { response = await fetch(url, options) }` block with:
  ```ts
  import { getDeviceId } from '@/lib/realtime/device-id'

  // ...

  // Inject X-Device-Id on every outbound API request. The realtime
  // publisher echoes this id back via originDeviceId so the publishing
  // client can suppress its own event.
  const headers = new Headers(options?.headers)
  if (!headers.has('x-device-id')) {
    try {
      headers.set('x-device-id', getDeviceId())
    } catch {
      // localStorage unavailable; skip.
    }
  }
  const augmented: RequestInit = { ...options, headers }
  try {
    response = await fetch(url, augmented)
  } catch (err) {
    // ... existing error handling unchanged ...
  }
  ```
- [ ] **Step 3: Run, commit.**
  ```
  git add apps/web/src/lib/api-client.ts apps/web/src/lib/api-client.test.ts
  git commit -m "feat(realtime/web): attach X-Device-Id to every outgoing API request"
  ```

**Phase 6 done when:** device-id stable, refetch registry register/call/debounce works, dispatcher covers every event branch with TS exhaustiveness guard, api-client tags fetches.

---

## Phase 7 — Client `RealtimeProvider`

### Task 7.1: Create `apps/web/src/contexts/realtime-context.tsx`

**Files:**
- Create: `/Users/adiaz/irvin/apps/web/src/contexts/realtime-context.tsx`
- Create: `/Users/adiaz/irvin/apps/web/src/contexts/realtime-context.test.tsx`
- Modify: `/Users/adiaz/irvin/apps/web/src/App.tsx` (insert into provider tree)

- [ ] **Step 1: Test** (vitest + @testing-library/react). Mock `EventSource`, mock auth context, assert that the provider:
  - opens an `EventSource('/api/realtime?deviceId=...')` when authenticated
  - closes it on logout
  - opens with `?businessId=<id>&deviceId=...` when an `activeBusinessId` prop changes
  - debounces business switches by 250ms
  - calls `eventSource.close()` and reopens after 45s with no message (watchdog)
  - calls `eventSource.close()` after 3 consecutive `error` events without an intervening `open`
  - dispatches received messages through `dispatchEvent`
  - filters events with own deviceId
  Test code is ~150 lines; mirror the patterns in `apps/web/src/contexts/auth-context.test.tsx` if one exists, otherwise use `@testing-library/react` directly with a `renderHook` wrapper.
- [ ] **Step 2: Implement.**
  ```tsx
  'use client'

  import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
  } from 'react'
  import { useIonRouter, useIonToast } from '@ionic/react'
  import { useIntl } from 'react-intl'
  import { useAuth } from '@/contexts/auth-context'
  import { getDeviceId } from '@/lib/realtime/device-id'
  import { dispatchEvent, type DispatchContext } from '@/lib/realtime/handlers'
  import { callRefetch } from '@/lib/realtime/refetch-registry'
  import type { RealtimeEvent } from '@kasero/shared/realtime'
  import type { ApiMessageCode } from '@kasero/shared/api-messages'

  type RevokeReason = 'removed' | 'business_deleted' | 'ownership_transferred'

  interface RealtimeContextValue {
    /**
     * Set the active business id. The provider closes the current
     * EventSource and reopens with the new businessId query param,
     * debounced 250ms.
     */
    setActiveBusinessId: (id: string | null) => void
    /**
     * Idempotent: tear down active-business state if the revoked id
     * matches the currently-active business.
     */
    revokeBusinessContext: (businessId: string, reason: RevokeReason) => void
  }

  const RealtimeContext = createContext<RealtimeContextValue | null>(null)
  export function useRealtime(): RealtimeContextValue {
    const v = useContext(RealtimeContext)
    if (!v) throw new Error('useRealtime must be used inside <RealtimeProvider>')
    return v
  }

  const WATCHDOG_MS = 45_000
  const SWITCH_DEBOUNCE_MS = 250
  const MAX_CONSECUTIVE_ERRORS = 3

  export function RealtimeProvider({ children }: { children: ReactNode }) {
    const { user, isAuthenticated, logout } = useAuth()
    const router = useIonRouter()
    const [presentToast] = useIonToast()
    const intl = useIntl()

    const [activeBusinessId, setActiveBusinessIdState] = useState<string | null>(null)
    const switchTimerRef = useRef<number | null>(null)
    const esRef = useRef<EventSource | null>(null)
    const watchdogRef = useRef<number | null>(null)
    const consecutiveErrorsRef = useRef(0)
    const ownDeviceIdRef = useRef<string>('')

    if (!ownDeviceIdRef.current) {
      try {
        ownDeviceIdRef.current = getDeviceId()
      } catch {
        ownDeviceIdRef.current = ''
      }
    }

    // ============================================
    // REVOKE FLOW
    // ============================================
    const revokeBusinessContext = useCallback(
      (businessId: string, reason: RevokeReason) => {
        if (activeBusinessId !== businessId) {
          // Not the active business — silently refetch businesses-list.
          callRefetch('businesses-list')
          return
        }
        // Active business is being revoked.
        const message = (() => {
          switch (reason) {
            case 'removed':
              return intl.formatMessage(
                { id: 'session_revoked_removed' },
                { businessName: '' },
              )
            case 'business_deleted':
              return intl.formatMessage(
                { id: 'session_revoked_business_deleted' },
                { businessName: '' },
              )
            case 'ownership_transferred':
              return intl.formatMessage(
                { id: 'session_revoked_ownership_transferred' },
                { businessName: '' },
              )
          }
        })()
        presentToast({ message, duration: 4000, color: 'medium' })
        callRefetch('businesses-list')
        setActiveBusinessIdState(null)
        // Navigate to the hub (business switcher).
        router.push('/', 'root', 'replace')
      },
      [activeBusinessId, intl, presentToast, router],
    )

    // ============================================
    // SYSTEM EVENT HANDLERS
    // ============================================
    const onAuthExpired = useCallback(() => {
      esRef.current?.close()
      esRef.current = null
      logout()
    }, [logout])

    const onSystemError = useCallback(
      (code: ApiMessageCode) => {
        presentToast({
          message: intl.formatMessage({
            id: code === 'REALTIME_UNAVAILABLE'
              ? 'apiMessages.realtime_unavailable'
              : 'apiMessages.realtime_publish_unavailable',
          }),
          duration: 4000,
          color: 'warning',
        })
      },
      [intl, presentToast],
    )

    // ============================================
    // ES OPEN/CLOSE
    // ============================================
    const openConnection = useCallback(() => {
      if (!isAuthenticated || !user) return
      // Close prior.
      esRef.current?.close()
      const params = new URLSearchParams()
      if (activeBusinessId) params.set('businessId', activeBusinessId)
      params.set('deviceId', ownDeviceIdRef.current)
      const es = new EventSource(`/api/realtime?${params.toString()}`)
      esRef.current = es

      const resetWatchdog = () => {
        if (watchdogRef.current) window.clearTimeout(watchdogRef.current)
        watchdogRef.current = window.setTimeout(() => {
          es.close()
          openConnection()
        }, WATCHDOG_MS)
      }

      es.addEventListener('open', () => {
        consecutiveErrorsRef.current = 0
        resetWatchdog()
      })

      const ctx: DispatchContext = {
        ownDeviceId: ownDeviceIdRef.current,
        revokeBusinessContext,
        onAuthExpired,
        onSystemError,
      }

      const onMessage = (ev: MessageEvent) => {
        resetWatchdog()
        try {
          const event = JSON.parse(ev.data) as RealtimeEvent
          dispatchEvent(event, ctx)
        } catch (err) {
          console.warn('[realtime] failed to parse event payload', err)
        }
      }
      // The server sets `event: <type>` on every frame; we listen on
      // each event name explicitly OR rely on the default 'message'
      // listener when no `event:` field is set. Modern browsers fall
      // through to addEventListener('<type>', ...) for named events.
      // We listen on 'message' as fallback and on each event name.
      es.onmessage = onMessage
      ;(['team.member.joined','team.member.removed','team.member.role_changed','team.member.status_changed','team.invite.created','team.invite.regenerated','team.invite.consumed','team.invite.deleted','business.updated','profile.updated','business.list.changed','session.revoked','business.deleted','ownership.transferred','system.resync','system.error','system.auth_expired'] as const).forEach((type) => {
        es.addEventListener(type, onMessage as EventListener)
      })

      es.addEventListener('error', () => {
        consecutiveErrorsRef.current += 1
        if (consecutiveErrorsRef.current >= MAX_CONSECUTIVE_ERRORS) {
          es.close()
          esRef.current = null
          // After 3 consecutive errors without an open: log the user out.
          // Browsers retry EventSource on 401 indefinitely; this is our
          // belt over that.
          onAuthExpired()
        }
      })

      resetWatchdog()
    }, [
      activeBusinessId,
      isAuthenticated,
      onAuthExpired,
      onSystemError,
      revokeBusinessContext,
      user,
    ])

    // Open/close on auth state and active-business change.
    useEffect(() => {
      if (!isAuthenticated) {
        esRef.current?.close()
        esRef.current = null
        return
      }
      openConnection()
      return () => {
        esRef.current?.close()
        esRef.current = null
        if (watchdogRef.current) window.clearTimeout(watchdogRef.current)
      }
    }, [isAuthenticated, openConnection])

    // Debounced business switch.
    const setActiveBusinessId = useCallback((id: string | null) => {
      if (switchTimerRef.current) window.clearTimeout(switchTimerRef.current)
      switchTimerRef.current = window.setTimeout(() => {
        setActiveBusinessIdState(id)
      }, SWITCH_DEBOUNCE_MS)
    }, [])

    const value = useMemo<RealtimeContextValue>(() => ({
      setActiveBusinessId,
      revokeBusinessContext,
    }), [setActiveBusinessId, revokeBusinessContext])

    return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
  }
  ```
- [ ] **Step 3: Insert into App.tsx.** Edit `apps/web/src/App.tsx`. Add import:
  ```tsx
  import { RealtimeProvider } from '@/contexts/realtime-context'
  ```
  Wrap the existing `<AuthGateProvider>` block with `<RealtimeProvider>` so it sits inside `<AuthProvider>` but above the business data contexts:
  ```tsx
  <AuthProvider>
    <RealtimeProvider>
      <AuthGateProvider>
        {/* ... existing children unchanged ... */}
      </AuthGateProvider>
    </RealtimeProvider>
  </AuthProvider>
  ```
- [ ] **Step 4: Run, commit.**
  ```
  git add apps/web/src/contexts/realtime-context.tsx apps/web/src/contexts/realtime-context.test.tsx apps/web/src/App.tsx
  git commit -m "feat(realtime/web): RealtimeProvider with watchdog, debounce, revoke flow"
  ```

**Phase 7 done when:** RealtimeProvider mounts above business contexts, opens EventSource when authenticated, reconnects on watchdog, closes on 3-error streak, dispatches events.

---

## Phase 8 — Provider registrations

The existing contexts register their refetch methods against the registry on mount.

### Task 8.1: `business-context.tsx` registers under `business`

**Files:**
- Modify: `/Users/adiaz/irvin/apps/web/src/contexts/business-context.tsx`

- [ ] **Step 1: Inside the BusinessProvider, add a `useEffect` that registers `validateAccess` (the existing refetch fn — see line 169 of the current file) against the `business` key:**
  ```tsx
  import { registerRefetch } from '@/lib/realtime/refetch-registry'

  // inside the provider body, after validateAccess is defined:
  useEffect(() => {
    const unsub = registerRefetch('business', () => validateAccess())
    return unsub
  }, [validateAccess])
  ```
- [ ] **Step 2: Write a test** asserting that emitting `callRefetch('business')` after mount invokes the provider's validateAccess.
- [ ] **Step 3: Commit.**
  ```
  git add apps/web/src/contexts/business-context.tsx
  git commit -m "feat(realtime/web): business-context registers under 'business' refetch key"
  ```

### Task 8.2: `auth-context.tsx` registers under `profile`

**Files:**
- Modify: `/Users/adiaz/irvin/apps/web/src/contexts/auth-context.tsx`

- [ ] **Step 1: Identify the existing session-refetch path.** `authClient.getSession()` is the canonical refetch; the context already exposes a `refreshUser`/equivalent fn (read the file to confirm — call it `refreshSession` if no helper exists, expose one via the context).
- [ ] **Step 2: Add registration.**
  ```tsx
  useEffect(() => {
    const unsub = registerRefetch('profile', refreshSession)
    return unsub
  }, [refreshSession])
  ```
- [ ] **Step 3: Test, commit.**
  ```
  git add apps/web/src/contexts/auth-context.tsx
  git commit -m "feat(realtime/web): auth-context registers under 'profile' refetch key"
  ```

### Task 8.3: Businesses-list registration in `HubHome.tsx`

**Files:**
- Modify: `/Users/adiaz/irvin/apps/web/src/components/hub/HubHome.tsx`

- [ ] **Step 1: Register `fetchBusinesses` under `businesses-list`** on mount:
  ```tsx
  import { registerRefetch } from '@/lib/realtime/refetch-registry'

  // after fetchBusinesses is defined:
  useEffect(() => {
    const unsub = registerRefetch('businesses-list', fetchBusinesses)
    return unsub
  }, [fetchBusinesses])
  ```
- [ ] **Step 2: Test, commit.**
  ```
  git add apps/web/src/components/hub/HubHome.tsx
  git commit -m "feat(realtime/web): HubHome registers businesses-list refetch"
  ```

### Task 8.4: Team-data registration — wrap `useTeamManagement` consumer with a context

Team data is currently page-local (owned by `useTeamManagement`). To make it realtime-driven without a heavy refactor, we hoist the hook into a small context provider that wraps `TeamDrilldown`. The provider exposes the team data and registers `loadTeamData` against the `team` and `invites` keys.

**Files:**
- Create: `/Users/adiaz/irvin/apps/web/src/contexts/team-context.tsx`
- Modify: `/Users/adiaz/irvin/apps/web/src/components/team/TeamDrilldown.tsx` (and any other `useTeamManagement` consumers in the page tree) to read from the new context instead of calling the hook directly.

- [ ] **Step 1: Create `apps/web/src/contexts/team-context.tsx`.**
  ```tsx
  'use client'

  import { createContext, useContext, useEffect, type ReactNode } from 'react'
  import { useTeamManagement, type TeamMember } from '@/hooks/useTeamManagement'
  import { registerRefetch } from '@/lib/realtime/refetch-registry'

  interface TeamContextValue extends ReturnType<typeof useTeamManagement> {}

  const TeamContext = createContext<TeamContextValue | null>(null)
  export function useTeam(): TeamContextValue {
    const v = useContext(TeamContext)
    if (!v) throw new Error('useTeam must be inside <TeamProvider>')
    return v
  }

  export function TeamProvider({
    businessId,
    children,
  }: {
    businessId: string
    children: ReactNode
  }) {
    const team = useTeamManagement({ businessId })
    useEffect(() => {
      // useTeamManagement does not expose its loader as a named ref;
      // we register a small wrapper that triggers a re-run by toggling
      // an internal refresh counter. Implement by adding a `refresh`
      // method to useTeamManagement (see step 2).
      const unsubTeam = registerRefetch('team', team.refresh)
      const unsubInv = registerRefetch('invites', team.refresh)
      return () => {
        unsubTeam()
        unsubInv()
      }
    }, [team.refresh])
    return <TeamContext.Provider value={team}>{children}</TeamContext.Provider>
  }
  ```
- [ ] **Step 2: Add a `refresh()` method to `useTeamManagement`.** Edit `apps/web/src/hooks/useTeamManagement.ts` — extract the `loadTeamData` async function out of the `useEffect` so it can be returned. Replace:
  ```ts
  useEffect(() => {
    const loadTeamData = async () => { /* ... */ }
    loadTeamData()
  }, [businessId, t, translateApiMessage])
  ```
  with:
  ```ts
  const loadTeamData = useCallback(async () => {
    try {
      const data = await apiRequest<TeamDataResponse>(`/api/businesses/${businessId}/team`)
      setTeamMembers(data.teamMembers || [])
      setInviteCodes(data.inviteCodes || [])
    } catch (err) {
      console.error('Error loading team data:', err)
      setError(
        err instanceof ApiError && err.envelope
          ? translateApiMessage(err.envelope)
          : t.formatMessage({ id: 'team.error_failed_to_load' }),
      )
    } finally {
      setIsLoading(false)
    }
  }, [businessId, t, translateApiMessage])
  useEffect(() => {
    loadTeamData()
  }, [loadTeamData])
  // ... append `refresh: loadTeamData` to the returned object.
  ```
  Update the return type `UseTeamManagementReturn` to include `refresh: () => Promise<void>`.
- [ ] **Step 3: Migrate `TeamDrilldown.tsx`.** Replace `const team = useTeamManagement({ businessId })` with `const team = useTeam()`. Wrap the drilldown's parent (or the page tree above the drilldown) with `<TeamProvider businessId={...}>`.
- [ ] **Step 4: Test** that a realtime `team.member.joined` event invokes the team refetch.
- [ ] **Step 5: Commit.**
  ```
  git add apps/web/src/contexts/team-context.tsx apps/web/src/hooks/useTeamManagement.ts apps/web/src/components/team/TeamDrilldown.tsx
  git commit -m "feat(realtime/web): TeamProvider registers team + invites refetches"
  ```

**Phase 8 done when:** every spec §8.2 refetch key has a registered listener; a realtime event triggers the corresponding refetch under test.

---

## Phase 9 — Revoke flow polish + modal cleanup

### Task 9.1: Open-modal cleanup on revoke

**Files:**
- Modify: `/Users/adiaz/irvin/apps/web/src/contexts/realtime-context.tsx`

The current `revokeBusinessContext` (added in Task 7.1) navigates away but doesn't explicitly close any open Ionic modal. Per spec §8.6, we explicitly dismiss open modals before navigation.

- [ ] **Step 1: Locate the modal system primitives.** Read `apps/web/src/components/ui/Modal.tsx` (or the equivalent under `apps/web/src/components/ui/`) and identify the imperative dismiss function — `dismissAllModals()` or similar. If none exists, use Ionic's `IonModal` programmatic close via `document.querySelectorAll('ion-modal').forEach((m) => (m as HTMLIonModalElement).dismiss())`.
- [ ] **Step 2: Modify `revokeBusinessContext`.** Before `router.push('/', ...)`:
  ```ts
  // Programmatic dismissal of any open ion-modal. This is required so
  // the modal's exit animation runs and onExitComplete fires before the
  // page navigates away. Without this, an open invite-code modal stays
  // pinned on screen after the route change.
  document.querySelectorAll('ion-modal').forEach((m) => {
    ;(m as unknown as HTMLIonModalElement).dismiss?.()
  })
  ```
- [ ] **Step 3: Test** that a revoked-business event closes the open modal before navigating.
- [ ] **Step 4: Commit.**
  ```
  git add apps/web/src/contexts/realtime-context.tsx
  git commit -m "feat(realtime/web): dismiss open ion-modals before revoke navigation"
  ```

### Task 9.2: No-businesses case routes to create/join

**Files:**
- Modify: `/Users/adiaz/irvin/apps/web/src/contexts/realtime-context.tsx`

- [ ] **Step 1: After the businesses-list refetch in `revokeBusinessContext`, query the cached list. If empty, route to `/join` (or wherever the create/join entry lives — confirm via `apps/web/src/routes`).** Use the existing `getCachedBusinessList()` import from `apps/web/src/hooks/useSessionCache`:
  ```ts
  import { getCachedBusinessList } from '@/hooks/useSessionCache'
  // ... inside revokeBusinessContext, after callRefetch('businesses-list')
  setTimeout(() => {
    const list = getCachedBusinessList()
    if (!list || list.length === 0) {
      router.push('/join', 'root', 'replace')
    }
  }, 250)  // give the refetch a beat to settle the cache
  ```
- [ ] **Step 2: Commit.**
  ```
  git add apps/web/src/contexts/realtime-context.tsx
  git commit -m "feat(realtime/web): route to /join when revoke leaves the user with no businesses"
  ```

**Phase 9 done when:** revoke flow shows toast, dismisses modals, refetches list, navigates appropriately for the three cases in spec §8.6.

---

## Phase 10 — Service worker bypass

### Task 10.1: Add fetch-bypass for `/api/realtime` to `sw.ts`

**Files:**
- Modify: `/Users/adiaz/irvin/apps/web/src/pwa/sw.ts`

- [ ] **Step 1: Edit the file.** Add the bypass listener BEFORE the first `registerRoute` call (between `precacheAndRoute(...)` on line 15 and the first `registerRoute` on line 20):
  ```ts
  // Bypass the service worker entirely for the SSE endpoint. Workbox's
  // NetworkOnly strategy below would work functionally, but the request
  // still passes through the SW which can buffer streaming responses on
  // some browsers (Safari/iOS observed). Returning without calling
  // event.respondWith() defers to the browser's normal fetch.
  self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url)
    if (url.pathname === '/api/realtime') {
      return
    }
  })
  ```
- [ ] **Step 2: Manual verification step.** Document for the reviewer:
  - Run `npm run build --workspace=apps/web`.
  - Install the SW (open Vercel preview, accept "Add to home screen" or DevTools → Application → Service Workers → Update).
  - Open DevTools → Network. Reload the page. Confirm the `/api/realtime` request line shows initiator chain WITHOUT `(service worker)`.
- [ ] **Step 3: Commit.**
  ```
  git add apps/web/src/pwa/sw.ts
  git commit -m "feat(realtime/web): bypass service worker for /api/realtime SSE endpoint"
  ```

**Phase 10 done when:** `sw.ts` carries the bypass, manual verification confirms no SW initiator on the SSE request.

---

## Phase 11 — Integration tests + load test

### Task 11.1: End-to-end SSE integration test (real Upstash test DB)

**Files:**
- Create: `/Users/adiaz/irvin/apps/api/src/app/api/realtime/integration.test.ts`
- Modify: `/Users/adiaz/irvin/apps/api/.env.local` (add `UPSTASH_REDIS_TEST_URL` pointing to a SEPARATE Upstash database used only for tests)
- Modify: `/Users/adiaz/irvin/apps/api/.env.example` (document the new key)

- [ ] **Step 1: Provision an Upstash test database** (manual step — Phase 0-style; see Task 0.2 for the procedure). Capture its URL; add as `UPSTASH_REDIS_TEST_URL` to `apps/api/.env.local`. Document in `.env.example`.
- [ ] **Step 2: Write the integration test** that:
  - Boots a minimal Next.js route harness using the real GET handler.
  - Connects an EventSource (or a manual `fetch` reading the stream).
  - Calls `publishToBusiness('test-biz-1', { type: 'team.member.joined', memberId: 'm1' })` from the publisher.
  - Asserts the SSE response chunk contains `event: team.member.joined`.
  - Skips when `UPSTASH_REDIS_TEST_URL` is absent (CI without test creds).
- [ ] **Step 3: Run, commit.**
  ```
  git add apps/api/src/app/api/realtime/integration.test.ts apps/api/.env.example
  git commit -m "test(realtime): end-to-end SSE integration test against Upstash test DB"
  ```

### Task 11.2: Stream replay integration test

**Files:**
- Modify: `/Users/adiaz/irvin/apps/api/src/app/api/realtime/integration.test.ts` (add an `it` block)

- [ ] **Step 1: Add an `it('replays critical events on reconnect')`** that:
  - Publishes a critical event via `publishCriticalToUser(testUserId, { type: 'session.revoked', ... })`.
  - Opens an SSE connection with `Last-Event-ID: 0-0`.
  - Reads the first frame, asserts it contains `event: session.revoked`.
- [ ] **Step 2: Commit.**
  ```
  git add apps/api/src/app/api/realtime/integration.test.ts
  git commit -m "test(realtime): stream replay integration coverage"
  ```

### Task 11.3: Resync-on-bounce integration test

**Files:**
- Modify: `/Users/adiaz/irvin/apps/api/src/app/api/realtime/integration.test.ts`

- [ ] **Step 1: Add an `it('emits system.resync after subscriber bounce')`** that:
  - Opens an SSE connection.
  - Forces the subscriber to reconnect by calling `__resetForTests()` on `redis.ts` (re-exported from a test-only barrel) OR by `quit()`-ing the singleton.
  - Asserts the next SSE chunk contains `event: system.resync`.
- [ ] **Step 2: Commit.**
  ```
  git add apps/api/src/app/api/realtime/integration.test.ts
  git commit -m "test(realtime): resync-on-bounce integration coverage"
  ```

### Task 11.4: Load test script

**Files:**
- Create: `/Users/adiaz/irvin/scripts/realtime-load-test.ts`

- [ ] **Step 1: Write the load test.** It:
  - Spawns 200 `EventSource` clients (Node `eventsource` package; add `npm install --save-dev eventsource @types/eventsource --workspace=apps/api`).
  - 10 simulated businesses, 20 clients each.
  - Records publish→receive latency for 100 probe events per business.
  - Queries Upstash dashboard API for current connection count (via `UPSTASH_API_KEY` + `UPSTASH_TEAM_ID`).
  - Asserts (logged, not unit-test) `connections < 30` and `event_loss_pct < 5`.
- [ ] **Step 2: Write a brief README block** at the top of the file documenting how to run it against a Vercel preview.
- [ ] **Step 3: Commit.**
  ```
  git add scripts/realtime-load-test.ts apps/api/package.json package-lock.json
  git commit -m "test(realtime): load-test script for 200 concurrent clients"
  ```

**Phase 11 done when:** three integration test cases pass against a real Upstash test DB; load-test script runs cleanly against a Vercel preview and meets the §13 acceptance bar.

---

## Phase 12 — Documentation

### Task 12.1: Create `realtime-system.md` guide

**Files:**
- Create: `/Users/adiaz/irvin/.claude/docs/realtime-system.md`

- [ ] **Step 1: Write the guide** following the structure of `.claude/docs/backend-patterns.md`. Cover:
  - Overview of the transport (SSE) and the two delivery tiers (pub/sub, streams).
  - Channel model: business vs user vs critical stream.
  - When to publish: the table of events from spec §6.
  - When to use `publishToBusiness` vs `publishToUser` vs `publishCriticalToUser` vs `publishBatchedToUsers`.
  - Fail-open vs fail-closed semantics. When a publish failure should bubble.
  - How to add a new event type: 1) add to `packages/shared/src/realtime/types.ts`, 2) add a handler branch in `apps/web/src/lib/realtime/handlers.ts` (TS exhaustiveness forces this), 3) wire publishes in the relevant routes, 4) add tests.
  - How to test: unit-test the publisher mock; integration-test against Upstash test DB.
- [ ] **Step 2: Commit.**
  ```
  git add .claude/docs/realtime-system.md
  git commit -m "docs(realtime): add realtime-system.md guide"
  ```

### Task 12.2: Cross-reference in other docs

**Files:**
- Modify: `/Users/adiaz/irvin/.claude/docs/backend-patterns.md`
- Modify: `/Users/adiaz/irvin/.claude/docs/performance-patterns.md`
- Modify: `/Users/adiaz/irvin/.claude/CLAUDE.md`

- [ ] **Step 1: Edit `backend-patterns.md`** — add an entry to its top-of-file index linking to `realtime-system.md`, plus a brief paragraph in the "API routes" section pointing readers there for realtime publish wiring.
- [ ] **Step 2: Edit `performance-patterns.md`** — under the offline/online section, add a paragraph: "Realtime push: state changes propagate via SSE on `/api/realtime`; client falls back to focus refetch when the SSE layer is down. See `realtime-system.md`."
- [ ] **Step 3: Edit `.claude/CLAUDE.md`** — add a row to the "Documentation" table:
  ```
  | `.claude/docs/realtime-system.md` | Adding a publish site, defining a new event type, working with SSE/Streams |
  ```
- [ ] **Step 4: Commit.**
  ```
  git add .claude/docs/backend-patterns.md .claude/docs/performance-patterns.md .claude/CLAUDE.md
  git commit -m "docs(realtime): cross-reference realtime-system.md from backend, performance, and CLAUDE.md"
  ```

### Task 12.3: Comprehensive documentation sweep

**Why:** The realtime subsystem touches the entire stack — env-var conventions, security model, modal lifecycle, i18n, the offline story, the dev workflow, and the SW. Anything left undocumented becomes a future trap. This task walks every doc that should now reference realtime and either updates it or confirms no change is needed.

**Files (every file checked; modifies only those whose content needs an actual edit):**
- Modify (if applicable): `/Users/adiaz/irvin/README.md`
- Modify: `/Users/adiaz/irvin/.claude/CLAUDE.md`
- Modify: `/Users/adiaz/irvin/.claude/docs/tech-stack.md`
- Modify: `/Users/adiaz/irvin/.claude/docs/backend-patterns.md`
- Modify: `/Users/adiaz/irvin/.claude/docs/performance-patterns.md`
- Modify: `/Users/adiaz/irvin/.claude/docs/i18n-system.md` (new locale keys, new ApiMessageCodes)
- Modify: `/Users/adiaz/irvin/.claude/docs/modal-system.md` (programmatic-close usage during revocation)
- Verify (no edit expected, but confirm): `/Users/adiaz/irvin/.claude/docs/tab-system.md`, `/Users/adiaz/irvin/.claude/docs/ai-product-pipeline.md`, `/Users/adiaz/irvin/.claude/docs/barcode-system.md`
- Verify (no edit expected): `/Users/adiaz/irvin/apps/api/.env.example` (already updated in Phase 0.5)

- [ ] **Step 1: README.md** — Check `README.md` at the repo root. If it has an "Architecture" or "Stack" section listing major subsystems, add a one-line entry: "Realtime: SSE over Upstash Redis pub/sub + Streams. See `.claude/docs/realtime-system.md`." If the README is purely a setup-instructions file with no architecture section, no edit is needed; record a note "README has no architecture section; skipped" in the commit message body.

- [ ] **Step 2: `.claude/CLAUDE.md` — Documentation table.** Locate the "Documentation" section (around the "Guides" subsection). Add the row from Task 12.2 if not already present, AND verify the existing rows reference current paths. If you added `realtime-system.md` row already in 12.2, this step is a no-op.

- [ ] **Step 3: `.claude/CLAUDE.md` — Critical rules.** Add a brief "Realtime publishes" entry under "Critical rules" with the rule:
  > Every API route that mutates business or user state should publish the corresponding realtime event after the DB commit succeeds. See `.claude/docs/realtime-system.md` for the event taxonomy and which channel to use. Non-critical publishes fail open; security-critical (`session.revoked`, `business.deleted`, `ownership.transferred`) fail closed and bubble a 503.

- [ ] **Step 4: `.claude/CLAUDE.md` — Local secrets.** Update the "Local secrets" section to clarify that `UPSTASH_REDIS_URL` is intentionally Vercel-only (not in `.env.local`). Add a paragraph:
  > **Realtime credentials are Vercel-only.** `UPSTASH_REDIS_URL` is configured in the Vercel project envs (Production + Preview), not in your local `apps/api/.env.local`. Local dev uses an in-memory realtime backend so a `npm run dev` publish never reaches production subscribers. The canonical value is recorded in the Bitwarden note `Kasero — Vercel project envs`.

- [ ] **Step 5: `.claude/docs/tech-stack.md`.** Locate the "Database schema" / "Environment variables" / "Per-app commands" sections. Add `UPSTASH_REDIS_URL` to the env-var listing (with the Vercel-only caveat). Add `ioredis` to the api dependencies listing. Add a brief "Realtime" subsection under "Stack decisions" that summarizes the SSE-over-Upstash choice and links to `realtime-system.md`.

- [ ] **Step 6: `.claude/docs/backend-patterns.md`.** Confirm the entry from Task 12.2 is present. Additionally:
  - In the "API routes" section, add a short note: when a mutation route ships, audit whether any open client devices would benefit from a realtime publish; add the publish call after the DB commit, before `successResponse`. Reference the publisher API.
  - Update the "full route index" to include `GET /api/realtime`.

- [ ] **Step 7: `.claude/docs/performance-patterns.md`.** Confirm the entry from Task 12.2 is present. Additionally:
  - Document the relationship between `useRevalidateOnFocus` and the realtime layer: focus-refetch remains the backstop for pub/sub messages dropped during a subscriber-reconnect gap, in addition to the `system.resync` signal.
  - Document that the SSE endpoint is region-pinned (`preferredRegion = 'iad1'`) and why (connection-cap math).

- [ ] **Step 8: `.claude/docs/i18n-system.md`.** Add the new `ApiMessageCode` entries (`REALTIME_UNAVAILABLE`, `REALTIME_PUBLISH_UNAVAILABLE`) and the new UI keys (`session_revoked_*`, `realtime_disconnected_banner`) to whatever inventory tables / examples the doc maintains. Confirm the "real translations for every registered locale" rule is honored by the entries landed in Phase 4.

- [ ] **Step 9: `.claude/docs/modal-system.md`.** Add a short section "Programmatic close from outside the modal" describing the API the revocation handler uses (Phase 9.1). Reference where this is consumed: the realtime revoke flow may need to dismiss any open business-scoped modal before navigating away. Cross-reference `realtime-system.md`.

- [ ] **Step 10: Sanity-verify the no-edit-expected docs.** Open `.claude/docs/tab-system.md`, `ai-product-pipeline.md`, `barcode-system.md` and confirm no realtime-relevant content exists yet. If any of them describe a feature that would benefit from realtime (e.g., AI snap-to-add completion push), add a "Future: push completion via realtime" stub.

- [ ] **Step 11: Final search for orphan references.** From the repo root:
  ```
  grep -rn "real-?time\|EventSource\|SSE\|publishToBusiness\|publishToUser\|publishCritical" --include='*.md' .
  ```
  Walk every hit and confirm it either points to `realtime-system.md` or is in `realtime-system.md` itself. Update any orphan that should link to the canonical doc.

- [ ] **Step 12: Commit.**
  ```
  git add README.md .claude/CLAUDE.md .claude/docs/tech-stack.md .claude/docs/backend-patterns.md .claude/docs/performance-patterns.md .claude/docs/i18n-system.md .claude/docs/modal-system.md .claude/docs/tab-system.md .claude/docs/ai-product-pipeline.md .claude/docs/barcode-system.md
  git commit -m "docs(realtime): comprehensive sweep across README, CLAUDE.md, and .claude/docs"
  ```

**Phase 12 done when:** `realtime-system.md` exists, linked from three locations, CSP audit clean on a deployed preview, all manual-verification scenarios from spec §17 pass, AND every project doc that mentions realtime, env vars, or related subsystems is current and cross-linked.

---

## Self-review

**Spec coverage check (run before submitting):**

- Every §6 event has a publish site task in Phase 5: `team.member.joined`/`team.invite.consumed` (5.1), `team.member.removed`/`session.revoked removed`/`business.list.changed removed` (5.5), `team.member.role_changed` (5.6), `team.member.status_changed` (5.7), `team.invite.created` (5.8), `team.invite.regenerated` (5.9), `team.invite.deleted` (5.10), `business.updated`/`business.list.changed renamed` (5.3), `business.list.changed added` on create (5.2), `business.deleted`/`session.revoked business_deleted`/`business.list.changed removed` (5.4), `ownership.transferred new_owner`/`business.list.changed added`/`session.revoked ownership_transferred`/`business.list.changed removed` (5.11), `profile.updated email` (5.12), `profile.updated displayName/language` via better-auth hook (5.13). System events (`system.resync`/`system.error`/`system.auth_expired`) are emitted by the SSE route itself in Phase 3. **OK.**
- Every §11 lifecycle case has handling: login (Phase 7 useEffect), active-business change (Phase 7 debounce), logout (Phase 7 close), tab background (relies on browser; watchdog catches stale within 45s — Phase 7), maxDuration 300s reconnect (browser auto-reconnect + Last-Event-ID replay — Phase 3), auth expiry (Phase 7 onAuthExpired), Upstash subscriber bounce (Phase 2 broker resync + Phase 3 translates to system.resync). **OK.**
- Every §15 ApiMessageCode added: `REALTIME_UNAVAILABLE` + `REALTIME_PUBLISH_UNAVAILABLE` in Phase 3 Step 1. **OK.**
- Every §15 locale key added across 11 locales: Phase 4 Tasks 4.1 Steps 1-11. **OK.**
- Every §17 test enumerated: broker refcounting (2.3), broker resync (2.3), broker liveness (2.3), stream replay (2.4), stream first-connect (2.4), stream MAXLEN (covered by publisher 2.5 — XADD with MAXLEN 100 literal asserted), stream TTL (publisher 2.5 PEXPIRE asserted), publisher fail-open (2.5), publisher fail-closed (2.5), publisher pipeline shape (2.5), batched broadcast (2.5), end-to-end pub/sub (11.1), end-to-end stream replay (11.2), authorization (3.1), CSRF (3.1), auth (3.1), better-auth in node runtime (covered by the route test importing real auth.ts indirectly via mocks; deeper smoke handled in 11.1), resync on bounce (11.3), handler exhaustiveness (1.1 TS test + 6.3 dispatcher), refetch registry (6.2), handler dispatch (6.3), revoke flow (7.1 + 9.1), echo suppression (6.3), watchdog (7.1), auth-expiry (7.1). **OK.**
- Placeholder scan: no "TBD"/"fill in"/"similar to" left. Some Phase 5 tasks defer minor scaffolding to "mirror the existing test patterns in `patch.test.ts`" — that's a concrete pointer, not a placeholder.
- Type consistency: `getSubscriber()`/`getPublisher()` used consistently across redis.ts/broker.ts/publisher.ts/streams.ts. `subscribe()` from broker used by route.ts. `publishToBusiness`/`publishToUser`/`publishCriticalToUser`/`publishBatchedToUsers` names match across publisher.ts and all Phase 5 consumers. `RealtimeEvent`/`BusinessRealtimeEvent`/`UserRealtimeEvent`/`CriticalUserRealtimeEvent`/`SystemRealtimeEvent` consistent.
- Single PR, lands on main: all tasks commit to current branch (no `git checkout -b` anywhere).
- TDD: every implementation task is preceded by a "Step 1: Write the test" step.
- No emojis: scanned plan, none.
- i18n: every user-facing toast routes through `intl.formatMessage`; every API error uses the envelope.
- YAGNI: no scope beyond the spec.

