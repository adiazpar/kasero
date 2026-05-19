import { describe, it, expect, vi, beforeEach } from 'vitest'

const callRefetch = vi.fn()
const callAllRefetches = vi.fn()

vi.mock('./refetch-registry', () => ({ callRefetch, callAllRefetches }))

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

  it('team.invite.created -> callRefetch(invites)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'team.invite.created', inviteId: 'i1' }, ctx)
    expect(callRefetch).toHaveBeenCalledWith('invites')
    expect(callRefetch).not.toHaveBeenCalledWith('team')
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

  // --- echo suppression ---

  it('event with own deviceId is dropped (echo suppression)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'team.member.joined', memberId: 'm1', originDeviceId: 'device-me' },
      ctx,
    )
    expect(callRefetch).not.toHaveBeenCalled()
    expect(revokeBusinessContext).not.toHaveBeenCalled()
  })

  it('event with different deviceId is not suppressed', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'team.member.joined', memberId: 'm1', originDeviceId: 'other-device' },
      ctx,
    )
    expect(callRefetch).toHaveBeenCalledWith('team')
  })
})
