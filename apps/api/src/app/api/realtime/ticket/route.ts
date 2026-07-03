import { withAuth, successResponse } from '@/lib/api-middleware'
import { mintSseTicket } from '@/lib/native-token-store'

/**
 * SSE connect-ticket mint (FINDING 2).
 *
 * EventSource cannot set an Authorization header, so the native app used
 * to pass its bearer SESSION token as `?token=` on the SSE URL — which
 * lands, verbatim, in infra request logs. Instead, an authenticated
 * client POSTs here (POST DOES allow the bearer header) to mint a
 * short-lived (30s) single-use ticket bound to its userId, then opens
 * `/api/realtime?ticket=...`. The realtime route consumes (get+delete)
 * the ticket and resolves the user — the raw session token never touches
 * a URL, and the ticket is never logged.
 *
 * `withAuth` resolves the session from either the cookie (web) or the
 * bearer header (native), enforces the same-origin CSRF check (native
 * origins allow-listed), and applies the standard per-user + per-IP
 * mutation rate limits. Web keeps its cookie SSE flow and never calls
 * this endpoint; it is harmless if it does.
 */
export const POST = withAuth(async (_request, user) => {
  const ticket = await mintSseTicket(user.userId)
  return successResponse({ ticket })
})
