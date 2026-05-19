import 'server-only'
import { getPublisher } from './redis'
import { RealtimeUnavailableError } from './errors'
import {
  businessChannel,
  userChannel,
  userStream,
  type BusinessRealtimeEvent,
  type UserRealtimeEvent,
  type CriticalUserRealtimeEvent,
} from '@kasero/shared/realtime'

const STREAM_MAXLEN = 100
const STREAM_TTL_MS = 90 * 24 * 60 * 60 * 1000 // 90 days

/**
 * Fire-and-forget publish on business:{id}. Fail-open: a warning is
 * logged and the function resolves. Calling routes never break on a
 * non-critical Upstash blip — focus refetch backs up missed events.
 */
export async function publishToBusiness(
  businessId: string,
  event: BusinessRealtimeEvent,
  originDeviceId?: string,
): Promise<void> {
  const payload = { ...event, ...(originDeviceId ? { originDeviceId } : {}) }
  try {
    await getPublisher().publish(businessChannel(businessId), JSON.stringify(payload))
  } catch (err) {
    console.warn('[realtime.publisher] publishToBusiness failed for', businessId, err)
  }
}

/**
 * Fire-and-forget publish on user:{id}. Fail-open identical to
 * publishToBusiness.
 */
export async function publishToUser(
  userId: string,
  event: UserRealtimeEvent,
  originDeviceId?: string,
): Promise<void> {
  const payload = { ...event, ...(originDeviceId ? { originDeviceId } : {}) }
  try {
    await getPublisher().publish(userChannel(userId), JSON.stringify(payload))
  } catch (err) {
    console.warn('[realtime.publisher] publishToUser failed for', userId, err)
  }
}

/**
 * Critical publish: append to the user's stream (cap=100), PUBLISH on
 * the user channel, and refresh the stream's 90-day TTL — all in a
 * single MULTI/EXEC. Fail-CLOSED: throws RealtimeUnavailableError so
 * the calling route returns 503 REALTIME_PUBLISH_UNAVAILABLE.
 */
export async function publishCriticalToUser(
  userId: string,
  event: CriticalUserRealtimeEvent,
  originDeviceId?: string,
): Promise<void> {
  const payload = { ...event, ...(originDeviceId ? { originDeviceId } : {}) }
  const json = JSON.stringify(payload)
  const stream = userStream(userId)
  const channel = userChannel(userId)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pub = getPublisher() as any
    const exec = pub
      .multi()
      .xadd(stream, 'MAXLEN', STREAM_MAXLEN, '*', 'type', event.type, 'payload', json)
      .publish(channel, json)
      .pexpire(stream, STREAM_TTL_MS)
      .exec()
    const result = await exec
    if (!result) throw new RealtimeUnavailableError('MULTI/EXEC returned null')
    // Each entry is [err, value]; treat any non-null err as failure.
    for (const [err] of result as Array<[Error | null, unknown]>) {
      if (err) throw new RealtimeUnavailableError(`pipeline step failed: ${err.message}`)
    }
  } catch (err) {
    if (err instanceof RealtimeUnavailableError) throw err
    console.warn('[realtime.publisher] publishCriticalToUser failed for', userId, err)
    throw new RealtimeUnavailableError()
  }
}

/**
 * Pipelined PUBLISH to many user channels in a single round-trip.
 * Used by business rename (publish business.list.changed to every
 * member) and business delete (publish session.revoked siblings).
 * Fail-open: log + resolve.
 */
export async function publishBatchedToUsers(
  userIds: string[],
  event: UserRealtimeEvent,
  originDeviceId?: string,
): Promise<void> {
  if (userIds.length === 0) return
  const payload = { ...event, ...(originDeviceId ? { originDeviceId } : {}) }
  const json = JSON.stringify(payload)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (getPublisher() as any).pipeline()
    for (const userId of userIds) {
      p.publish(userChannel(userId), json)
    }
    await p.exec()
  } catch (err) {
    console.warn('[realtime.publisher] publishBatchedToUsers failed', err)
  }
}
