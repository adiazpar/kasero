/**
 * Locale-aware decimal parsing, factored out of the currency-only
 * `PriceInput` so non-currency number fields (tax rate %, discount %) also
 * accept the business locale's decimal separator. A German/French/Spanish
 * business types "8,5"; a naive `replace(/[^0-9.]/g, '')` would turn that
 * into "85". These helpers turn it into the canonical "8.5" that a plain
 * `parseFloat` understands.
 */

// Derive decimal/group separators from the active locale via
// Intl.NumberFormat so they match every other number rendered in the app
// (identical to PriceInput's own getSeparators).
export function getLocaleSeparators(locale: string): { decimal: string; group: string } {
  const parts = new Intl.NumberFormat(locale).formatToParts(1234.5)
  const decimal = parts.find((p) => p.type === 'decimal')?.value ?? '.'
  const group = parts.find((p) => p.type === 'group')?.value ?? ','
  return { decimal, group }
}

/**
 * Sanitize a locale-typed number string into a canonical string: digits
 * plus at most one '.' decimal point, no group separators. Preserves a
 * trailing decimal ("8." while mid-typing) so entry feels natural. Running
 * `parseFloat` on the result yields the correct number regardless of the
 * user's locale separators — "8,5" -> "8.5", de-DE "1.234,5" -> "1234.5".
 */
export function sanitizeDecimalInput(raw: string, locale: string): string {
  if (!raw) return ''
  const { decimal, group } = getLocaleSeparators(locale)
  // Drop group separators, convert every locale decimal to '.'.
  let clean = raw.split(group).join('').split(decimal).join('.')
  // Keep only digits and dots.
  clean = clean.replace(/[^0-9.]/g, '')
  // Collapse to a single decimal point (the first one wins).
  const firstDot = clean.indexOf('.')
  if (firstDot !== -1) {
    clean = clean.slice(0, firstDot + 1) + clean.slice(firstDot + 1).replace(/\./g, '')
  }
  return clean
}
