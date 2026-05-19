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
      on(event: string, listener: (...args: any[]) => void) {
        // Internal impl uses any[] for listener so the overloaded
        // InMemorySubscriber.on signature stays satisfiable. Public
        // callers see the strict-typed overload via the interface.
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
