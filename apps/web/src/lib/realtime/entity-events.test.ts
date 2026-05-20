import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  subscribeToEntityDelete,
  emitEntityDeleted,
} from './entity-events'

// Re-import to get a clean module state per-describe by using fresh
// imports in each test via dynamic import or by resetting state manually.
// Since the listeners map is module-level, we rely on tests unsubscribing
// their own listeners to avoid cross-test contamination.

describe('entity-events bus', () => {
  beforeEach(() => {
    // Ensure any listeners from previous tests are cleaned up by the
    // tests themselves (each test returns its unsubscribe fn and calls it).
  })

  it('subscribe/emit roundtrip: listener is called when entity is deleted', () => {
    const listener = vi.fn()
    const unsub = subscribeToEntityDelete('product', 'p1', listener)

    emitEntityDeleted('product', 'p1')

    expect(listener).toHaveBeenCalledTimes(1)
    unsub()
  })

  it('multiple subscribers for the same entity all receive the event', () => {
    const a = vi.fn()
    const b = vi.fn()
    const unsubA = subscribeToEntityDelete('team-member', 'm1', a)
    const unsubB = subscribeToEntityDelete('team-member', 'm1', b)

    emitEntityDeleted('team-member', 'm1')

    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    unsubA()
    unsubB()
  })

  it('unsubscribe stops the listener from receiving further events', () => {
    const listener = vi.fn()
    const unsub = subscribeToEntityDelete('invite', 'inv1', listener)

    unsub()
    emitEntityDeleted('invite', 'inv1')

    expect(listener).not.toHaveBeenCalled()
  })

  it('does not call listeners registered for a different entity id', () => {
    const listenerA = vi.fn()
    const listenerB = vi.fn()
    const unsubA = subscribeToEntityDelete('product', 'p-correct', listenerA)
    const unsubB = subscribeToEntityDelete('product', 'p-other', listenerB)

    emitEntityDeleted('product', 'p-correct')

    expect(listenerA).toHaveBeenCalledTimes(1)
    expect(listenerB).not.toHaveBeenCalled()
    unsubA()
    unsubB()
  })

  it('does not call listeners registered for a different entity type', () => {
    const productListener = vi.fn()
    const memberListener = vi.fn()
    const unsubProduct = subscribeToEntityDelete('product', 'shared-id', productListener)
    const unsubMember = subscribeToEntityDelete('team-member', 'shared-id', memberListener)

    emitEntityDeleted('product', 'shared-id')

    expect(productListener).toHaveBeenCalledTimes(1)
    expect(memberListener).not.toHaveBeenCalled()
    unsubProduct()
    unsubMember()
  })

  it('does not throw when emitting for an entity with no subscribers', () => {
    expect(() => {
      emitEntityDeleted('product', 'non-existent-id')
    }).not.toThrow()
  })

  it('swallows listener errors and still calls remaining listeners', () => {
    const throwing = vi.fn().mockImplementation(() => {
      throw new Error('modal crash')
    })
    const survivor = vi.fn()
    const unsubThrowing = subscribeToEntityDelete('invite', 'inv-err', throwing)
    const unsubSurvivor = subscribeToEntityDelete('invite', 'inv-err', survivor)

    expect(() => {
      emitEntityDeleted('invite', 'inv-err')
    }).not.toThrow()

    expect(throwing).toHaveBeenCalledTimes(1)
    expect(survivor).toHaveBeenCalledTimes(1)
    unsubThrowing()
    unsubSurvivor()
  })

  it('listener that unsubscribes itself during emit does not break iteration', () => {
    let unsub: () => void
    const selfUnsub = vi.fn().mockImplementation(() => {
      unsub()
    })
    const after = vi.fn()
    unsub = subscribeToEntityDelete('product', 'p-self-unsub', selfUnsub)
    const unsubAfter = subscribeToEntityDelete('product', 'p-self-unsub', after)

    expect(() => {
      emitEntityDeleted('product', 'p-self-unsub')
    }).not.toThrow()

    expect(selfUnsub).toHaveBeenCalledTimes(1)
    expect(after).toHaveBeenCalledTimes(1)
    unsubAfter()
  })
})
