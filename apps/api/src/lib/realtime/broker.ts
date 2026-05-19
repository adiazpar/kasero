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
  seenEnd: boolean
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
      seenEnd: false,
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

  sub.on('ready', (..._args: unknown[]) => {
    if (state.seenEnd) {
      // Reconnect after disconnect: re-subscribe to every channel and
      // emit a synthetic resync payload to every listener.
      const channels = [...state.channelListeners.keys()]
      if (channels.length > 0) {
        // Re-subscribe channel by channel (interface only accepts one at a time).
        for (const ch of channels) {
          sub.subscribe(ch).catch((err) => {
            console.warn('[realtime.broker] resync subscribe failed', err)
          })
        }
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
      state.seenEnd = false
    }
  })

  sub.on('error', (...args: unknown[]) => {
    console.warn('[realtime.broker] subscriber error', ...args)
  })

  sub.on('end', (..._args: unknown[]) => {
    state.seenEnd = true
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
