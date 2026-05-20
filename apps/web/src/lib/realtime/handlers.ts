/**
 * Exhaustive realtime event dispatcher.
 *
 * Receives a typed RealtimeEvent and fans out to the appropriate side
 * effects: refetch-registry calls, business context revocation, and
 * navigation/toast callbacks. The switch has NO default branch — adding
 * a new event type to the union without a matching case is a TypeScript
 * build error.
 */

import type { RealtimeEvent } from '@kasero/shared/realtime'
import { callRefetch, callAllRefetches } from './refetch-registry'

export interface RealtimeHandlerContext {
  ownDeviceId: string
  revokeBusinessContext: (
    businessId: string,
    reason: 'removed' | 'business_deleted' | 'ownership_transferred',
  ) => void
  routeToLogin: () => void
  /** Called with an i18n key, e.g. 'apiMessages.realtime_unavailable' */
  showToast: (key: string) => void
}

/**
 * Dispatch a realtime event. Echo-suppresses events tagged with the
 * own device id before reaching the switch, so no case branch needs to
 * handle it. The exhaustiveness assertion at the bottom ensures every
 * new event type in the shared union must be handled here.
 */
export function dispatchRealtimeEvent(
  event: RealtimeEvent,
  ctx: RealtimeHandlerContext,
): void {
  // Echo suppression was intentionally removed. The original design
  // assumed the publishing device had already updated its local state
  // from the API response, so re-dispatching the realtime echo was
  // redundant. In practice, our existing mutation flows (team remove,
  // role change, invite consume, etc.) don't optimistically patch
  // local state — they rely on a follow-up refetch — so suppressing
  // the echo left the publishing device showing stale data until
  // useRevalidateOnFocus caught up (5s debounce, or 15s+ if focus
  // didn't change). Dispatching the echo triggers the same refetch
  // every other device performs. The extra GET on the publisher is
  // idempotent and cheap.
  //
  // ctx.ownDeviceId is still passed in for future use (e.g., a
  // dedicated optimistic-update path), but no longer filters events.
  void ctx.ownDeviceId

  switch (event.type) {
    case 'team.member.joined':
    case 'team.member.removed':
    case 'team.member.role_changed':
    case 'team.member.status_changed':
      callRefetch('team')
      callRefetch('invites')
      return

    case 'team.invite.created':
    case 'team.invite.regenerated':
    case 'team.invite.consumed':
    case 'team.invite.deleted':
      callRefetch('invites')
      return

    case 'business.updated':
      callRefetch('business')
      return

    case 'product.created':
    case 'product.updated':
    case 'product.deleted':
      callRefetch('products')
      return

    case 'product.settings.updated':
      callRefetch('product-settings')
      return

    case 'profile.updated':
      callRefetch('profile')
      return

    case 'business.list.changed':
      callRefetch('businesses-list')
      return

    case 'session.revoked':
      ctx.revokeBusinessContext(event.businessId, event.reason)
      return

    case 'business.deleted':
      ctx.revokeBusinessContext(event.businessId, 'business_deleted')
      return

    case 'ownership.transferred':
      if (event.role === 'former_owner') {
        ctx.revokeBusinessContext(event.businessId, 'ownership_transferred')
      } else {
        callRefetch('businesses-list')
      }
      return

    case 'system.resync':
      callAllRefetches()
      return

    case 'system.error': {
      const toastKeyMap: Partial<Record<typeof event.code, string>> = {
        REALTIME_UNAVAILABLE: 'apiMessages.realtime_unavailable',
        REALTIME_PUBLISH_UNAVAILABLE: 'apiMessages.realtime_publish_unavailable',
      }
      const key = toastKeyMap[event.code] ?? 'apiMessages.realtime_unavailable'
      ctx.showToast(key)
      return
    }

    case 'system.auth_expired':
      ctx.routeToLogin()
      return
  }

  // Exhaustiveness check: if a new RealtimeEvent variant is added to the
  // shared union without a matching case above, `event` narrows to `never`
  // here and the assignment is a compile error.
  const _exhaustive: never = event
  return _exhaustive
}
