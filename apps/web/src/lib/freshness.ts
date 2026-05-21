// Freshness window for the per-business data caches in
// products-context.tsx and similar context files.
//
// Within the window: ensureLoaded() returns cached data without a network
// call. Outside the window: cached data is returned immediately AND a
// background refetch fires (silent stale-while-revalidate).
//
// 30 seconds is short enough that returning to a tab after a meaningful
// gap revalidates, but long enough that flicking between tabs doesn't
// hammer the API.
export const STALE_AFTER_MS = 30_000

// True if `lastFetchedAt` is non-null AND less than `windowMs` ago. False
// for null (never fetched), beyond the window, or in the future (clock
// skew — treat as stale to avoid false positives).
export function isFresh(
  lastFetchedAt: number | null,
  now: number,
  windowMs: number = STALE_AFTER_MS,
): boolean {
  if (lastFetchedAt === null) return false
  const age = now - lastFetchedAt
  if (age < 0) return false
  return age < windowMs
}
