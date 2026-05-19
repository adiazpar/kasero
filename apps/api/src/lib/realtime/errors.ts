/**
 * Thrown by realtime helpers when Upstash is unreachable in a critical
 * path. The SSE route translates to a 503 with REALTIME_UNAVAILABLE;
 * a publishCriticalToUser caller translates to 503 with
 * REALTIME_PUBLISH_UNAVAILABLE. Mirrors UpstashUnavailableError in
 * apps/api/src/lib/rate-limit.ts.
 */
export class RealtimeUnavailableError extends Error {
  constructor(message = 'Upstash realtime unavailable') {
    super(message)
    this.name = 'RealtimeUnavailableError'
  }
}
