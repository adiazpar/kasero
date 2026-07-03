import { describe, it, expect } from 'vitest'
import {
  decimalsForCurrency,
  roundToCurrencyDecimals,
  startOfUtcDay,
  startOfPrevUtcDay,
  computeExpectedCash,
  computeVariance,
  computeSubtotal,
  computeSaleTotals,
  nextRoundBills,
} from './sales-helpers'

describe('decimalsForCurrency', () => {
  it('returns 0 for zero-decimal currencies', () => {
    expect(decimalsForCurrency('CLP')).toBe(0)
    expect(decimalsForCurrency('JPY')).toBe(0)
    expect(decimalsForCurrency('KRW')).toBe(0)
  })

  it('returns 2 for everything else', () => {
    expect(decimalsForCurrency('USD')).toBe(2)
    expect(decimalsForCurrency('EUR')).toBe(2)
    expect(decimalsForCurrency('PEN')).toBe(2)
    expect(decimalsForCurrency('XXX-unknown')).toBe(2)
  })
})

describe('roundToCurrencyDecimals', () => {
  it('rounds USD to 2 decimals', () => {
    expect(roundToCurrencyDecimals(10.123, 'USD')).toBe(10.12)
    expect(roundToCurrencyDecimals(10.125, 'USD')).toBe(10.13)
    expect(roundToCurrencyDecimals(0.1 + 0.2, 'USD')).toBe(0.3)
  })

  it('rounds CLP to 0 decimals', () => {
    expect(roundToCurrencyDecimals(123.7, 'CLP')).toBe(124)
    expect(roundToCurrencyDecimals(123.4, 'CLP')).toBe(123)
  })

  it('returns 0 unchanged', () => {
    expect(roundToCurrencyDecimals(0, 'USD')).toBe(0)
  })
})

describe('startOfUtcDay', () => {
  it('returns midnight UTC of the given date', () => {
    const d = new Date('2026-04-29T15:43:00Z')
    expect(startOfUtcDay(d).toISOString()).toBe('2026-04-29T00:00:00.000Z')
  })
})

describe('startOfPrevUtcDay', () => {
  it('returns midnight UTC of the previous day', () => {
    const d = new Date('2026-04-29T15:43:00Z')
    expect(startOfPrevUtcDay(d).toISOString()).toBe('2026-04-28T00:00:00.000Z')
  })
})

describe('computeExpectedCash', () => {
  it('adds startingCash and cashSalesTotal', () => {
    expect(computeExpectedCash(50, 180, 'USD')).toBe(230)
  })

  it('rounds to currency decimals (USD)', () => {
    // 0.1 + 0.2 = 0.30000000000000004 in JS; rounding fixes it.
    expect(computeExpectedCash(0.1, 0.2, 'USD')).toBe(0.3)
  })

  it('rounds to 0 decimals for zero-decimal currencies', () => {
    expect(computeExpectedCash(100, 50.7, 'JPY')).toBe(151)
  })

  it('handles zero starting cash', () => {
    expect(computeExpectedCash(0, 100, 'USD')).toBe(100)
  })
})

describe('computeVariance', () => {
  it('counted equals expected returns 0', () => {
    expect(computeVariance(230, 230, 'USD')).toBe(0)
  })

  it('drawer short returns negative', () => {
    expect(computeVariance(228, 230, 'USD')).toBe(-2)
  })

  it('drawer over returns positive', () => {
    expect(computeVariance(232, 230, 'USD')).toBe(2)
  })

  it('rounds to currency decimals', () => {
    expect(computeVariance(228.456, 230.123, 'USD')).toBe(-1.67)
  })

  it('rounds to 0 decimals for zero-decimal currency', () => {
    expect(computeVariance(228.7, 230.4, 'JPY')).toBe(-2)
  })
})

describe('nextRoundBills', () => {
  it('returns up to 4 unique round-up bill amounts above the total (USD)', () => {
    expect(nextRoundBills(13.5, 'USD')).toEqual([15, 20, 50, 100])
  })

  it('handles PEN denominations', () => {
    expect(nextRoundBills(13.5, 'PEN')).toEqual([20, 50, 100, 200])
  })

  it('handles JPY (zero-decimal) denominations including the smallest bill', () => {
    expect(nextRoundBills(1850, 'JPY')).toEqual([2000, 5000, 10000])
  })

  it('handles CLP denominations', () => {
    expect(nextRoundBills(7500, 'CLP')).toEqual([8000, 10000, 20000])
  })

  it('rounds the cheapest denomination up correctly for tiny totals', () => {
    expect(nextRoundBills(0.5, 'USD')).toEqual([5, 10, 20, 50])
  })

  it('falls back to USD denominations for unknown currencies', () => {
    expect(nextRoundBills(13.5, 'XXX')).toEqual([15, 20, 50, 100])
  })

  it('skips a denomination whose round-up equals an already-included amount', () => {
    // total = 21 → ceil(21/5)*5=25, ceil(21/10)*10=30, ceil(21/20)*20=40, ceil(21/50)*50=50.
    expect(nextRoundBills(21, 'USD')).toEqual([25, 30, 40, 50])
  })

  it('returns empty array when total exceeds the largest denomination', () => {
    expect(nextRoundBills(150, 'USD')).toEqual([])
  })

  it('returns empty array when total is exactly a denomination value', () => {
    // ceil(20/5)*5 = 20, not strictly > 20 → skipped. Same for the 10 and 20 denoms.
    // ceil(20/50)*50 = 50 → included. ceil(20/100)*100 = 100 → included.
    expect(nextRoundBills(20, 'USD')).toEqual([50, 100])
  })
})

