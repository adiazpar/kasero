'use client'

import { useEffect } from 'react'
import {
  subscribeToEntityUpdate,
  type EntityType,
} from '@/lib/realtime/entity-events'

/**
 * When the entity identified by (entityType, entityId) is updated on a
 * remote device subscribed to the same business channel, invoke `onUpdate`.
 *
 * By the time `onUpdate` fires, the realtime handler has already called
 * callRefetch() for the relevant context, so the freshest data is
 * available from the corresponding context hook.
 *
 * Echo-suppressed: the publishing device does not receive this signal
 * for its own mutations (handled in handlers.ts).
 *
 * `entityId` may be `null` or `undefined` while the host is in a
 * loading state; the hook no-ops until a real id is available.
 *
 * Example:
 *   useResyncOnUpdate('product', product?.id, () => {
 *     const fresh = products.find(p => p.id === product?.id)
 *     if (fresh) setSnapshot(fresh)
 *   })
 */
export function useResyncOnUpdate(
  entityType: EntityType,
  entityId: string | null | undefined,
  onUpdate: () => void,
): void {
  useEffect(() => {
    if (!entityId) return
    return subscribeToEntityUpdate(entityType, entityId, onUpdate)
  }, [entityType, entityId, onUpdate])
}
