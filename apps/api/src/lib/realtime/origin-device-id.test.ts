import { describe, it, expect } from 'vitest'
import { getOriginDeviceId } from './origin-device-id'

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/', { headers })
}

describe('getOriginDeviceId', () => {
  it('returns the trimmed header value when present', () => {
    const req = makeRequest({ 'x-device-id': '  device-abc-123  ' })
    expect(getOriginDeviceId(req)).toBe('device-abc-123')
  })

  it('returns the value as-is when no trimming is needed', () => {
    const req = makeRequest({ 'x-device-id': 'device-abc-123' })
    expect(getOriginDeviceId(req)).toBe('device-abc-123')
  })

  it('returns undefined when the header is missing', () => {
    const req = makeRequest()
    expect(getOriginDeviceId(req)).toBeUndefined()
  })

  it('returns undefined when the header is an empty string', () => {
    const req = makeRequest({ 'x-device-id': '' })
    expect(getOriginDeviceId(req)).toBeUndefined()
  })

  it('returns undefined when the header is whitespace only', () => {
    const req = makeRequest({ 'x-device-id': '   ' })
    expect(getOriginDeviceId(req)).toBeUndefined()
  })
})
