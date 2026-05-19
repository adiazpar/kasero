import { describe, it, expect, vi, beforeEach } from 'vitest'

// publishToUser is dynamically imported inside the after hook; mock the
// module so the hook's import('./realtime/publisher') resolves to this spy.
vi.mock('./realtime/publisher', () => ({
  publishToUser: vi.fn().mockResolvedValue(undefined),
}))

// getSessionFromCtx is called inside the after hook. Mock it so tests can
// control what session is returned without needing real auth cookies.
vi.mock('better-auth/api', async (orig) => {
  const real = await orig<typeof import('better-auth/api')>()
  return { ...real, getSessionFromCtx: vi.fn() }
})

import { auth } from './auth'
import { getSessionFromCtx } from 'better-auth/api'
import { publishToUser } from './realtime/publisher'

const mockGetSessionFromCtx = vi.mocked(getSessionFromCtx)
const mockPublishToUser = vi.mocked(publishToUser)

const opts = (auth as unknown as {
  options: {
    plugins?: Array<{ id: string }>
    emailAndPassword?: { enabled?: boolean }
    account?: { accountLinking?: { trustedProviders?: string[] } }
    hooks?: { before?: unknown; after?: unknown }
    session?: { freshAge?: number }
    rateLimit?: { storage?: string; enabled?: boolean }
    secondaryStorage?: { get: unknown; set: unknown; delete: unknown }
    socialProviders?: Record<string, { clientId?: unknown; clientSecret?: unknown } | undefined>
  }
}).options

const afterHook = opts.hooks?.after as ((ctx: unknown) => Promise<void>) | undefined

beforeEach(() => {
  mockPublishToUser.mockReset()
  mockGetSessionFromCtx.mockReset()
  mockPublishToUser.mockResolvedValue(undefined)
})

// Fake auth context that satisfies the middleware's createInternalContext
// field access. We only set the fields the after hook actually reads:
// path, body, request.
function fakeCtx(path: string, body: Record<string, unknown>, deviceId?: string) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (deviceId) headers.set('x-device-id', deviceId)
  return {
    path,
    body,
    request: { headers },
    headers: {},
    method: 'POST',
    context: {},
  }
}

describe('better-auth config', () => {
  it('exposes the options object (sanity)', () => {
    expect(opts).toBeDefined()
    expect(Array.isArray(opts.plugins)).toBe(true)
  })

  it('has email-otp plugin loaded', () => {
    // better-auth emits kebab-case plugin ids; see
    // node_modules/better-auth/dist/plugins/email-otp/index.mjs (id: 'email-otp')
    expect(opts.plugins?.some((p) => p.id === 'email-otp')).toBe(true)
  })

  it('does NOT have twoFactor plugin loaded', () => {
    // better-auth emits kebab-case plugin ids; see
    // node_modules/better-auth/dist/plugins/two-factor/index.mjs (id: 'two-factor')
    expect(opts.plugins?.some((p) => p.id === 'two-factor')).toBe(false)
  })

  it('does NOT have emailAndPassword enabled', () => {
    expect(opts.emailAndPassword?.enabled).toBeFalsy()
  })

  it('keeps Google in trustedProviders for account linking', () => {
    expect(opts.account?.accountLinking?.trustedProviders).toContain('google')
  })

  it('lists Apple in trustedProviders so verified Apple emails can link to existing accounts', () => {
    expect(opts.account?.accountLinking?.trustedProviders).toContain('apple')
  })

  it('registers the apple provider when all four APPLE_* env vars are set, otherwise omits it', () => {
    // Mirrors the conditional pattern used for Upstash above. We can only
    // observe the env state vitest was launched with — we don't manipulate
    // process.env at runtime because auth.ts evaluates socialProviders
    // once at module load.
    const hasApple =
      !!process.env.APPLE_CLIENT_ID &&
      !!process.env.APPLE_TEAM_ID &&
      !!process.env.APPLE_KEY_ID &&
      !!process.env.APPLE_PRIVATE_KEY
    if (hasApple) {
      expect(opts.socialProviders?.apple).toBeDefined()
      expect(opts.socialProviders?.apple?.clientId).toBe(process.env.APPLE_CLIENT_ID)
      expect(typeof opts.socialProviders?.apple?.clientSecret).toBe('string')
    } else {
      expect(opts.socialProviders?.apple).toBeUndefined()
    }
  })

  it('registers a before hook for cross-account defense', () => {
    // Shape-only check: confirms a before-hook function is registered.
    // The actual rejection behavior (cross-account session check) is
    // exercised end-to-end by Task D2's passwordless E2E specs.
    expect(typeof opts.hooks?.before).toBe('function')
  })

  it('registers an after hook for profile.updated publish', () => {
    expect(typeof opts.hooks?.after).toBe('function')
  })

  it('disables better-auth freshAge gate so OTP step-up is the sole freshness proof', () => {
    expect(opts.session?.freshAge).toBe(0)
  })

  it('routes rate-limit counters through secondary storage (not the SQL database)', () => {
    // Counters live in Upstash Redis with TTL-based expiry; the legacy
    // `rate_limit` Turso table was dropped in migration
    // 2026-05-15-01-drop-rate-limit-table.sql.
    expect(opts.rateLimit?.storage).toBe('secondary-storage')
    expect(opts.rateLimit?.enabled).toBe(true)
  })

  it('wires secondaryStorage when Upstash creds are present', () => {
    // In CI / dev without UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
    // the adapter is intentionally undefined and better-auth falls back to
    // an in-memory limiter (acceptable for local dev). When the env vars
    // ARE present we expect the 3-method adapter to be wired up.
    const hasUpstash =
      !!process.env.UPSTASH_REDIS_REST_URL &&
      !!process.env.UPSTASH_REDIS_REST_TOKEN
    if (hasUpstash) {
      expect(opts.secondaryStorage).toBeDefined()
      expect(typeof opts.secondaryStorage?.get).toBe('function')
      expect(typeof opts.secondaryStorage?.set).toBe('function')
      expect(typeof opts.secondaryStorage?.delete).toBe('function')
    } else {
      expect(opts.secondaryStorage).toBeUndefined()
    }
  })
})

