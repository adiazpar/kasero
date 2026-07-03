/**
 * Currency-aware math helpers for the sales feature.
 *
 * Keep this file pure (no React, no DB). All inputs are primitives,
 * outputs are primitives — easy to test, easy to reason about.
 */

// ISO 4217 zero-decimal currencies. Display and storage both use 0 decimals.
const ZERO_DECIMAL_CURRENCIES = new Set(['CLP', 'JPY', 'KRW', 'VND', 'XAF', 'XOF', 'XPF'])

export function decimalsForCurrency(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2
}

/**
 * Round a number to the appropriate number of decimals for the given
 * currency. Uses Math.round (banker's rounding NOT used) to match the
 * rounding orders/route.ts already does for `subtotal`.
 */
export function roundToCurrencyDecimals(value: number, currency: string): number {
  const decimals = decimalsForCurrency(currency)
  const factor = Math.pow(10, decimals)
  return Math.round(value * factor) / factor
}

/** Minimal shape a checkout line needs for subtotal math. */
export interface SaleLineInput {
  unitPrice: number
  quantity: number
}

/**
 * Canonical checkout subtotal — THE authoritative rounding order.
 *
 * INVARIANT (round-each-line-then-sum): round every line's
 * `unitPrice * quantity` to the currency's decimals FIRST, sum those
 * rounded line subtotals, then round the sum (a no-op at precision, but it
 * scrubs float noise). Both the API route that STORES the sale total and
 * the cart/payment UI that DISPLAYS it call this one function, so the
 * number the customer sees is byte-for-byte the number the server persists.
 *
 * Why per-line-then-sum and not round(sum(raw)): the sale total is not
 * stored alongside a per-line subtotal column — line subtotals are
 * recomputed on read as round(unitPrice * quantity) (see GET /sales). This
 * order makes the sum of those displayed line subtotals equal the stored
 * total exactly, so a receipt never shows a one-cent reconciliation gap.
 * round(sum(raw)) diverges by a cent for sub-cent unit prices (e.g. two
 * lines of 1.005: round(1.01+1.01)=2.02 vs round(2.01)=2.01). Do NOT
 * change this order without changing how line subtotals are stored/shown.
 */
export function computeSubtotal(
  lines: readonly SaleLineInput[],
  currency: string,
): number {
  const summed = lines.reduce(
    (acc, line) => acc + roundToCurrencyDecimals(line.unitPrice * line.quantity, currency),
    0,
  )
  return roundToCurrencyDecimals(summed, currency)
}

export type SaleTaxMode = 'none' | 'inclusive' | 'exclusive'

export interface SaleTotals {
  /** Rounded sum of line subtotals, before discount. */
  subtotal: number
  /** Discount actually applied (rounded, clamped to [0, subtotal]). */
  discountAmount: number
  /** Tax amount (added for 'exclusive', extracted for 'inclusive', 0 for 'none'). */
  taxAmount: number
  /** Final charged total: subtotal - discount (+ tax when 'exclusive'). */
  total: number
}

/**
 * Single source of truth for checkout math — used by BOTH the API route
 * (authoritative) and the cart/payment UI (display) so the number the
 * customer sees is the number the server stores.
 *
 *   base = round(subtotal - discount)
 *   exclusive: tax = round(base * rate/100), total = round(base + tax)
 *   inclusive: total = base, tax = round(base - base / (1 + rate/100))
 *              (display-only extraction — the charged amount is unchanged)
 *   none:      tax = 0, total = base
 *
 * All intermediate values are rounded half-up to the currency's decimals
 * via roundToCurrencyDecimals so server and client can never disagree by
 * a floating-point hair.
 */
export function computeSaleTotals(
  rawSubtotal: number,
  rawDiscount: number,
  taxRate: number,
  taxMode: SaleTaxMode,
  currency: string,
): SaleTotals {
  const subtotal = roundToCurrencyDecimals(rawSubtotal, currency)
  const discountAmount = roundToCurrencyDecimals(
    Math.min(Math.max(rawDiscount, 0), subtotal),
    currency,
  )
  const base = roundToCurrencyDecimals(subtotal - discountAmount, currency)

  const rate = Number.isFinite(taxRate) && taxRate > 0 ? taxRate : 0
  if (taxMode === 'exclusive' && rate > 0) {
    const taxAmount = roundToCurrencyDecimals(base * (rate / 100), currency)
    return {
      subtotal,
      discountAmount,
      taxAmount,
      total: roundToCurrencyDecimals(base + taxAmount, currency),
    }
  }
  if (taxMode === 'inclusive' && rate > 0) {
    const taxAmount = roundToCurrencyDecimals(base - base / (1 + rate / 100), currency)
    return { subtotal, discountAmount, taxAmount, total: base }
  }
  return { subtotal, discountAmount, taxAmount: 0, total: base }
}

/**
 * Midnight UTC of the same calendar day as `d`. Used as the lower bound
 * for "today" stats queries.
 *
 * Limitation acknowledged in the design spec: this uses server UTC, not
 * the business's locale timezone. v1.1 will switch to locale-aware buckets.
 */
export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/**
 * Midnight UTC of the day before `d`.
 */
export function startOfPrevUtcDay(d: Date): Date {
  const start = startOfUtcDay(d)
  start.setUTCDate(start.getUTCDate() - 1)
  return start
}

/**
 * Expected cash in the drawer at session close: starting float plus all
 * cash-payment-method sales. Rounded to currency decimals so the value
 * matches the cashier's mental model (no $230.0000000004).
 */
export function computeExpectedCash(
  startingCash: number,
  cashSalesTotal: number,
  currency: string,
): number {
  return roundToCurrencyDecimals(startingCash + cashSalesTotal, currency)
}

/**
 * Variance between the cashier's counted cash and the expected cash.
 * Negative = drawer short, positive = drawer over, 0 = reconciled.
 */
export function computeVariance(
  countedCash: number,
  expectedCash: number,
  currency: string,
): number {
  return roundToCurrencyDecimals(countedCash - expectedCash, currency)
}

const BILL_DENOMS_BY_CURRENCY: Record<string, number[]> = {
  USD: [5, 10, 20, 50, 100],
  PEN: [10, 20, 50, 100, 200],
  JPY: [1000, 5000, 10000],
  CLP: [1000, 5000, 10000, 20000],
}

/**
 * Returns up to 4 unique "round-up" bill amounts strictly greater than `total`,
 * derived from a per-currency denomination set. Used to render the cash
 * quick-fill buttons in the cart payment step. Falls back to USD denoms for
 * unknown currencies. Returns an empty array when the total is at or above
 * every denomination in the set.
 */
export function nextRoundBills(total: number, currency: string): number[] {
  const denoms =
    BILL_DENOMS_BY_CURRENCY[currency.toUpperCase()] ??
    BILL_DENOMS_BY_CURRENCY.USD
  // When the total exceeds every denomination, the loop would still push
  // Math.ceil(total/d)*d for each d (a value strictly above total), which
  // isn't useful for picking a single bill the customer actually handed
  // over. Bail out so the UI falls back to "Exact" + free-form input.
  const maxDenom = denoms[denoms.length - 1]
  if (total > maxDenom) return []
  const result: number[] = []
  for (const d of denoms) {
    const rounded = Math.ceil(total / d) * d
    if (rounded > total && !result.includes(rounded)) result.push(rounded)
    if (result.length >= 4) break
  }
  return result
}
