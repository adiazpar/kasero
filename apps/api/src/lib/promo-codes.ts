/**
 * PRO_PROMO_CODES parsing + calendar-month date math for the Kasero Pro
 * promo redemption route. Pure helpers (no server-only import) so they
 * stay unit-testable without the Next.js runtime.
 *
 * Env format: comma-separated `CODE:months` entries, e.g.
 *   PRO_PROMO_CODES=LAUNCHCREW:12,BETATHANKS:3
 * Codes match case-insensitively; whitespace around entries, codes and
 * month counts is tolerated. Malformed entries are skipped (never let a
 * typo in one entry take down the whole namespace).
 */

const MAX_PROMO_MONTHS = 120

export function parsePromoCodes(raw: string | undefined | null): Map<string, number> {
  const codes = new Map<string, number>()
  if (!raw) return codes
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim()
    if (!trimmed) continue
    const sep = trimmed.lastIndexOf(':')
    if (sep <= 0) continue
    const code = trimmed.slice(0, sep).trim().toUpperCase()
    const months = Number(trimmed.slice(sep + 1).trim())
    if (!code || !Number.isInteger(months) || months <= 0 || months > MAX_PROMO_MONTHS) {
      continue
    }
    codes.set(code, months)
  }
  return codes
}

/**
 * Add N calendar months to a date, clamping the day-of-month to the
 * target month's length (Jan 31 + 1 month = Feb 28/29, not Mar 2/3).
 * Operates in UTC so the grant length never shifts with server TZ.
 */
export function addCalendarMonths(base: Date, months: number): Date {
  const d = new Date(base.getTime())
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const daysInTargetMonth = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate()
  d.setUTCDate(Math.min(day, daysInTargetMonth))
  return d
}
