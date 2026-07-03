import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Unit tests for POST /api/realtime/ticket.
 *
 * The route is a thin `withAuth` wrapper that mints a single-use SSE
 * connect ticket. Following the established pattern (see
 * /api/account/delete/route.test.ts), we mock the auth + store boundary
 * and let the real api-middleware run so the auth + CSRF + rate-limit
 * path is exercised end-to-end.
 */

const getSession = vi.fn()
const mintSseTicket = vi.fn()

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: (...args: unknown[]) => getSession(...args) } },
}))

vi.mock('@/lib/native-token-store', () => ({
  mintSseTicket: (...args: unknown[]) => mintSseTicket(...args),
}))

beforeEach(() => {
  getSession.mockReset()
  mintSseTicket.mockReset()
})

function makeReq(): NextRequest {
  return new NextRequest('https://kasero.app/api/realtime/ticket', {
    method: 'POST',
    body: '{}',
    headers: new Headers({
      'content-type': 'application/json',
      'content-length': '2',
      origin: 'https://kasero.app',
      host: 'kasero.app',
    }),
  })
}

describe('POST /api/realtime/ticket', () => {
  it('returns 401 when there is no session', async () => {
    getSession.mockResolvedValueOnce(null)
    const { POST } = await import('./route')
    const res = await POST(makeReq())
    expect(res.status).toBe(401)
    expect(mintSseTicket).not.toHaveBeenCalled()
  })

  it('mints a ticket bound to the authenticated user', async () => {
    getSession.mockResolvedValueOnce({
      user: { id: 'u1', email: 'a@b.co', emailVerified: true, name: 'A' },
    })
    mintSseTicket.mockResolvedValueOnce('ticket-abc')
    const { POST } = await import('./route')
    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(mintSseTicket).toHaveBeenCalledWith('u1')
    const body = await res.json()
    expect(body.ticket).toBe('ticket-abc')
    expect(body.success).toBe(true)
  })

  it('rejects a cross-site (CSRF) origin before minting', async () => {
    getSession.mockResolvedValue({
      user: { id: 'u1', email: 'a@b.co', emailVerified: true, name: 'A' },
    })
    const { POST } = await import('./route')
    const req = new NextRequest('https://kasero.app/api/realtime/ticket', {
      method: 'POST',
      body: '{}',
      headers: new Headers({
        'content-type': 'application/json',
        'content-length': '2',
        origin: 'https://evil.example',
        host: 'kasero.app',
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
    expect(mintSseTicket).not.toHaveBeenCalled()
  })
})
