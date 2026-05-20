'use client'

import { useEffect } from 'react'
import {
  subscribeToEntityDelete,
  type EntityType,
} from '@/lib/realtime/entity-events'

/**
 * When the entity identified by (entityType, entityId) is deleted on
 * any remote device subscribed to the same business / user channel,
 * invoke `dismiss`. Use from inside detail modals or per-entity pages.
 *
 * Echo-suppressed: the publishing device does not receive this signal
 * for its own deletions (handled in handlers.ts).
 *
 * `entityId` may be `null` or `undefined` while the host is in a
 * loading state; the hook no-ops until a real id is available.
 *
 * Example:
 *   useDismissOnDelete('product', product?.id, () => modalRef.dismiss())
 */
export function useDismissOnDelete(
  entityType: EntityType,
  entityId: string | null | undefined,
  dismiss: () => void,
): void {
  useEffect(() => {
    if (!entityId) return
    return subscribeToEntityDelete(entityType, entityId, dismiss)
  }, [entityType, entityId, dismiss])
}
