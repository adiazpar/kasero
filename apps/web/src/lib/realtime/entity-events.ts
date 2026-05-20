'use client'

export type DeletableEntityType = 'product' | 'team-member' | 'invite'

type Listener = () => void
const listeners = new Map<string, Set<Listener>>()

function key(entityType: DeletableEntityType, entityId: string): string {
  return `${entityType}:${entityId}`
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
  entityType: DeletableEntityType,
  entityId: string,
  listener: Listener,
): () => void {
  const k = key(entityType, entityId)
  let set = listeners.get(k)
  if (!set) {
    set = new Set()
    listeners.set(k, set)
  }
  set.add(listener)
  return () => {
    const s = listeners.get(k)
    if (!s) return
    s.delete(listener)
    if (s.size === 0) listeners.delete(k)
  }
}

/**
 * Fire from the realtime handler when an entity is deleted (locally
 * or remotely — echo suppression is NOT performed here, by design;
 * detail modals on the publishing device should also dismiss). Errors
 * inside listeners are swallowed and logged so one misbehaving modal
 * cannot block others from dismissing.
 */
export function emitEntityDeleted(
  entityType: DeletableEntityType,
  entityId: string,
): void {
  const set = listeners.get(key(entityType, entityId))
  if (!set) return
  // Snapshot before iteration — listeners may call their unsubscribe
  // inside the dismiss handler, which mutates the set.
  for (const listener of [...set]) {
    try {
      listener()
    } catch (err) {
      console.warn('[realtime.entity-events] listener threw', err)
    }
  }
}
