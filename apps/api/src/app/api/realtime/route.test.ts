import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const getSession = vi.fn()
const requireBusinessAccessForRealtime = vi.fn()
const checkRateLimit = vi.fn()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const brokerSubscribe = vi.fn(() => () => {}) as any
const getUserStreamTip = vi.fn()
const readUserStreamSince = vi.fn()

vi.mock('@/lib/auth', () => ({ auth: { api: { getSession } } }))
vi.mock('@/lib/business-auth', () => ({ requireBusinessAccessForRealtime }))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit,
  getClientIp: () => '127.0.0.1',
  RateLimits: { userMutation: { limit: 30, windowSeconds: 60 } },
}))
vi.mock('@/lib/realtime', () => ({
  subscribe: brokerSubscribe,
  getUserStreamTip,
  readUserStreamSince,
}))

beforeEach(() => {
  getSession.mockReset()
  requireBusinessAccessForRealtime.mockReset()
  checkRateLimit.mockReset()
  brokerSubscribe.mockReset()
  getUserStreamTip.mockReset()
  readUserStreamSince.mockReset()
  brokerSubscribe.mockImplementation(() => () => {})
})

function makeReq(opts: { url?: string; headers?: Record<string, string> } = {}): NextRequest {
  const url = opts.url ?? 'https://kasero.app/api/realtime'
  return new NextRequest(url, {
    headers: new Headers({
      'sec-fetch-site': 'same-origin',
      'host': 'kasero.app',
      ...opts.headers,
    }),
  })
}

describe('GET /api/realtime', () => {
  it('returns 401 when no session', async () => {
    getSession.mockResolvedValueOnce(null)
    const { GET } = await import('./route')
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it('returns 403 when Sec-Fetch-Site is absent and Origin does not match host', async () => {
    getSession.mockResolvedValueOnce({ user: { id: 'u1', emailVerified: true } })
    const { GET } = await import('./route')
    const res = await GET(makeReq({
      headers: { 'sec-fetch-site': '', 'origin': 'https://evil.example' },
    }))
    expect(res.status).toBe(403)
  })

  it('returns 403 when businessId is provided and user is not a member', async () => {
    getSession.mockResolvedValueOnce({ user: { id: 'u1', emailVerified: true } })
    requireBusinessAccessForRealtime.mockResolvedValueOnce(false)
    const { GET } = await import('./route')
    const res = await GET(makeReq({ url: 'https://kasero.app/api/realtime?businessId=b1' }))
    expect(res.status).toBe(403)
  })

  it('returns 429 when rate limit exceeded', async () => {
    getSession.mockResolvedValueOnce({ user: { id: 'u1', emailVerified: true } })
    checkRateLimit.mockResolvedValueOnce({ success: false, remaining: 0, resetAt: Date.now() + 60_000 })
    const { GET } = await import('./route')
    const res = await GET(makeReq())
    expect(res.status).toBe(429)
  })

  it('first connect (no Last-Event-ID) emits one system.resync with id=tip', async () => {
    getSession.mockResolvedValueOnce({ user: { id: 'u1', emailVerified: true } })
    checkRateLimit.mockResolvedValueOnce({ success: true, remaining: 29, resetAt: 0 })
    getUserStreamTip.mockResolvedValueOnce('1700000000-0')
    const { GET } = await import('./route')
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const reader = res.body!.getReader()
    const { value } = await reader.read()
    const text = new TextDecoder().decode(value)
    expect(text).toContain('id: 1700000000-0')
    expect(text).toContain('event: system.resync')
    // Tear down so the stream's intervals don't keep the test alive.
    await reader.cancel()
  })

  it('reconnect (Last-Event-ID set) replays critical events', async () => {
    getSession.mockResolvedValueOnce({ user: { id: 'u1', emailVerified: true } })
    checkRateLimit.mockResolvedValueOnce({ success: true, remaining: 29, resetAt: 0 })
    readUserStreamSince.mockResolvedValueOnce([
      {
        id: '1700000001-0',
        event: { type: 'session.revoked', businessId: 'b1', reason: 'removed' },
      },
    ])
    const { GET } = await import('./route')
    const res = await GET(makeReq({ headers: { 'last-event-id': '1700000000-0' } }))
    const reader = res.body!.getReader()
    const { value } = await reader.read()
    const text = new TextDecoder().decode(value)
    expect(text).toContain('id: 1700000001-0')
    expect(text).toContain('event: session.revoked')
    await reader.cancel()
  })

  it('subscriber __resync__ event is translated to system.resync SSE frame', async () => {
    getSession.mockResolvedValueOnce({ user: { id: 'u1', emailVerified: true } })
    checkRateLimit.mockResolvedValueOnce({ success: true, remaining: 29, resetAt: 0 })
    getUserStreamTip.mockResolvedValueOnce('0-0')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const captured: { userListener: ((p: any) => void) | null } = { userListener: null }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    brokerSubscribe.mockImplementation((channel: any, l: any) => {
      if (channel === 'user:u1') captured.userListener = l
      return () => {}
    })
    const { GET } = await import('./route')
    const res = await GET(makeReq())
    const reader = res.body!.getReader()
    // Read the initial resync.
    await reader.read()
    captured.userListener?.({ __resync__: true })
    const { value } = await reader.read()
    const text = new TextDecoder().decode(value)
    expect(text).toContain('event: system.resync')
    await reader.cancel()
  })
})
