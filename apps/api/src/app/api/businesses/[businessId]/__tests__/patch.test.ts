import { describe, it, expect } from 'vitest'
import { patchSchema as schema } from '../schema'

// We test the schema directly; full route integration is verified manually.

describe('PATCH business schema', () => {
  it('accepts an empty payload', () => {
    expect(schema.safeParse({}).success).toBe(true)
  })

  it('rejects empty name', () => {
    expect(schema.safeParse({ name: '' }).success).toBe(false)
    expect(schema.safeParse({ name: '   ' }).success).toBe(false)
  })

  it('trims name', () => {
    const r = schema.safeParse({ name: '  Shop  ' })
    expect(r.success).toBe(true)
    expect(r.success && r.data.name).toBe('Shop')
  })

  it('rejects removeLogo with non-true string', () => {
    expect(schema.safeParse({ removeLogo: 'yes' }).success).toBe(false)
    expect(schema.safeParse({ removeLogo: 'true' }).success).toBe(true)
  })
})
