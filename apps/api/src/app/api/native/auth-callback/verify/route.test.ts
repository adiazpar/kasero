import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { APIError } from 'better-auth/api'

/**
 * Unit tests for POST /api/native/auth-callback/verify (PKCE-gated ott
 * redemption, FINDING 1).
 *
 * Covers the challenge check:
 *   - no binding for the ott                       -> 401
 *   - SHA-256(verifier) != stored challenge        -> 401 (interceptor path)
 *   - matching verifier, ott expired/invalid       -> 401
 *   - matching verifier, valid ott                 -> 200 + set-auth-token header
 */

const verifyOneTimeToken = vi.fn()
const consumePkceChallenge = vi.fn()

vi.mock('@/lib/auth', () => ({
  auth: {
    api: { verifyOneTimeToken: (...args: unknown[]) => verifyOneTimeToken(...args) },
  },
}))

// deriveChallenge / challengesMatch are pure; use faithful implementations
// so the happy path matches. consumePkceChallenge is the store lookup we
// drive per test.
vi.mock('@/lib/native-token-store', () => ({
  consumePkceChallenge: (...args: unknown[]) => consumePkceChallenge(...args),
  deriveChallenge: (v: string) => createHash('sha256').update(v).digest('base64url'),
  challengesMatch: (a: string, b: string) => a === b,
}))

beforeEach(() => {
  verifyOneTimeToken.mockReset()
  consumePkceChallenge.mockReset()
})

const VERIFIER = 'v'.repeat(43)
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url')

function makeReq(body: Record<string, unknown>): NextRequest {
  const json = JSON.stringify(body)
  return new NextRequest('https://kasero.app/api/native/auth-callback/verify', {
    method: 'POST',
    body: json,
    headers: new Headers({
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(json)),
    }),
  })
}

describe('POST /api/native/auth-callback/verify', () => {
  it('returns 401 when no challenge is bound to the ott', async () => {
    consumePkceChallenge.mockResolvedValueOnce(null)
    const { POST } = await import('./route')
    const res = await POST(makeReq({ token: 'ott-token-abc', verifier: VERIFIER }))
    expect(res.status).toBe(401)
    expect(verifyOneTimeToken).not.toHaveBeenCalled()
  })

  it('returns 401 when SHA-256(verifier) does not match the stored challenge', async () => {
    // Interceptor holds the ott but supplied the wrong verifier.
    consumePkceChallenge.mockResolvedValueOnce(CHALLENGE)
    const { POST } = await import('./route')
    const res = await POST(makeReq({ token: 'ott-token-abc', verifier: 'x'.repeat(43) }))
    expect(res.status).toBe(401)
    expect(verifyOneTimeToken).not.toHaveBeenCalled()
  })

  it('returns 401 when the ott is expired/invalid (better-auth throws)', async () => {
    consumePkceChallenge.mockResolvedValueOnce(CHALLENGE)
    verifyOneTimeToken.mockRejectedValueOnce(
      new APIError('BAD_REQUEST', { message: 'Invalid token' }),
    )
    const { POST } = await import('./route')
    const res = await POST(makeReq({ token: 'ott-token-abc', verifier: VERIFIER }))
    expect(res.status).toBe(401)
  })

  it('redeems the ott and returns the set-auth-token on the happy path', async () => {
    consumePkceChallenge.mockResolvedValueOnce(CHALLENGE)
    verifyOneTimeToken.mockResolvedValueOnce({
      headers: new Headers({ 'set-auth-token': 'session-token-xyz' }),
    })
    const { POST } = await import('./route')
    const res = await POST(makeReq({ token: 'ott-token-abc', verifier: VERIFIER }))
    expect(res.status).toBe(200)
    expect(res.headers.get('set-auth-token')).toBe('session-token-xyz')
    expect(verifyOneTimeToken).toHaveBeenCalled()
  })
})
