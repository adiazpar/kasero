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
