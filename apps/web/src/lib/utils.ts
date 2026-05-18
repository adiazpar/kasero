/**
 * Format a monetary amount using the given locale and currency.
 *
 * Uses `Intl.NumberFormat`, which already knows per-currency decimal
 * conventions (e.g., CLP / COP / PYG are integer-only, USD / EUR use 2
 * decimals). Locale drives the decimal separator, thousand separator,
 * and symbol position. `currencyDisplay: 'narrowSymbol'` strips the
 * disambiguator prefix locals don't write — a Canadian business sees
 * "$5.00", not "CA$5.00".
 *
 * Callers should generally go through `useBusinessFormat()` instead,
 * which binds the current business's locale and currency automatically.
 * This lower-level helper is exposed for non-React code paths.
 */
export function formatCurrency(
  amount: number,
  locale: string = 'en-US',
  currency: string = 'USD',
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  }).format(amount)
}

/**
 * Format a monetary amount in compact notation for space-constrained
 * surfaces (bar charts, stat tiles, tight card labels).
 *
 * Small values render normally — "$420", "S/ 68" — while large values
 * collapse into the locale's compact form: "$1.2K", "$3.4M", "S/ 1,2 mil".
 * Fractional digits are clamped to at most 1 to avoid strings like
 * "$1.234K". Zero-decimal currencies (CLP, COP, etc.) remain integer.
 *
 * Callers should generally go through `useBusinessFormat()` instead.
 */
export function formatCurrencyCompact(
  amount: number,
  locale: string = 'en-US',
  currency: string = 'USD',
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(amount)
}

/**
 * Format a date in the given locale. Uses the browser's local timezone,
 * which is correct for the vast majority of cases (user's phone time =
 * business physical location time).
 *
 * A "YYYY-MM-DD" string (e.g. an HTML date-input value) is treated as
 * that calendar day in the local timezone — not UTC midnight. Passing
 * it to `new Date(str)` would otherwise parse per the ECMAScript spec
 * as UTC, which shifts the displayed day by one for any locale east or
 * west of UTC.
 *
 * Year is rendered as 2 digits ("26") to keep list rows compact; the
 * underlying data still holds the full year, so callers that power
 * search (e.g. the orders tab) can use `d.getFullYear()` to keep
 * 4-digit queries matching.
 */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

export function formatDate(
  date: Date | string,
  locale: string = 'en-US',
): string {
  let d: Date
  if (typeof date === 'string') {
    if (DATE_ONLY_RE.test(date)) {
      const [y, m, day] = date.split('-').map(Number)
      d = new Date(y, m - 1, day)
    } else {
      d = new Date(date)
    }
  } else {
    d = date
  }
  return new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
  }).format(d)
}

/**
 * Format a time in the given locale. Uses browser local timezone.
 */
export function formatTime(
  date: Date | string,
  locale: string = 'en-US',
): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

// ============================================
// PRODUCT UTILITIES
// ============================================

/**
 * Get product icon from a product
 * The icon is stored as a base64 data URL (data:image/png;base64,...)
 *
 * @param product - Product with optional icon
 * @returns The icon data URL or null
 */
export function getProductIconUrl(
  product: { icon?: string | null },
): string | null {
  if (!product.icon) return null
  return product.icon
}

/**
 * Check if a string is a base64 data URL
 */
export function isBase64DataUrl(str: string): boolean {
  return str.startsWith('data:image/')
}