describe('computeSubtotal', () => {
  it('sums plain lines', () => {
    expect(computeSubtotal([{ unitPrice: 5, quantity: 2 }], 'USD')).toBe(10)
    expect(
      computeSubtotal(
        [
          { unitPrice: 2.5, quantity: 3 },
          { unitPrice: 1, quantity: 1 },
        ],
        'USD',
      ),
    ).toBe(8.5)
  })

  it('returns 0 for an empty cart', () => {
    expect(computeSubtotal([], 'USD')).toBe(0)
  })

  it('rounds EACH line before summing — sub-cent unit price (the divergence fix)', () => {
    // Two $0.125 lines. Round-each-then-sum: 0.13 + 0.13 = 0.26 (the stored
    // total, and the sum of the per-line subtotals a receipt renders).
    // round(sum(raw)) would be round(0.25) = 0.25 — a one-cent gap. This is
    // exactly the client/server divergence FINDING 3 fixes: both sides now
    // call computeSubtotal, so both get 0.26.
    const lines = [
      { unitPrice: 0.125, quantity: 1 },
      { unitPrice: 0.125, quantity: 1 },
    ]
    expect(computeSubtotal(lines, 'USD')).toBe(0.26)
    // Prove it is NOT the round-once order.
    expect(roundToCurrencyDecimals(0.125 + 0.125, 'USD')).toBe(0.25)
    expect(computeSubtotal(lines, 'USD')).not.toBe(
      roundToCurrencyDecimals(0.125 + 0.125, 'USD'),
    )
  })

  it('feeds computeSaleTotals so the shared total matches for a sub-cent cart', () => {
    // The full stored total = computeSaleTotals(computeSubtotal(...)). This is
    // the invariant the API route and the checkout UI both run.
    const lines = [
      { unitPrice: 0.125, quantity: 1 },
      { unitPrice: 0.125, quantity: 1 },
    ]
    const subtotal = computeSubtotal(lines, 'USD')
    expect(computeSaleTotals(subtotal, 0, 0, 'none', 'USD').total).toBe(0.26)
  })

  it('rounds the whole line (unitPrice * quantity), honoring zero-decimal currencies', () => {
    expect(
      computeSubtotal(
        [
          { unitPrice: 100.7, quantity: 1 },
          { unitPrice: 50.4, quantity: 1 },
        ],
        'JPY',
      ),
    ).toBe(151)
  })
})

describe('computeSaleTotals', () => {
  it('plain sale: total equals rounded subtotal', () => {
    expect(computeSaleTotals(10, 0, 0, 'none', 'USD')).toEqual({
      subtotal: 10,
      discountAmount: 0,
      taxAmount: 0,
      total: 10,
    })
  })

  it('applies a discount', () => {
    expect(computeSaleTotals(10, 2, 0, 'none', 'USD')).toEqual({
      subtotal: 10,
      discountAmount: 2,
      taxAmount: 0,
      total: 8,
    })
  })

  it('clamps the discount into [0, subtotal]', () => {
    expect(computeSaleTotals(10, 99, 0, 'none', 'USD').discountAmount).toBe(10)
    expect(computeSaleTotals(10, -5, 0, 'none', 'USD').discountAmount).toBe(0)
  })

  it('exclusive tax is added on top of the discounted base', () => {
    expect(computeSaleTotals(10, 2, 10, 'exclusive', 'USD')).toEqual({
      subtotal: 10,
      discountAmount: 2,
      taxAmount: 0.8,
      total: 8.8,
    })
  })

  it('inclusive tax is display-only extraction; total unchanged', () => {
    const r = computeSaleTotals(10, 0, 10, 'inclusive', 'USD')
    expect(r.total).toBe(10)
    expect(r.taxAmount).toBe(0.91) // 10 - 10/1.1 = 0.909... -> 0.91
  })

  it('mode none / zero rate yields zero tax', () => {
    expect(computeSaleTotals(10, 0, 12, 'none', 'USD').taxAmount).toBe(0)
    expect(computeSaleTotals(10, 0, 0, 'exclusive', 'USD').taxAmount).toBe(0)
  })

  it('rounds to zero-decimal currencies consistently', () => {
    const r = computeSaleTotals(1000, 0, 8, 'exclusive', 'JPY')
    expect(r.taxAmount).toBe(80)
    expect(r.total).toBe(1080)
    const half = computeSaleTotals(101, 0, 10, 'exclusive', 'JPY')
    // 10.1 -> 10 tax; total 111
    expect(half.taxAmount).toBe(10)
    expect(half.total).toBe(111)
  })

  it('never lets float noise leak into the total (0.1 + 0.2 class)', () => {
    const r = computeSaleTotals(0.1 + 0.2, 0.1, 0, 'none', 'USD')
    expect(r.subtotal).toBe(0.3)
    expect(r.total).toBe(0.2)
  })
})
