import { describe, it, expect } from 'vitest'
import { isPro, PRO_PRICING, AI_DAILY_QUOTA } from './entitlements'

const NOW = new Date('2026-07-06T12:00:00Z')
const PAST = new Date('2026-01-01T00:00:00Z')
const FUTURE = new Date('2027-01-01T00:00:00Z')

describe('isPro', () => {
  it('returns false for free plan regardless of expiry', () => {
    expect(isPro('free', null, NOW)).toBe(false)
    expect(isPro('free', FUTURE, NOW)).toBe(false)
  })

  it('returns false for null/undefined/unknown plan values', () => {
    expect(isPro(null, null, NOW)).toBe(false)
    expect(isPro(undefined, null, NOW)).toBe(false)
    expect(isPro('enterprise', FUTURE, NOW)).toBe(false)
  })

  it('returns true for pro with no expiry (non-expiring grant)', () => {
    expect(isPro('pro', null, NOW)).toBe(true)
    expect(isPro('pro', undefined, NOW)).toBe(true)
  })

  it('returns true for pro with a future expiry', () => {
    expect(isPro('pro', FUTURE, NOW)).toBe(true)
  })

  it('returns false for pro with a past expiry (expired pro = not pro)', () => {
    expect(isPro('pro', PAST, NOW)).toBe(false)
  })

  it('treats an expiry exactly at now as expired', () => {
    expect(isPro('pro', new Date(NOW.getTime()), NOW)).toBe(false)
    expect(isPro('pro', new Date(NOW.getTime() + 1), NOW)).toBe(true)
  })

  it('accepts ISO-string expiries (client-side JSON shape)', () => {
    expect(isPro('pro', FUTURE.toISOString(), NOW)).toBe(true)
    expect(isPro('pro', PAST.toISOString(), NOW)).toBe(false)
  })

  it('accepts epoch-millisecond expiries', () => {
    expect(isPro('pro', FUTURE.getTime(), NOW)).toBe(true)
    expect(isPro('pro', PAST.getTime(), NOW)).toBe(false)
  })

  it('fails toward free on an unparsable expiry', () => {
    expect(isPro('pro', 'not-a-date', NOW)).toBe(false)
  })

  it('defaults `now` to the current time', () => {
    expect(isPro('pro', new Date(Date.now() + 60_000))).toBe(true)
    expect(isPro('pro', new Date(Date.now() - 60_000))).toBe(false)
  })
})

describe('PRO_PRICING', () => {
  it('carries the display-only USD reference prices', () => {
    expect(PRO_PRICING.monthlyUsd).toBe(7.99)
    expect(PRO_PRICING.annualUsd).toBe(79.99)
  })
})

describe('AI_DAILY_QUOTA', () => {
  it('pro raises the free daily quota', () => {
    expect(AI_DAILY_QUOTA.free).toBe(100)
    expect(AI_DAILY_QUOTA.pro).toBe(400)
    expect(AI_DAILY_QUOTA.pro).toBeGreaterThan(AI_DAILY_QUOTA.free)
  })
})
