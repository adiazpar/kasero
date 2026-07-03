import { describe, it, expect, afterEach, vi } from 'vitest'
import { isAppReviewEmail, getAppReviewOTP } from './app-review'

/**
 * Unit tests for the Apple App Review demo-account gating
 * (App Store guideline 2.1). The helpers read process.env at call time,
 * so vi.stubEnv drives every configuration branch deterministically.
 *
 * Invariants pinned here:
 *   - feature is entirely inert unless BOTH envs are set and the OTP is
 *     6+ digits
 *   - the static code is returned for the exact configured email only
 *     (trimmed, case-insensitive) — never for any other account
 */

const REVIEW_EMAIL = 'apple.review@example.com'
const REVIEW_OTP = '123456'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('app-review gating — inert configurations', () => {
  it('is inert when neither env is set', () => {
    vi.stubEnv('APP_REVIEW_EMAIL', '')
    vi.stubEnv('APP_REVIEW_OTP', '')
    expect(isAppReviewEmail(REVIEW_EMAIL)).toBe(false)
    expect(getAppReviewOTP(REVIEW_EMAIL)).toBeUndefined()
  })

  it('is inert when only APP_REVIEW_EMAIL is set', () => {
    vi.stubEnv('APP_REVIEW_EMAIL', REVIEW_EMAIL)
    vi.stubEnv('APP_REVIEW_OTP', '')
    expect(isAppReviewEmail(REVIEW_EMAIL)).toBe(false)
    expect(getAppReviewOTP(REVIEW_EMAIL)).toBeUndefined()
  })

  it('is inert when only APP_REVIEW_OTP is set', () => {
    vi.stubEnv('APP_REVIEW_EMAIL', '')
    vi.stubEnv('APP_REVIEW_OTP', REVIEW_OTP)
    expect(isAppReviewEmail(REVIEW_EMAIL)).toBe(false)
    expect(getAppReviewOTP(REVIEW_EMAIL)).toBeUndefined()
  })

  it('is inert when the OTP is shorter than 6 digits', () => {
    vi.stubEnv('APP_REVIEW_EMAIL', REVIEW_EMAIL)
    vi.stubEnv('APP_REVIEW_OTP', '12345')
    expect(isAppReviewEmail(REVIEW_EMAIL)).toBe(false)
    expect(getAppReviewOTP(REVIEW_EMAIL)).toBeUndefined()
  })

  it('is inert when the OTP contains non-digits', () => {
    vi.stubEnv('APP_REVIEW_EMAIL', REVIEW_EMAIL)
    vi.stubEnv('APP_REVIEW_OTP', 'abc123')
    expect(isAppReviewEmail(REVIEW_EMAIL)).toBe(false)
    expect(getAppReviewOTP(REVIEW_EMAIL)).toBeUndefined()
  })
})

describe('app-review gating — active configuration', () => {
  it('returns the static code for the exact configured email', () => {
    vi.stubEnv('APP_REVIEW_EMAIL', REVIEW_EMAIL)
    vi.stubEnv('APP_REVIEW_OTP', REVIEW_OTP)
    expect(isAppReviewEmail(REVIEW_EMAIL)).toBe(true)
    expect(getAppReviewOTP(REVIEW_EMAIL)).toBe(REVIEW_OTP)
  })

  it('matches case-insensitively and trims whitespace on both sides', () => {
    vi.stubEnv('APP_REVIEW_EMAIL', ' Apple.Review@Example.com ')
    vi.stubEnv('APP_REVIEW_OTP', REVIEW_OTP)
    expect(isAppReviewEmail('APPLE.REVIEW@example.COM')).toBe(true)
    expect(getAppReviewOTP('  apple.review@example.com')).toBe(REVIEW_OTP)
  })

  it('accepts codes longer than 6 digits', () => {
    vi.stubEnv('APP_REVIEW_EMAIL', REVIEW_EMAIL)
    vi.stubEnv('APP_REVIEW_OTP', '12345678')
    expect(getAppReviewOTP(REVIEW_EMAIL)).toBe('12345678')
  })

  it('never returns the static code for any other email', () => {
    vi.stubEnv('APP_REVIEW_EMAIL', REVIEW_EMAIL)
    vi.stubEnv('APP_REVIEW_OTP', REVIEW_OTP)
    expect(isAppReviewEmail('someone.else@example.com')).toBe(false)
    expect(getAppReviewOTP('someone.else@example.com')).toBeUndefined()
    // Substring / prefix lookalikes must not match either.
    expect(isAppReviewEmail('apple.review@example.com.evil.com')).toBe(false)
    expect(getAppReviewOTP('xapple.review@example.com')).toBeUndefined()
  })
})
