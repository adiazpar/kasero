import { describe, it, expect, vi, beforeEach } from 'vitest'

const callRefetch = vi.fn()
const callAllRefetches = vi.fn()
const emitEntityDeleted = vi.fn()

vi.mock('./refetch-registry', () => ({ callRefetch, callAllRefetches }))
vi.mock('./entity-events', () => ({ emitEntityDeleted }))

describe('dispatchRealtimeEvent', () => {
  const revokeBusinessContext = vi.fn()
  const routeToLogin = vi.fn()
  const showToast = vi.fn()

  const ctx = {
    ownDeviceId: 'device-me',
    revokeBusinessContext,
    routeToLogin,
    showToast,
  }

  beforeEach(() => {
    callRefetch.mockReset()
    callAllRefetches.mockReset()
    emitEntityDeleted.mockReset()
    revokeBusinessContext.mockReset()
    routeToLogin.mockReset()
    showToast.mockReset()
  })

  // --- team events ---

  it('team.member.joined -> callRefetch(team) + callRefetch(invites)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'team.member.joined', memberId: 'm1' }, ctx)
    expect(callRefetch).toHaveBeenCalledWith('team')
    expect(callRefetch).toHaveBeenCalledWith('invites')
  })

  it('team.member.removed -> callRefetch(team) + callRefetch(invites)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'team.member.removed', memberId: 'm1' }, ctx)
    expect(callRefetch).toHaveBeenCalledWith('team')
    expect(callRefetch).toHaveBeenCalledWith('invites')
  })

  it('team.member.removed -> emitEntityDeleted(team-member, memberId)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'team.member.removed', memberId: 'm42' }, ctx)
    expect(emitEntityDeleted).toHaveBeenCalledWith('team-member', 'm42')
  })

  it('team.member.joined -> does NOT emitEntityDeleted', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'team.member.joined', memberId: 'm1' }, ctx)
    expect(emitEntityDeleted).not.toHaveBeenCalled()
  })

  it('team.invite.created -> callRefetch(invites)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'team.invite.created', inviteId: 'i1' }, ctx)
    expect(callRefetch).toHaveBeenCalledWith('invites')
    expect(callRefetch).not.toHaveBeenCalledWith('team')
  })

  it('team.invite.deleted -> callRefetch(invites) + emitEntityDeleted(invite, inviteId)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'team.invite.deleted', inviteId: 'inv-del' }, ctx)
    expect(callRefetch).toHaveBeenCalledWith('invites')
    expect(emitEntityDeleted).toHaveBeenCalledWith('invite', 'inv-del')
  })

  it('team.invite.consumed -> callRefetch(invites) + emitEntityDeleted(invite, inviteId)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'team.invite.consumed', inviteId: 'inv-con', consumedByName: 'Alice' }, ctx)
    expect(callRefetch).toHaveBeenCalledWith('invites')
    expect(emitEntityDeleted).toHaveBeenCalledWith('invite', 'inv-con')
  })

  it('team.invite.created -> does NOT emitEntityDeleted', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'team.invite.created', inviteId: 'i1' }, ctx)
    expect(emitEntityDeleted).not.toHaveBeenCalled()
  })

  // --- business events ---

  it('business.updated -> callRefetch(business)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'business.updated', fields: ['name'] }, ctx)
    expect(callRefetch).toHaveBeenCalledWith('business')
  })

  it('business.list.changed -> callRefetch(businesses-list)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'business.list.changed', reason: 'added' }, ctx)
    expect(callRefetch).toHaveBeenCalledWith('businesses-list')
  })

  // --- profile ---

  it('profile.updated -> callRefetch(profile)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'profile.updated', fields: ['displayName'] }, ctx)
    expect(callRefetch).toHaveBeenCalledWith('profile')
  })

  // --- product events ---

  it('product.created -> callRefetch(products)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'product.created', productId: 'p1' }, ctx)
    expect(callRefetch).toHaveBeenCalledWith('products')
  })

  it('product.updated -> callRefetch(products)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'product.updated', productId: 'p1', fields: ['price'] },
      ctx,
    )
    expect(callRefetch).toHaveBeenCalledWith('products')
  })

  it('product.updated with stock fields -> callRefetch(products)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'product.updated', productId: 'p1', fields: ['stock'] },
      ctx,
    )
    expect(callRefetch).toHaveBeenCalledWith('products')
  })

  it('product.deleted -> callRefetch(products)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'product.deleted', productId: 'p1' }, ctx)
    expect(callRefetch).toHaveBeenCalledWith('products')
  })

  it('product.deleted -> emitEntityDeleted(product, productId)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'product.deleted', productId: 'prod-xyz' }, ctx)
    expect(emitEntityDeleted).toHaveBeenCalledWith('product', 'prod-xyz')
  })

  it('product.updated -> does NOT emitEntityDeleted', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'product.updated', productId: 'p1', fields: ['price'] },
      ctx,
    )
    expect(emitEntityDeleted).not.toHaveBeenCalled()
  })

  it('product.settings.updated -> callRefetch(product-settings)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'product.settings.updated', fields: ['sortPreference'] },
      ctx,
    )
    expect(callRefetch).toHaveBeenCalledWith('product-settings')
  })

  // --- critical user events ---

  it('session.revoked -> revokeBusinessContext(businessId, reason)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'session.revoked', businessId: 'biz1', reason: 'removed' }, ctx)
    expect(revokeBusinessContext).toHaveBeenCalledWith('biz1', 'removed')
  })

  it('business.deleted -> revokeBusinessContext(businessId, business_deleted)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'business.deleted', businessId: 'biz2' }, ctx)
    expect(revokeBusinessContext).toHaveBeenCalledWith('biz2', 'business_deleted')
  })

  it('ownership.transferred former_owner -> revokeBusinessContext', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'ownership.transferred', businessId: 'biz3', role: 'former_owner' }, ctx)
    expect(revokeBusinessContext).toHaveBeenCalledWith('biz3', 'ownership_transferred')
  })

  it('ownership.transferred new_owner -> callRefetch(businesses-list)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'ownership.transferred', businessId: 'biz3', role: 'new_owner' }, ctx)
    expect(callRefetch).toHaveBeenCalledWith('businesses-list')
    expect(revokeBusinessContext).not.toHaveBeenCalled()
  })

  // --- system events ---

  it('system.resync -> callAllRefetches()', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'system.resync' }, ctx)
    expect(callAllRefetches).toHaveBeenCalled()
  })

  it('system.error -> showToast with mapped i18n key', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'system.error', code: 'REALTIME_UNAVAILABLE' }, ctx)
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('realtime'))
  })

  it('system.auth_expired -> routeToLogin()', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'system.auth_expired' }, ctx)
    expect(routeToLogin).toHaveBeenCalled()
  })

  // --- echo behavior ---
  // Echo suppression was removed (see handlers.ts comment). The publisher's
  // own device now receives its own events and refetches just like every
  // other device. Tests below pin the new behavior so the suppression
  // can't quietly return.

  it('event with own deviceId still triggers refetch (no echo suppression)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'team.member.joined', memberId: 'm1', originDeviceId: 'device-me' },
      ctx,
    )
    expect(callRefetch).toHaveBeenCalledWith('team')
    expect(callRefetch).toHaveBeenCalledWith('invites')
  })

  it('event with different deviceId triggers the same refetch', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'team.member.joined', memberId: 'm1', originDeviceId: 'other-device' },
      ctx,
    )
    expect(callRefetch).toHaveBeenCalledWith('team')
  })
})
