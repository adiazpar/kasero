import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { requireBusinessAccessForRealtime } from '@/lib/business-auth'
import {
  subscribe as brokerSubscribe,
  getUserStreamTip,
  readUserStreamSince,
} from '@/lib/realtime'
import {
  businessChannel,
  userChannel,
  type RealtimeEvent,
} from '@kasero/shared/realtime'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { checkRateLimit, RateLimits } from '@/lib/rate-limit'
import { logServerError } from '@/lib/server-logger'

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'
export const preferredRegion = 'iad1'

// ============================================
// CSRF for SSE
// ============================================
// EventSource is a same-origin GET. Modern browsers set Sec-Fetch-Site
// automatically. Absent => non-browser client; reject. As a fallback
// we also accept an Origin that matches Host (covers older Safari).
function isSameOrigin(req: NextRequest): boolean {
  const sfs = req.headers.get('sec-fetch-site')
  if (sfs === 'same-origin') return true
  const origin = req.headers.get('origin')
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (origin && host) {
    try {
      const parsed = new URL(origin)
      return parsed.host === host
    } catch {
      return false
    }
  }
  return false
}

function jsonError(code: ApiMessageCode, status: number, retryAfterSeconds?: number): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (retryAfterSeconds != null) headers['retry-after'] = String(retryAfterSeconds)
  return new Response(JSON.stringify({ messageCode: code }), { status, headers })
}

// SSE frame builder. event: <type>, id: <id>, data: <json>.
function frame(event: RealtimeEvent, id?: string): string {
  let out = ''
  if (id) out += `id: ${id}\n`
  out += `event: ${event.type}\n`
  out += `data: ${JSON.stringify(event)}\n\n`
  return out
}

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session) return jsonError(ApiMessageCode.UNAUTHORIZED, 401)

    if (!isSameOrigin(request)) return jsonError(ApiMessageCode.FORBIDDEN, 403)

    const url = new URL(request.url)
    const businessId = url.searchParams.get('businessId') ?? null
    if (businessId) {
      const granted = await requireBusinessAccessForRealtime(session.user.id, businessId)
      if (!granted) return jsonError(ApiMessageCode.FORBIDDEN, 403)
    }

    // Rate-limit reconnect storms per user. Uses a dedicated, generous
    // budget (60/min) rather than userMutation (30/min) because legitimate
    // EventSource reconnects every ~5 min × N devices can otherwise share
    // a window with interactive mutations and starve one or the other.
    const rl = await checkRateLimit(`realtime:${session.user.id}`, RateLimits.realtimeConnect)
    if (!rl.success) {
      const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))
      return jsonError(ApiMessageCode.RATE_LIMITED, 429, retryAfter)
    }

    const lastEventId = request.headers.get('last-event-id')
    const encoder = new TextEncoder()
    const userId = session.user.id

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const cleanupFns: Array<() => void> = []
        let closed = false
        const safeEnqueue = (chunk: string) => {
          if (closed) return
          try {
            controller.enqueue(encoder.encode(chunk))
          } catch {
            closed = true
          }
        }
        const close = () => {
          if (closed) return
          closed = true
          for (const fn of cleanupFns) {
            try { fn() } catch { /* swallow */ }
          }
          try { controller.close() } catch { /* already closed */ }
        }

        // First-connect vs reconnect.
        try {
          if (!lastEventId) {
            const tip = await getUserStreamTip(userId)
            safeEnqueue(frame({ type: 'system.resync' }, tip))
          } else {
            const replayed = await readUserStreamSince(userId, lastEventId)
            for (const entry of replayed) {
              safeEnqueue(frame(entry.event, entry.id))
            }
            if (replayed.length === 0) {
              // Nothing to replay but reconnect happened — emit resync so client refetches.
              safeEnqueue(frame({ type: 'system.resync' }, lastEventId))
            }
          }
        } catch (err) {
          logServerError('api.realtime.replay', err)
          safeEnqueue(frame({ type: 'system.error', code: ApiMessageCode.REALTIME_UNAVAILABLE }))
          close()
          return
        }

        // User-channel subscription.
        cleanupFns.push(
          brokerSubscribe(userChannel(userId), (payload) => {
            if (payload && typeof payload === 'object' && '__resync__' in payload) {
              safeEnqueue(frame({ type: 'system.resync' }))
              return
            }
            const event = payload as RealtimeEvent
            safeEnqueue(frame(event))
          }),
        )

        // Business-channel subscription (optional).
        if (businessId) {
          cleanupFns.push(
            brokerSubscribe(businessChannel(businessId), (payload) => {
              if (payload && typeof payload === 'object' && '__resync__' in payload) {
                safeEnqueue(frame({ type: 'system.resync' }))
                return
              }
              const event = payload as RealtimeEvent
              safeEnqueue(frame(event))
            }),
          )
        }

        // Heartbeat every 15s. Comment-only frame; clients reset their
        // watchdog timer on any bytes received.
        //
        // CRITICAL: do NOT call hb.unref(). In Vercel Fluid Compute, once
        // the ReadableStream's start() callback returns, the function's
        // event loop only has ref'd timers / pending I/O to stay alive.
        // The HTTP response stream itself is owned by the runtime and
        // doesn't ref the loop. If we unref the heartbeat, the function
        // drains immediately after start() finishes — Vercel ends the
        // request, EventSource sees a 0.1 kB completed response, and
        // reconnects ~170 times/minute. The unref'd version blew past
        // even the dedicated 60/min realtime rate-limit budget.
        // Keep the timer ref'd; the route's maxDuration: 300 caps the
        // process lifetime cleanly regardless.
        const hb = setInterval(() => {
          safeEnqueue(`:hb\n\n`)
        }, 15_000)
        cleanupFns.push(() => clearInterval(hb))

        // Abort handling.
        const onAbort = () => { close() }
        request.signal.addEventListener('abort', onAbort, { once: true })
        cleanupFns.push(() => request.signal.removeEventListener('abort', onAbort))
      },
    })

    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        'connection': 'keep-alive',
        'x-accel-buffering': 'no',
      },
    })
  } catch (err) {
    logServerError('api.realtime.GET', err)
    return jsonError(ApiMessageCode.INTERNAL_ERROR, 500)
  }
}
