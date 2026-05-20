'use client'

/**
 * Two independent event buses for entity lifecycle signals:
 *   - delete bus  (subscribeToEntityDelete / emitEntityDeleted)
 *   - update bus  (subscribeToEntityUpdate / emitEntityUpdated)
 *
 * Each bus has its own Map so a subscriber that only cares about one
 * signal doesn't accidentally receive the other.
 */

export type EntityType =
  | 'product'
  | 'team-member'
  | 'invite'
  | 'category'
  | 'sale'
  | 'order'
  | 'sales-session'

/**
 * @deprecated Use EntityType instead.
 */
export type DeletableEntityType = EntityType

type Listener = () => void

// --- delete bus ---
const deleteListeners = new Map<string, Set<Listener>>()

function deleteKey(entityType: EntityType, entityId: string): string {
  return `del:${entityType}:${entityId}`
}

/**
 * Subscribe to deletion events for a specific entity. Returns an
 * unsubscribe fn — call it on unmount.
 *
 * Multiple subscribers per (type, id) are supported. The listener
 * receives no arguments — it should call the appropriate dismiss /
 * navigate handler that the consuming component already has in scope.
 */
export function subscribeToEntityDelete(
  entityType: EntityType,
  entityId: string,
  listener: Listener,
): () => void {
  const k = deleteKey(entityType, entityId)
  let set = deleteListeners.get(k)
  if (!set) {
    set = new Set()
    deleteListeners.set(k, set)
  }
  set.add(listener)
  return () => {
    const s = deleteListeners.get(k)
    if (!s) return
    s.delete(listener)
    if (s.size === 0) deleteListeners.delete(k)
  }
}

/**
 * Fire from the realtime handler when an entity is deleted on a remote
 * device. Echo suppression is performed in handlers.ts — this function
 * never needs to know whether the emitting device is the publisher.
 * Errors inside listeners are swallowed so one misbehaving modal cannot
 * block others from dismissing.
 */
export function emitEntityDeleted(
  entityType: EntityType,
  entityId: string,
): void {
  const set = deleteListeners.get(deleteKey(entityType, entityId))
  if (!set) return
  // Snapshot before iteration — listeners may call their unsubscribe
  // inside the dismiss handler, which mutates the set.
  for (const listener of [...set]) {
    try {
      listener()
    } catch (err) {
      console.warn('[realtime.entity-events] delete listener threw', err)
    }
  }
}

// --- update bus ---
const updateListeners = new Map<string, Set<Listener>>()

function updateKey(entityType: EntityType, entityId: string): string {
  return `upd:${entityType}:${entityId}`
}

/**
 * Subscribe to update events for a specific entity. Returns an
 * unsubscribe fn — call it on unmount.
 *
 * Multiple subscribers per (type, id) are supported. The listener
 * receives no arguments — the consumer should read fresh data from
 * whatever context has already been revalidated by the preceding
 * callRefetch() in the same handler branch.
 */
export function subscribeToEntityUpdate(
  entityType: EntityType,
  entityId: string,
  listener: Listener,
): () => void {
  const k = updateKey(entityType, entityId)
  let set = updateListeners.get(k)
  if (!set) {
    set = new Set()
    updateListeners.set(k, set)
  }
  set.add(listener)
  return () => {
    const s = updateListeners.get(k)
    if (!s) return
    s.delete(listener)
    if (s.size === 0) updateListeners.delete(k)
  }
}

/**
 * Fire from the realtime handler when an entity is updated on a remote
 * device. Echo suppression is performed in handlers.ts. Errors inside
 * listeners are swallowed so one misbehaving subscriber cannot block
 * the rest.
 */
export function emitEntityUpdated(
  entityType: EntityType,
  entityId: string,
): void {
  const set = updateListeners.get(updateKey(entityType, entityId))
  if (!set) return
  // Snapshot before iteration — listeners may unsubscribe during the callback.
  for (const listener of [...set]) {
    try {
      listener()
    } catch (err) {
      console.warn('[realtime.entity-events] update listener threw', err)
    }
  }
}
