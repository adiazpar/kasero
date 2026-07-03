/**
 * Native (Capacitor) SSE connect-ticket fetch.
 *
 * EventSource cannot set an Authorization header, so the native client
 * can't attach its bearer token to the realtime GET — and we refuse to
 * put the raw session token in the URL (it lands in infra logs). Instead
 * it POSTs here first (the bearer header is auto-attached by api-client)
 * to mint a short-lived single-use ticket, then opens
 * `/api/realtime?ticket=...`.
 *
 * Web never calls this — it authenticates the SSE stream with its session
 * cookie. `apiPost` auto-attaches the bearer token and resolves the API
 * origin, so this is native-only by construction.
 */

import { apiPost, type ApiResponse } from '@/lib/api-client'

interface TicketResponse extends ApiResponse {
  ticket?: string
}

/**
 * Mint an SSE connect ticket. Returns the ticket string, or null if the
 * mint failed (offline, auth lapsed, rate-limited) — the caller then skips
 * opening the stream and lets the realtime watchdog retry.
 */
export async function fetchRealtimeTicket(): Promise<string | null> {
  try {
    const res = await apiPost<TicketResponse>('/api/realtime/ticket', {})
    return typeof res.ticket === 'string' ? res.ticket : null
  } catch {
    return null
  }
}
