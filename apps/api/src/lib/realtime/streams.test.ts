import { describe, it, expect, vi, beforeEach } from 'vitest'

// streams.ts now uses getSubscriber() and the unified RealtimeSubscriber
// surface (`xread`, `getStreamTipId`) — both backends already expose
// these with high-level shapes. Pre-fix it called raw ioredis methods on
// the publisher wrapper, which doesn't expose them at all in prod.
const xread = vi.fn()
const getStreamTipId = vi.fn()

vi.mock('./redis', () => ({
  getSubscriber: () => ({ xread, getStreamTipId }),
}))

beforeEach(() => {
  xread.mockReset()
  getStreamTipId.mockReset()
})

describe('streams', () => {
  it('readUserStreamSince forwards entries from subscriber.xread', async () => {
    xread.mockResolvedValueOnce([
      {
        id: '1700000000-1',
        event: { type: 'session.revoked', businessId: 'b', reason: 'removed' },
      },
      {
        id: '1700000001-0',
        event: { type: 'business.deleted', businessId: 'b' },
      },
    ])
    const { readUserStreamSince } = await import('./streams')
    const events = await readUserStreamSince('U', '1699999999-0')
    expect(xread).toHaveBeenCalledWith('stream:user:U', '1699999999-0')
    expect(events).toHaveLength(2)
    expect(events[0].id).toBe('1700000000-1')
    expect(events[0].event.type).toBe('session.revoked')
  })

  it('readUserStreamSince returns [] when subscriber.xread returns []', async () => {
    xread.mockResolvedValueOnce([])
    const { readUserStreamSince } = await import('./streams')
    const events = await readUserStreamSince('U', '0-0')
    expect(events).toEqual([])
  })

  it('getUserStreamTip returns the id from subscriber.getStreamTipId', async () => {
    getStreamTipId.mockResolvedValueOnce('1700000005-0')
    const { getUserStreamTip } = await import('./streams')
    const tip = await getUserStreamTip('U')
    expect(getStreamTipId).toHaveBeenCalledWith('stream:user:U')
    expect(tip).toBe('1700000005-0')
  })

  it('getUserStreamTip returns "0-0" when the stream is empty (null tip)', async () => {
    getStreamTipId.mockResolvedValueOnce(null)
    const { getUserStreamTip } = await import('./streams')
    const tip = await getUserStreamTip('U')
    expect(tip).toBe('0-0')
  })
})
