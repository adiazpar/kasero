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
      'Realtime unavailable: UPSTASH_REDIS_URL is not set. Add it to the '
        + 'Vercel project envs (Production + Preview). Local dev '
        + 'intentionally has no value and uses the in-memory backend.',
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
    on(event: string, listener: (...args: any[]) => void) {
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
