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
import { emitEntityDeleted, emitEntityUpdated } from './entity-events'

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
 * Dispatch a realtime event. The exhaustiveness assertion at the bottom
 * ensures every new event type in the shared union must be handled here.
 *
 * Echo suppression policy:
 *   - callRefetch / callAllRefetches: NOT suppressed. The publisher's
 *     own refetch after its mutation may have raced; re-fetching on the
 *     echo is cheap and keeps list views current on the publishing device.
 *   - emitEntityDeleted / emitEntityUpdated: SUPPRESSED when the event
 *     originates from this device (isSelfEcho). Entity-event signals
 *     drive UI lifecycle (modal dismiss, snapshot resync). The publishing
 *     device already manages its own modal state after the API call
 *     returns; receiving the echo would cause premature dismissal or a
 *     double-resync. Consumers that need to react on the publisher should
 *     do so directly in the mutation callback, not via the bus.
 *
 * Never add blanket echo suppression for refetch calls — that restores
 * the bug this comment was written to document.
 */
export function dispatchRealtimeEvent(
  event: RealtimeEvent,
  ctx: RealtimeHandlerContext,
): void {
  // Graceful check: system.* events don't carry originDeviceId.
  const isSelfEcho =
    'originDeviceId' in event && event.originDeviceId === ctx.ownDeviceId

  switch (event.type) {
    case 'team.member.joined':
      callRefetch('team')
      callRefetch('invites')
      return

    case 'team.member.role_changed':
    case 'team.member.status_changed':
      callRefetch('team')
      callRefetch('invites')
      if (!isSelfEcho) emitEntityUpdated('team-member', event.memberId)
      return

    case 'team.member.removed':
      callRefetch('team')
      callRefetch('invites')
      if (!isSelfEcho) emitEntityDeleted('team-member', event.memberId)
      return

    case 'team.invite.created':
    case 'team.invite.regenerated':
      callRefetch('invites')
      return

    case 'team.invite.consumed':
      callRefetch('invites')
      if (!isSelfEcho) emitEntityDeleted('invite', event.inviteId)
      return

    case 'team.invite.deleted':
      callRefetch('invites')
      if (!isSelfEcho) emitEntityDeleted('invite', event.inviteId)
      return

    case 'business.updated':
      callRefetch('business')
      return

    case 'product.created':
      callRefetch('products')
      return

    case 'product.updated':
      callRefetch('products')
      if (!isSelfEcho) emitEntityUpdated('product', event.productId)
      return

    case 'product.deleted':
      callRefetch('products')
      if (!isSelfEcho) emitEntityDeleted('product', event.productId)
      return

    case 'product.settings.updated':
      callRefetch('product-settings')
      return

    case 'category.created':
      callRefetch('categories')
      return

    case 'category.updated':
      callRefetch('categories')
      if (!isSelfEcho) emitEntityUpdated('category', event.categoryId)
      return

    case 'category.deleted':
      callRefetch('categories')
      callRefetch('products')
      if (!isSelfEcho) emitEntityDeleted('category', event.categoryId)
      return

    case 'category.reordered':
      callRefetch('categories')
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