describe('better-auth after hook — profile.updated', () => {
  // better-auth's getSessionFromCtx returns { session, user } — the session
  // fields are stubbed minimally; only `user.id` is read by the hook.
  const SESSION = {
    user: { id: 'user-abc', email: 'test@example.com' },
    session: {
      id: 's-1',
      userId: 'user-abc',
      createdAt: new Date(0),
      updatedAt: new Date(0),
      expiresAt: new Date(Date.now() + 3_600_000),
      token: 'tok',
    },
  } as unknown as Parameters<typeof mockGetSessionFromCtx.mockResolvedValue>[0]

  it('publishes profile.updated with fields: [displayName] on name change', async () => {
    mockGetSessionFromCtx.mockResolvedValue(SESSION)
    await afterHook!(fakeCtx('/update-user', { name: 'Alice' }))
    expect(mockPublishToUser).toHaveBeenCalledOnce()
    expect(mockPublishToUser).toHaveBeenCalledWith(
      'user-abc',
      expect.objectContaining({ type: 'profile.updated', fields: ['displayName'] }),
      undefined,
    )
  })

  it('publishes profile.updated with fields: [language] on language change', async () => {
    mockGetSessionFromCtx.mockResolvedValue(SESSION)
    await afterHook!(fakeCtx('/update-user', { language: 'es' }))
    expect(mockPublishToUser).toHaveBeenCalledOnce()
    expect(mockPublishToUser).toHaveBeenCalledWith(
      'user-abc',
      expect.objectContaining({ type: 'profile.updated', fields: ['language'] }),
      undefined,
    )
  })

  it('publishes profile.updated with both fields when name and language change together', async () => {
    mockGetSessionFromCtx.mockResolvedValue(SESSION)
    await afterHook!(fakeCtx('/update-user', { name: 'Bob', language: 'ja' }))
    expect(mockPublishToUser).toHaveBeenCalledOnce()
    expect(mockPublishToUser).toHaveBeenCalledWith(
      'user-abc',
      expect.objectContaining({ type: 'profile.updated', fields: expect.arrayContaining(['displayName', 'language']) }),
      undefined,
    )
    const fields = (mockPublishToUser.mock.calls[0][1] as { fields: string[] }).fields
    expect(fields).toHaveLength(2)
  })

  it('does not publish when no profile fields change (e.g. image-only update)', async () => {
    mockGetSessionFromCtx.mockResolvedValue(SESSION)
    await afterHook!(fakeCtx('/update-user', { image: 'data:...' }))
    expect(mockPublishToUser).not.toHaveBeenCalled()
  })

  it('forwards X-Device-Id to publishToUser', async () => {
    mockGetSessionFromCtx.mockResolvedValue(SESSION)
    await afterHook!(fakeCtx('/update-user', { name: 'Carol' }, 'dev-xyz'))
    expect(publishToUser).toHaveBeenCalledWith(
      'user-abc',
      expect.objectContaining({ type: 'profile.updated' }),
      'dev-xyz',
    )
  })

  it('does not publish on non-update-user paths', async () => {
    mockGetSessionFromCtx.mockResolvedValue(SESSION)
    await afterHook!(fakeCtx('/sign-in/email-otp', { name: 'Alice' }))
    expect(mockPublishToUser).not.toHaveBeenCalled()
  })

  it('does not publish when session cannot be resolved', async () => {
    mockGetSessionFromCtx.mockRejectedValue(new Error('no session'))
    await afterHook!(fakeCtx('/update-user', { name: 'Alice' }))
    expect(mockPublishToUser).not.toHaveBeenCalled()
  })
})
