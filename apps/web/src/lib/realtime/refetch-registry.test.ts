import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('refetch registry', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('registers two fns under same key, callRefetch invokes both', async () => {
    const { registerRefetch, callRefetch } = await import('./refetch-registry')
    const fn1 = vi.fn(async () => {})
    const fn2 = vi.fn(async () => {})
    registerRefetch('team', fn1)
    registerRefetch('team', fn2)
    callRefetch('team')
    await vi.runAllTimersAsync()
    expect(fn1).toHaveBeenCalledTimes(1)
    expect(fn2).toHaveBeenCalledTimes(1)
  })

  it('two rapid callRefetch within 100ms -> fns invoked once (leading-edge debounce)', async () => {
    const { registerRefetch, callRefetch } = await import('./refetch-registry')
    const fn = vi.fn(async () => {})
    registerRefetch('business', fn)
    callRefetch('business')
    callRefetch('business')
    await vi.runAllTimersAsync()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('two callRefetch with 150ms gap -> fns invoked twice', async () => {
    const { registerRefetch, callRefetch } = await import('./refetch-registry')
    const fn = vi.fn(async () => {})
    registerRefetch('invites', fn)
    callRefetch('invites')
    await vi.advanceTimersByTimeAsync(150)
    callRefetch('invites')
    await vi.runAllTimersAsync()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('unregistered fn is not invoked by callRefetch', async () => {
    const { registerRefetch, callRefetch } = await import('./refetch-registry')
    const fn = vi.fn(async () => {})
    const unregister = registerRefetch('profile', fn)
    unregister()
    callRefetch('profile')
    await vi.runAllTimersAsync()
    expect(fn).not.toHaveBeenCalled()
  })

  it('callAllRefetches invokes fns across keys', async () => {
    const { registerRefetch, callAllRefetches } = await import('./refetch-registry')
    const fnTeam = vi.fn(async () => {})
    const fnProfile = vi.fn(async () => {})
    registerRefetch('team', fnTeam)
    registerRefetch('profile', fnProfile)
    callAllRefetches()
    await vi.runAllTimersAsync()
    expect(fnTeam).toHaveBeenCalledTimes(1)
    expect(fnProfile).toHaveBeenCalledTimes(1)
  })
})
