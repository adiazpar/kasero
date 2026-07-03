import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Unit tests for revokeAppleTokensForUser (App Store guideline 5.1.1(v)).
 *
 * Mocks the db + client-secret boundary and stubs global fetch — same
 * mock-the-boundary pattern the other lib/route tests in this app use.
 *
 * Invariants pinned here:
 *   - silent no-op when APPLE_* envs are unset or no Apple account exists
 *   - revokes with the refresh_token when present, access_token otherwise
 *   - fail-open: fetch failures / non-2xx / mint failures never throw,
 *     and warnings never contain the token
 */

const findMany = vi.fn()
const mintAppleClientSecret = vi.fn()

vi.mock('@/db', () => ({
  db: {
    query: {
      account: {
        findMany: (...args: unknown[]) => findMany(...args),
      },
    },
  },
}))

vi.mock('./apple-client-secret', () => ({
  mintAppleClientSecret: (...args: unknown[]) => mintAppleClientSecret(...args),
}))

import { revokeAppleTokensForUser } from './apple-revoke'

const fetchMock = vi.fn()

function stubAppleEnvs() {
  vi.stubEnv('APPLE_CLIENT_ID', 'app.kasero.web')
  vi.stubEnv('APPLE_TEAM_ID', 'TEAM123456')
  vi.stubEnv('APPLE_KEY_ID', 'KEY1234567')
  vi.stubEnv('APPLE_PRIVATE_KEY', '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----')
}

beforeEach(() => {
  findMany.mockReset()
  mintAppleClientSecret.mockReset()
  mintAppleClientSecret.mockResolvedValue('minted-client-secret-jwt')
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('revokeAppleTokensForUser', () => {
  it('is a silent no-op when the APPLE_* envs are not configured', async () => {
    vi.stubEnv('APPLE_CLIENT_ID', '')
    vi.stubEnv('APPLE_TEAM_ID', '')
    vi.stubEnv('APPLE_KEY_ID', '')
    vi.stubEnv('APPLE_PRIVATE_KEY', '')
    await expect(revokeAppleTokensForUser('user-1')).resolves.toBeUndefined()
    expect(findMany).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is a silent no-op when the user has no linked Apple account', async () => {
    stubAppleEnvs()
    findMany.mockResolvedValueOnce([])
    await revokeAppleTokensForUser('user-1')
    expect(findMany).toHaveBeenCalledOnce()
    expect(mintAppleClientSecret).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('revokes the refresh token when one is stored', async () => {
    stubAppleEnvs()
    findMany.mockResolvedValueOnce([
      { refreshToken: 'rt-secret', accessToken: 'at-secret' },
    ])
    await revokeAppleTokensForUser('user-1')

    expect(mintAppleClientSecret).toHaveBeenCalledWith({
      teamId: 'TEAM123456',
      clientId: 'app.kasero.web',
      keyId: 'KEY1234567',
      privateKey: expect.stringContaining('BEGIN PRIVATE KEY'),
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://appleid.apple.com/auth/revoke')
    expect(init.method).toBe('POST')
    const body = init.body as URLSearchParams
    expect(body.get('client_id')).toBe('app.kasero.web')
    expect(body.get('client_secret')).toBe('minted-client-secret-jwt')
    expect(body.get('token')).toBe('rt-secret')
    expect(body.get('token_type_hint')).toBe('refresh_token')
  })

  it('falls back to the access token when no refresh token is stored', async () => {
    stubAppleEnvs()
    findMany.mockResolvedValueOnce([
      { refreshToken: null, accessToken: 'at-secret' },
    ])
    await revokeAppleTokensForUser('user-1')
    expect(fetchMock).toHaveBeenCalledOnce()
    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as URLSearchParams
    expect(body.get('token')).toBe('at-secret')
    expect(body.get('token_type_hint')).toBe('access_token')
  })

  it('skips accounts that have neither token stored', async () => {
    stubAppleEnvs()
    findMany.mockResolvedValueOnce([{ refreshToken: null, accessToken: null }])
    await revokeAppleTokensForUser('user-1')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails open when the revoke request rejects (network error)', async () => {
    stubAppleEnvs()
    findMany.mockResolvedValueOnce([
      { refreshToken: 'rt-secret', accessToken: null },
    ])
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(revokeAppleTokensForUser('user-1')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
    expect(JSON.stringify(warn.mock.calls)).not.toContain('rt-secret')
    warn.mockRestore()
  })

  it('fails open and logs status-only on a non-2xx response', async () => {
    stubAppleEnvs()
    findMany.mockResolvedValueOnce([
      { refreshToken: 'rt-secret', accessToken: null },
    ])
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 400 }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(revokeAppleTokensForUser('user-1')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
    const logged = JSON.stringify(warn.mock.calls)
    expect(logged).toContain('400')
    expect(logged).not.toContain('rt-secret')
    warn.mockRestore()
  })

  it('fails open when minting the client secret throws', async () => {
    stubAppleEnvs()
    findMany.mockResolvedValueOnce([
      { refreshToken: 'rt-secret', accessToken: null },
    ])
    mintAppleClientSecret.mockRejectedValueOnce(new Error('bad key'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(revokeAppleTokensForUser('user-1')).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('fails open when the db lookup throws', async () => {
    stubAppleEnvs()
    findMany.mockRejectedValueOnce(new Error('db down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(revokeAppleTokensForUser('user-1')).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('revokes every linked Apple account row', async () => {
    stubAppleEnvs()
    findMany.mockResolvedValueOnce([
      { refreshToken: 'rt-1', accessToken: null },
      { refreshToken: null, accessToken: 'at-2' },
    ])
    await revokeAppleTokensForUser('user-1')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
