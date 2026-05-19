import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Unit tests for POST /api/account/change-email.
 *
 * Following the established pattern from /api/account/delete (no real-DB
 * harness yet — see route.test.ts there for the full reasoning), this
 * file mocks the auth + db boundary and exercises every branch of the
 * dual-OTP route.
 *
 * Branches covered:
 *   initiate:
 *     - no session                                   -> 401 UNAUTHORIZED
 *     - newEmail field missing                       -> 400 validation
 *     - newEmail === current session email           -> 400 EMAIL_CHANGE_SAME_AS_CURRENT
 *     - newEmail already taken by another user       -> 409 EMAIL_CHANGE_TARGET_TAKEN
 *     - happy path                                   -> 200 EMAIL_CHANGE_OTP_SENT
 *                                                       (2x createVerificationRow, 2x sendVerificationEmail)
 *   confirm:
 *     - either OTP wrong                             -> 401 OTP_INVALID
 *     - happy path                                   -> 200 EMAIL_CHANGED
 *                                                       (users.email updated, other sessions revoked,
 *                                                        publishToUser called with fields: ['email'])
 */

const getSession = vi.fn()
const sendVerificationEmail = vi.fn()
const publishToUser = vi.fn()

vi.mock('@/lib/realtime', async (orig) => {
  const real = await orig<typeof import('@/lib/realtime')>()
  return { ...real, publishToUser }
})

// Drizzle query-builder mocks. The route uses chainable .select / .insert
// / .update / .delete; each method returns the same `builder` object so
// `.from().where().limit()` and `.insert().values()` resolve to the
// terminal promise the mock returns.
const selectImpl = vi.fn()
const insertImpl = vi.fn()
const updateImpl = vi.fn()
const deleteImpl = vi.fn()
const transactionImpl = vi.fn()

function builder<T>(resolved: T) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {}
  b.from = vi.fn(() => b)
  b.where = vi.fn(() => b)
  b.limit = vi.fn(() => Promise.resolve(resolved))
  b.values = vi.fn(() => Promise.resolve(resolved))
  b.set = vi.fn(() => b)
  b.then = (resolve: (value: T) => void) => Promise.resolve(resolved).then(resolve)
  return b
}

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => getSession(...args),
    },
  },
}))

vi.mock('@/lib/email', () => ({
  sendVerificationEmail: (...args: unknown[]) => sendVerificationEmail(...args),
}))

vi.mock('@/db', () => ({
  db: {
    select: (...args: unknown[]) => selectImpl(...args),
    insert: (...args: unknown[]) => insertImpl(...args),
    update: (...args: unknown[]) => updateImpl(...args),
    delete: (...args: unknown[]) => deleteImpl(...args),
    transaction: (...args: unknown[]) => transactionImpl(...args),
  },
}))

// Schema mock: only the symbols our route references need to resolve to
// something truthy. Drizzle's `eq`/`and`/`ne` accept arbitrary column
// references and the mock builder ignores them anyway.
vi.mock('@kasero/shared/db/schema', () => ({
  users: {
    id: 'users.id',
    email: 'users.email',
    emailVerified: 'users.email_verified',
    emailVerifiedAt: 'users.email_verified_at',
    updatedAt: 'users.updated_at',
  },
  session: {
    id: 'session.id',
    userId: 'session.user_id',
  },
  verification: {
    id: 'verification.id',
    identifier: 'verification.identifier',
    value: 'verification.value',
    expiresAt: 'verification.expires_at',
  },
}))

vi.mock('@/lib/rate-limit', async () => {
  return {
    checkRateLimit: vi.fn(async () => ({ success: true, resetAt: Date.now() + 60_000 })),
    getClientIp: () => '127.0.0.1',
    RateLimits: {
      userMutation: { window: 60, max: 30 },
      ipMutation: { window: 60, max: 600 },
    },
    UpstashUnavailableError: class UpstashUnavailableError extends Error {},
  }
})

const SESSION_USER = {
  id: 'user-1',
  email: 'me@x.com',
  emailVerified: true,
  name: 'Test User',
  language: 'en-US',
}

function makeRequest(body: unknown): Request {
  const json = JSON.stringify(body)
  return new Request('http://localhost:3000/api/account/change-email', {
    method: 'POST',
    body: json,
    headers: {
      'content-type': 'application/json',
      'content-length': String(new TextEncoder().encode(json).length),
      origin: 'http://localhost:3000',
      host: 'localhost:3000',
    },
  })
}

