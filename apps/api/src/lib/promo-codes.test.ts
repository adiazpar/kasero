import { describe, it, expect } from 'vitest'
import { parsePromoCodes, addCalendarMonths } from './promo-codes'

describe('parsePromoCodes', () => {
  it('parses the CODE:months comma-separated format', () => {
    const codes = parsePromoCodes('LAUNCHCREW:12,BETATHANKS:3')
    expect(codes.get('LAUNCHCREW')).toBe(12)
    expect(codes.get('BETATHANKS')).toBe(3)
    expect(codes.size).toBe(2)
  })

  it('uppercases codes and tolerates whitespace', () => {
    const codes = parsePromoCodes('  launchCrew : 12 , beta50:1 ')
    expect(codes.get('LAUNCHCREW')).toBe(12)
    expect(codes.get('BETA50')).toBe(1)
  })

  it('returns an empty map for unset/empty input', () => {
    expect(parsePromoCodes(undefined).size).toBe(0)
    expect(parsePromoCodes(null).size).toBe(0)
    expect(parsePromoCodes('').size).toBe(0)
  })

  it('skips malformed entries without dropping valid ones', () => {
    const codes = parsePromoCodes('GOOD:6,NOMONTHS,:3,ZERO:0,NEG:-1,FLOAT:1.5,HUGE:9999')
    expect(codes.size).toBe(1)
    expect(codes.get('GOOD')).toBe(6)
  })
})

describe('addCalendarMonths', () => {
  it('adds whole calendar months', () => {
    const d = addCalendarMonths(new Date('2026-07-06T12:00:00Z'), 3)
    expect(d.toISOString()).toBe('2026-10-06T12:00:00.000Z')
  })

  it('rolls over year boundaries', () => {
    const d = addCalendarMonths(new Date('2026-11-15T00:00:00Z'), 2)
    expect(d.toISOString()).toBe('2027-01-15T00:00:00.000Z')
  })

  it('clamps the day-of-month instead of overflowing (Jan 31 + 1mo = Feb 28)', () => {
    const d = addCalendarMonths(new Date('2026-01-31T08:00:00Z'), 1)
    expect(d.toISOString()).toBe('2026-02-28T08:00:00.000Z')
  })

  it('does not mutate the input date', () => {
    const base = new Date('2026-07-06T00:00:00Z')
    addCalendarMonths(base, 5)
    expect(base.toISOString()).toBe('2026-07-06T00:00:00.000Z')
  })
})
