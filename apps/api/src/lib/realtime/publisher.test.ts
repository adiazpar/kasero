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
