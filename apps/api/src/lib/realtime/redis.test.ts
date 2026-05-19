import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Ioredis constructor mock — used only by the production-branch tests.
const constructed: Array<{ url: string; opts: unknown }> = []
vi.mock('ioredis', () => {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    default: vi.fn().mockImplementation(function(this: any, url: string, opts: unknown) {
      const inst = {
        url,
        opts,
        on: vi.fn(),
        quit: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn().mockResolvedValue(undefined),
        unsubscribe: vi.fn().mockResolvedValue(undefined),
        publish: vi.fn().mockResolvedValue(1),
        xadd: vi.fn().mockResolvedValue('1-0'),
        xread: vi.fn().mockResolvedValue(null),
        xrevrange: vi.fn().mockResolvedValue([]),
        multi: vi.fn().mockReturnValue({
          xadd: vi.fn().mockReturnThis(),
          pexpire: vi.fn().mockReturnThis(),
          publish: vi.fn().mockReturnThis(),
          exec: vi.fn().mockResolvedValue([]),
        }),
        pexpire: vi.fn().mockResolvedValue(1),
        ping: vi.fn().mockResolvedValue('PONG'),
        status: 'ready',
      }
      constructed.push({ url, opts })
      return inst
    }),
  }
})

beforeEach(() => {
  constructed.length = 0
  delete process.env.UPSTASH_REDIS_URL
  delete process.env.VERCEL_ENV
  delete process.env.NEXT_PHASE
})

afterEach(() => {
  vi.resetModules()
})

describe('redis.ts (backend factory)', () => {
  it('does NOT construct any backend at module import time', async () => {
    await import('./redis')
    expect(constructed).toEqual([])
  })

  describe('with UPSTASH_REDIS_URL set (production-style)', () => {
    it('constructs the ioredis subscriber on first getSubscriber() call only', async () => {
      process.env.UPSTASH_REDIS_URL = 'rediss://test:pw@host:1'
      const mod = await import('./redis')
      mod.getSubscriber()
      mod.getSubscriber()
      expect(constructed).toHaveLength(1)
    })

    it('constructs publisher and subscriber as separate ioredis connections', async () => {
      process.env.UPSTASH_REDIS_URL = 'rediss://test:pw@host:1'
      const mod = await import('./redis')
      mod.getSubscriber()
      mod.getPublisher()
      expect(constructed).toHaveLength(2)
    })

    it('exposes the unified interface (subscribe/publish/xaddMaxLen/etc.) on the wrapper', async () => {
      process.env.UPSTASH_REDIS_URL = 'rediss://test:pw@host:1'
      const mod = await import('./redis')
      const sub = mod.getSubscriber()
      const pub = mod.getPublisher()
      expect(typeof sub.subscribe).toBe('function')
      expect(typeof sub.unsubscribe).toBe('function')
      expect(typeof sub.xread).toBe('function')
      expect(typeof sub.getStreamTipId).toBe('function')
      expect(typeof sub.ping).toBe('function')
      expect(typeof pub.publish).toBe('function')
      expect(typeof pub.xaddMaxLen).toBe('function')
      expect(typeof pub.pexpire).toBe('function')
      expect(typeof pub.publishCritical).toBe('function')
    })
  })

  describe('without UPSTASH_REDIS_URL (dev/local)', () => {
    it('returns the in-memory backend in dev — no ioredis construction', async () => {
      // No VERCEL_ENV set => dev. No URL => use in-memory backend.
      const mod = await import('./redis')
      const sub = mod.getSubscriber()
      const pub = mod.getPublisher()
      expect(constructed).toEqual([])
      // Round-trip: publish from publisher reaches subscriber.
      const received: string[] = []
      sub.on('message', (_, m) => received.push(m))
      await sub.subscribe('c')
      await pub.publish('c', 'X')
      expect(received).toEqual(['X'])
    })

    it('publisher and subscriber in dev share the SAME in-memory backend instance', async () => {
      // Two separate getSubscriber/getPublisher calls still talk to one
      // backend — required for round-trip delivery to work.
      const mod = await import('./redis')
      const subA = mod.getSubscriber()
      const subB = mod.getSubscriber() // same singleton
      expect(subA).toBe(subB)
      const pub = mod.getPublisher()
      const received: string[] = []
      subA.on('message', (_, m) => received.push(m))
      await subA.subscribe('shared')
      await pub.publish('shared', 'Y')
      expect(received).toEqual(['Y'])
    })

    it('throws RealtimeUnavailableError when called in prod without UPSTASH_REDIS_URL', async () => {
      process.env.VERCEL_ENV = 'production'
      const mod = await import('./redis')
      expect(() => mod.getSubscriber()).toThrow(/realtime unavailable/i)
      expect(() => mod.getPublisher()).toThrow(/realtime unavailable/i)
    })

    it('still throws during Next.js build phase (Vercel build sets VERCEL_ENV=production)', async () => {
      process.env.VERCEL_ENV = 'production'
      process.env.NEXT_PHASE = 'phase-production-build'
      const mod = await import('./redis')
      // We assert the throw shape so the SSE route's 503 mapping fires.
      // Build-time crashes are avoided by NOT calling the getters at
      // module-evaluation time (lazy construction is the safeguard).
      expect(() => mod.getSubscriber()).toThrow(/realtime unavailable/i)
    })
  })
})
