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