beforeEach(() => {
  getSession.mockReset()
  sendVerificationEmail.mockReset()
  publishToUser.mockReset()
  selectImpl.mockReset()
  insertImpl.mockReset()
  updateImpl.mockReset()
  deleteImpl.mockReset()
  transactionImpl.mockReset()
  // Default: every send/publish succeeds, every insert/delete/update
  // resolves to a no-op result. Tests that care override per-call.
  sendVerificationEmail.mockResolvedValue(undefined)
  publishToUser.mockResolvedValue(undefined)
  insertImpl.mockImplementation(() => builder({ rowsAffected: 1 }))
  updateImpl.mockImplementation(() => builder({ rowsAffected: 1 }))
  deleteImpl.mockImplementation(() => builder({ rowsAffected: 1 }))
  // transaction(cb): run the callback with a tx object that has the same
  // shape as `db` (insert/update/delete/select). Lets the route's
  // tx.update / tx.delete reach our top-level mocks.
  transactionImpl.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
    return cb({
      select: (...args: unknown[]) => selectImpl(...args),
      insert: (...args: unknown[]) => insertImpl(...args),
      update: (...args: unknown[]) => updateImpl(...args),
      delete: (...args: unknown[]) => deleteImpl(...args),
    })
  })
})

describe('POST /api/account/change-email — initiate', () => {
  it('rejects without an active session', async () => {
    getSession.mockResolvedValueOnce(null)
    const { POST } = await import('./route')
    const res = await POST(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeRequest({ phase: 'initiate', newEmail: 'new@x.com' }) as any,
    )
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.messageCode).toBe('UNAUTHORIZED')
  })

  it('rejects when newEmail field is missing', async () => {
    getSession.mockResolvedValueOnce({ user: SESSION_USER })
    const { POST } = await import('./route')
    const res = await POST(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeRequest({ phase: 'initiate' }) as any,
    )
    expect(res.status).toBe(400)
  })

  it('rejects when newEmail equals the current session email', async () => {
    getSession.mockResolvedValueOnce({ user: SESSION_USER })
    const { POST } = await import('./route')
    const res = await POST(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeRequest({ phase: 'initiate', newEmail: 'me@x.com' }) as any,
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.messageCode).toBe('EMAIL_CHANGE_SAME_AS_CURRENT')
    // No emails sent, no DB writes.
    expect(sendVerificationEmail).not.toHaveBeenCalled()
    expect(insertImpl).not.toHaveBeenCalled()
  })

  it('rejects when another user already owns the email (409)', async () => {
    getSession.mockResolvedValueOnce({ user: SESSION_USER })
    // First select() is the uniqueness check; return a non-empty result
    // so the route bails with EMAIL_CHANGE_TARGET_TAKEN.
    selectImpl.mockReturnValueOnce(builder([{ id: 'other-user' }]))
    const { POST } = await import('./route')
    const res = await POST(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeRequest({ phase: 'initiate', newEmail: 'taken@x.com' }) as any,
    )
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.messageCode).toBe('EMAIL_CHANGE_TARGET_TAKEN')
    expect(sendVerificationEmail).not.toHaveBeenCalled()
    expect(insertImpl).not.toHaveBeenCalled()
  })

  it('on happy path: sends OTPs to both addresses and persists both rows', async () => {
    getSession.mockResolvedValueOnce({ user: SESSION_USER })
    // Uniqueness check: empty -> available.
    selectImpl.mockReturnValueOnce(builder([]))
    const { POST } = await import('./route')
    const res = await POST(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeRequest({ phase: 'initiate', newEmail: 'new@x.com' }) as any,
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.messageCode).toBe('EMAIL_CHANGE_OTP_SENT')
    expect(sendVerificationEmail).toHaveBeenCalledTimes(2)
    // One send to the OLD email, one to the NEW email — order is parallel
    // so we don't assert sequence, just the set of recipients.
    const recipients = sendVerificationEmail.mock.calls.map(
      (call) => (call[0] as { email: string }).email,
    )
    expect(new Set(recipients)).toEqual(new Set(['me@x.com', 'new@x.com']))
    // Two verification rows inserted (one per OTP). The route deletes
    // any existing row first, so delete also fires per identifier.
    expect(insertImpl).toHaveBeenCalledTimes(2)
  })
})

