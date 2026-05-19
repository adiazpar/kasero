import { describe, it, expect } from 'vitest'
import { RealtimeUnavailableError } from './errors'

describe('RealtimeUnavailableError', () => {
  it('extends Error and carries the canonical name', () => {
    const err = new RealtimeUnavailableError()
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('RealtimeUnavailableError')
    expect(err.message).toBe('Upstash realtime unavailable')
  })
  it('accepts a custom message', () => {
    const err = new RealtimeUnavailableError('publisher down')
    expect(err.message).toBe('publisher down')
  })
})
