import 'server-only'
import { getPublisher } from './redis'
import { userStream } from '@kasero/shared/realtime'
import type { CriticalUserRealtimeEvent } from '@kasero/shared/realtime'

/**
 * XREAD COUNT 100 STREAMS stream:user:{userId} <lastEventId>
 *
 * Returns entries with id STRICTLY GREATER than lastEventId. ioredis
 * XREAD result shape:
 *   [ [streamName, [ [id, [field1, val1, ...]] , ... ]] ]
 *   or null when no entries match (note: synchronous XREAD with no
 *   BLOCK arg returns null on empty).
 */
export interface ReplayEntry {
  id: string
  event: CriticalUserRealtimeEvent
}

export async function readUserStreamSince(
  userId: string,
  lastEventId: string,
): Promise<ReplayEntry[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pub = getPublisher() as any
  const result = (await pub.xread(
    'COUNT', 100,
    'STREAMS', userStream(userId), lastEventId,
  )) as Array<[string, Array<[string, string[]]>]> | null
  if (!result || result.length === 0) return []
  const [, entries] = result[0]
  const out: ReplayEntry[] = []
  for (const [id, fields] of entries) {
    // fields = ['type', '<type>', 'payload', '<json>'] — defensive parse.
    const map = new Map<string, string>()
    for (let i = 0; i < fields.length; i += 2) {
      map.set(fields[i], fields[i + 1])
    }
    const payloadRaw = map.get('payload')
    if (!payloadRaw) continue
    try {
      const event = JSON.parse(payloadRaw) as CriticalUserRealtimeEvent
      out.push({ id, event })
    } catch (err) {
      console.warn('[realtime.streams] dropping unparseable entry', id, err)
    }
  }
  return out
}

/**
 * XREVRANGE stream:user:{id} + - COUNT 1 -> the latest entry's id.
 * Returns '0-0' if the stream is empty so callers can use the value
 * unconditionally as a Last-Event-ID hint.
 */
export async function getUserStreamTip(userId: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pub = getPublisher() as any
  const result = (await pub.xrevrange(
    userStream(userId), '+', '-', 'COUNT', 1,
  )) as Array<[string, string[]]>
  if (!result || result.length === 0) return '0-0'
  return result[0][0]
}
