import { describe, expect, it, beforeEach } from 'vitest'
import {
  mintSseTicket,
  consumeSseTicket,
  storePkceChallenge,
  consumePkceChallenge,
  deriveChallenge,
  challengesMatch,
  __resetForTests,
} from './native-token-store'

/**
 * Exercises the in-memory backend (no Upstash REST creds in the test env).
 * The Upstash path uses the same single-use GETDEL contract.
 */
beforeEach(() => {
  __resetForTests()
})

describe('native-token-store: SSE tickets', () => {
  it('mints a ticket that resolves to the bound userId exactly once', async () => {
    const ticket = await mintSseTicket('user-1')
    expect(typeof ticket).toBe('string')
    expect(ticket.length).toBeGreaterThan(16)
    expect(await consumeSseTicket(ticket)).toBe('user-1')
    // Single-use: a second consume gets nothing.
    expect(await consumeSseTicket(ticket)).toBeNull()
  })

  it('returns null for an unknown ticket', async () => {
    expect(await consumeSseTicket('never-minted')).toBeNull()
  })
})

describe('native-token-store: PKCE challenge binding', () => {
  it('binds a challenge to an ott and consumes it once', async () => {
    await storePkceChallenge('ott-1', 'challenge-abc')
    expect(await consumePkceChallenge('ott-1')).toBe('challenge-abc')
    expect(await consumePkceChallenge('ott-1')).toBeNull()
  })

  it('derives a stable base64url SHA-256 challenge and compares in constant time', () => {
    const verifier = 'v'.repeat(43)
    const a = deriveChallenge(verifier)
    const b = deriveChallenge(verifier)
    expect(a).toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(challengesMatch(a, b)).toBe(true)
    expect(challengesMatch(a, deriveChallenge('other'))).toBe(false)
    expect(challengesMatch('short', 'longer-value')).toBe(false)
  })
})
