import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the unified RealtimePublisher surface. publisher.ts MUST go
// through these methods — pre-fix it cast to `any` and called
// .multi()/.pipeline() on the wrapper, which doesn't expose those
// methods at all in prod, producing TypeErrors.
const publishMock = vi.fn()
const publishCriticalMock = vi.fn()
const publishBatchedMock = vi.fn()

vi.mock('./redis', () => ({
  getPublisher: () => ({
    publish: publishMock,
    publishCritical: publishCriticalMock,
    publishBatched: publishBatchedMock,
  }),
}))

beforeEach(() => {
  publishMock.mockReset()
  publishCriticalMock.mockReset()
  publishBatchedMock.mockReset()
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

  it('publishCriticalToUser delegates to wrapper.publishCritical with correct args', async () => {
    publishCriticalMock.mockResolvedValueOnce(undefined)
    const { publishCriticalToUser } = await import('./publisher')
    await publishCriticalToUser(
      'u1',
      { type: 'session.revoked', businessId: 'b1', reason: 'removed' },
      'dev-1',
    )
    expect(publishCriticalMock).toHaveBeenCalledTimes(1)
    const [channel, stream, maxLen, ttlMs, payload] = publishCriticalMock.mock.calls[0]
    expect(channel).toBe('user:u1')
    expect(stream).toBe('stream:user:u1')
    expect(maxLen).toBe(100)
    expect(ttlMs).toBe(90 * 24 * 60 * 60 * 1000)
    expect(payload).toEqual({
      type: 'session.revoked',
      businessId: 'b1',
      reason: 'removed',
      originDeviceId: 'dev-1',
    })
  })

  it('publishCriticalToUser throws RealtimeUnavailableError on wrapper failure', async () => {
    publishCriticalMock.mockRejectedValueOnce(new Error('upstash down'))
    const { publishCriticalToUser } = await import('./publisher')
    await expect(
      publishCriticalToUser('u1', {
        type: 'session.revoked',
        businessId: 'b1',
        reason: 'removed',
      }),
    ).rejects.toThrow(/realtime unavailable/i)
  })

  it('publishBatchedToUsers delegates to wrapper.publishBatched with channel/message pairs', async () => {
    publishBatchedMock.mockResolvedValueOnce(undefined)
    const { publishBatchedToUsers } = await import('./publisher')
    await publishBatchedToUsers(
      ['u1', 'u2', 'u3'],
      { type: 'business.list.changed', reason: 'renamed' },
      'dev-1',
    )
    expect(publishBatchedMock).toHaveBeenCalledTimes(1)
    const [messages] = publishBatchedMock.mock.calls[0]
    expect((messages as Array<[string, string]>).map((m) => m[0])).toEqual([
      'user:u1',
      'user:u2',
      'user:u3',
    ])
    // Each message body carries the event + originDeviceId, identical
    // across recipients in a batched broadcast.
    const firstBody = JSON.parse((messages as Array<[string, string]>)[0][1])
    expect(firstBody).toEqual({
      type: 'business.list.changed',
      reason: 'renamed',
      originDeviceId: 'dev-1',
    })
  })

  it('publishBatchedToUsers no-ops with empty userIds', async () => {
    const { publishBatchedToUsers } = await import('./publisher')
    await publishBatchedToUsers([], { type: 'business.list.changed', reason: 'removed' })
    expect(publishBatchedMock).not.toHaveBeenCalled()
  })

  it('publishBatchedToUsers fails open on wrapper rejection', async () => {
    publishBatchedMock.mockRejectedValueOnce(new Error('upstash down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { publishBatchedToUsers } = await import('./publisher')
    await expect(
      publishBatchedToUsers(['u1'], { type: 'business.list.changed', reason: 'removed' }),
    ).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
