import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Unit tests for GET /api/native/auth-callback (native OAuth mint).
 *
 * Covers the PKCE hardening (FINDING 1):
 *   - missing / malformed challenge      -> 400 (no mint)
 *   - valid challenge, no session        -> deep-link redirect ?error=unauthorized
 *   - valid challenge + session          -> deep-link redirect ?ott=... AND
 *                                           the challenge is bound to the ott
 */

const getSession = vi.fn()
const generateOneTimeToken = vi.fn()
const storePkceChallenge = vi.fn()

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => getSession(...args),
      generateOneTimeToken: (...args: unknown[]) => generateOneTimeToken(...args),
    },
  },
}))

vi.mock('@/lib/native-token-store', () => ({
  storePkceChallenge: (...args: unknown[]) => storePkceChallenge(...args),
}))

beforeEach(() => {
  getSession.mockReset()
  generateOneTimeToken.mockReset()
  storePkceChallenge.mockReset()
})

// 43-char base64url = a well-formed SHA-256 challenge.
const CHALLENGE = 'A'.repeat(43)

function makeReq(query = ''): NextRequest {
  return new NextRequest(`https://kasero.app/api/native/auth-callback${query}`, {
    headers: new Headers({ host: 'kasero.app' }),
  })
}

describe('GET /api/native/auth-callback', () => {
  it('returns 400 when the challenge is missing', async () => {
    const { GET } = await import('./route')
    const res = await GET(makeReq())
    expect(res.status).toBe(400)
    expect(getSession).not.toHaveBeenCalled()
    expect(storePkceChallenge).not.toHaveBeenCalled()
  })

  it('returns 400 when the challenge is malformed', async () => {
    const { GET } = await import('./route')
    const res = await GET(makeReq('?challenge=not-base64url-and-way-too-short'))
    expect(res.status).toBe(400)
    expect(storePkceChallenge).not.toHaveBeenCalled()
  })

  it('redirects with error=unauthorized when there is no session', async () => {
    getSession.mockResolvedValueOnce(null)
    const { GET } = await import('./route')
    const res = await GET(makeReq(`?challenge=${CHALLENGE}`))
    expect(res.headers.get('location')).toContain('kasero://auth-callback?error=unauthorized')
    expect(storePkceChallenge).not.toHaveBeenCalled()
  })

  it('mints an ott and binds the challenge on the happy path', async () => {
    getSession.mockResolvedValueOnce({ user: { id: 'u1' } })
    generateOneTimeToken.mockResolvedValueOnce({ token: 'ott-token' })
    const { GET } = await import('./route')
    const res = await GET(makeReq(`?challenge=${CHALLENGE}`))
    const location = res.headers.get('location') ?? ''
    expect(location).toContain('kasero://auth-callback?ott=ott-token')
    expect(location).not.toContain('challenge')
    expect(storePkceChallenge).toHaveBeenCalledWith('ott-token', CHALLENGE)
  })
})