describe('POST /api/account/change-email — confirm', () => {
  it('rejects when either OTP is wrong (401 OTP_INVALID)', async () => {
    getSession.mockResolvedValue({ user: SESSION_USER, session: { id: 'sess-1' } })
    // Uniqueness re-check at confirm: available.
    selectImpl.mockReturnValueOnce(builder([]))
    // verifyOtpDirect runs two select()s in parallel, one per email.
    // Return one valid match and one missing row.
    selectImpl.mockReturnValueOnce(
      builder([
        {
          id: 'ver-old',
          // Stored value format: `${otp}:${attempts}`.
          value: '111111:0',
          expiresAt: new Date(Date.now() + 60_000),
        },
      ]),
    )
    selectImpl.mockReturnValueOnce(builder([])) // no row for new email
    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({
        phase: 'confirm',
        newEmail: 'new@x.com',
        oldOtp: '111111',
        newOtp: '222222',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    )
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.messageCode).toBe('OTP_INVALID')
    // Critical: no transaction must have run if either OTP failed.
    expect(transactionImpl).not.toHaveBeenCalled()
  })

  it('on happy path: updates users.email and revokes OTHER sessions', async () => {
    getSession.mockResolvedValue({ user: SESSION_USER, session: { id: 'sess-1' } })
    // Uniqueness re-check at confirm: available.
    selectImpl.mockReturnValueOnce(builder([]))
    // Both OTP lookups succeed.
    selectImpl.mockReturnValueOnce(
      builder([
        {
          id: 'ver-old',
          value: '111111:0',
          expiresAt: new Date(Date.now() + 60_000),
        },
      ]),
    )
    selectImpl.mockReturnValueOnce(
      builder([
        {
          id: 'ver-new',
          value: '222222:0',
          expiresAt: new Date(Date.now() + 60_000),
        },
      ]),
    )
    const { POST } = await import('./route')
    const res = await POST(
      makeRequest({
        phase: 'confirm',
        newEmail: 'new@x.com',
        oldOtp: '111111',
        newOtp: '222222',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.messageCode).toBe('EMAIL_CHANGED')
    expect(body.newEmail).toBe('new@x.com')
    // Transaction must have run for the mutation.
    expect(transactionImpl).toHaveBeenCalledOnce()
    // users.email update happened inside the tx.
    expect(updateImpl).toHaveBeenCalled()
    // session delete happened inside the tx (revoke other sessions).
    expect(deleteImpl).toHaveBeenCalled()
    // Realtime: profile.updated with fields: ['email'] published after the tx.
    expect(publishToUser).toHaveBeenCalledOnce()
    expect(publishToUser).toHaveBeenCalledWith(
      SESSION_USER.id,
      expect.objectContaining({ type: 'profile.updated', fields: ['email'] }),
      undefined,
    )
  })

  it('forwards X-Device-Id to the publish call on confirm success', async () => {
    getSession.mockResolvedValue({ user: SESSION_USER, session: { id: 'sess-1' } })
    selectImpl.mockReturnValueOnce(builder([]))
    selectImpl.mockReturnValueOnce(
      builder([{ id: 'ver-old', value: '111111:0', expiresAt: new Date(Date.now() + 60_000) }]),
    )
    selectImpl.mockReturnValueOnce(
      builder([{ id: 'ver-new', value: '222222:0', expiresAt: new Date(Date.now() + 60_000) }]),
    )
    const req = new Request('http://localhost:3000/api/account/change-email', {
      method: 'POST',
      body: JSON.stringify({ phase: 'confirm', newEmail: 'new@x.com', oldOtp: '111111', newOtp: '222222' }),
      headers: {
        'content-type': 'application/json',
        'content-length': '1',
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        'x-device-id': 'dev-xyz',
      },
    })
    const { POST } = await import('./route')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    expect(publishToUser).toHaveBeenCalledWith(
      SESSION_USER.id,
      expect.objectContaining({ type: 'profile.updated', fields: ['email'] }),
      'dev-xyz',
    )
  })

  it('does not call publishToUser in the initiate phase', async () => {
    getSession.mockResolvedValueOnce({ user: SESSION_USER })
    selectImpl.mockReturnValueOnce(builder([]))
    const { POST } = await import('./route')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(makeRequest({ phase: 'initiate', newEmail: 'new@x.com' }) as any)
    expect(res.status).toBe(200)
    expect(publishToUser).not.toHaveBeenCalled()
  })
})
