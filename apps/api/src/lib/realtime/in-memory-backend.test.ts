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
