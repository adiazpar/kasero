import 'server-only'
import { getSubscriber } from './redis'
import { userStream } from '@kasero/shared/realtime'
import type { CriticalUserRealtimeEvent } from '@kasero/shared/realtime'

/**
 * Stream replay helpers backed by the unified RealtimeSubscriber surface.
 *
 * Both backends (in-memory dev, ioredis prod) expose `xread` and
 * `getStreamTipId` on the subscriber with high-level shapes:
 *   xread(streamKey, sinceId) → Array<{ id, event }>
 *   getStreamTipId(streamKey) → string | null
 *
 * We no longer touch ioredis pipelines or raw XREAD/XREVRANGE response
 * shapes here — the wrapper in redis.ts owns that parsing.
 */
export interface ReplayEntry {
  id: string
  event: CriticalUserRealtimeEvent
}

/**
 * Read entries with id strictly greater than `lastEventId`. Used by the
 * SSE handler on reconnect to replay critical events the client missed.
 */
export async function readUserStreamSince(
  userId: string,
  lastEventId: string,
): Promise<ReplayEntry[]> {
  const sub = getSubscriber()
  const entries = await sub.xread(userStream(userId), lastEventId)
  return entries.map((e) => ({
    id: e.id,
    event: e.event as unknown as CriticalUserRealtimeEvent,
  }))
}

/**
 * Tip of the user's critical stream. Returns '0-0' on empty streams so
 * callers can use the value unconditionally as a Last-Event-ID hint
 * (the SSE handler emits a `system.resync` carrying this id on first
 * connect, so the next reconnect's XREAD returns everything that was
 * added in between).
 */
export async function getUserStreamTip(userId: string): Promise<string> {
  const sub = getSubscriber()
  const tip = await sub.getStreamTipId(userStream(userId))
  return tip ?? '0-0'
}
