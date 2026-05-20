import { describe, it, expect, vi, beforeEach } from 'vitest'

const callRefetch = vi.fn()
const callAllRefetches = vi.fn()
const emitEntityDeleted = vi.fn()
const emitEntityUpdated = vi.fn()

vi.mock('./refetch-registry', () => ({ callRefetch, callAllRefetches }))
vi.mock('./entity-events', () => ({ emitEntityDeleted, emitEntityUpdated }))

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
    emitEntityUpdated.mockReset()
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

  it('team.member.removed -> emitEntityDeleted(team-member, memberId) when remote', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'team.member.removed', memberId: 'm42', originDeviceId: 'other-device' },
      ctx,
    )
    expect(emitEntityDeleted).toHaveBeenCalledWith('team-member', 'm42')
  })

  it('team.member.removed -> does NOT emitEntityDeleted when own device (echo-suppressed)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'team.member.removed', memberId: 'm42', originDeviceId: 'device-me' },
      ctx,
    )
    expect(emitEntityDeleted).not.toHaveBeenCalled()
    // refetch is still unconditional
    expect(callRefetch).toHaveBeenCalledWith('team')
  })

  it('team.member.joined -> does NOT emitEntityDeleted', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'team.member.joined', memberId: 'm1' }, ctx)
    expect(emitEntityDeleted).not.toHaveBeenCalled()
  })

  it('team.member.role_changed -> callRefetch(team) + callRefetch(invites)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'team.member.role_changed', memberId: 'm1', role: 'employee', originDeviceId: 'other-device' },
      ctx,
    )
    expect(callRefetch).toHaveBeenCalledWith('team')
    expect(callRefetch).toHaveBeenCalledWith('invites')
  })

  it('team.member.role_changed -> emitEntityUpdated(team-member, memberId) when remote', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'team.member.role_changed', memberId: 'm7', role: 'employee', originDeviceId: 'other-device' },
      ctx,
    )
    expect(emitEntityUpdated).toHaveBeenCalledWith('team-member', 'm7')
  })

  it('team.member.role_changed -> does NOT emitEntityUpdated when own device (echo-suppressed)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'team.member.role_changed', memberId: 'm7', role: 'employee', originDeviceId: 'device-me' },
      ctx,
    )
    expect(emitEntityUpdated).not.toHaveBeenCalled()
    expect(callRefetch).toHaveBeenCalledWith('team')
  })

  it('team.member.status_changed -> emitEntityUpdated(team-member, memberId) when remote', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'team.member.status_changed', memberId: 'm8', status: 'disabled', originDeviceId: 'other-device' },
      ctx,
    )
    expect(emitEntityUpdated).toHaveBeenCalledWith('team-member', 'm8')
  })

  it('team.member.status_changed -> does NOT emitEntityUpdated when own device (echo-suppressed)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'team.member.status_changed', memberId: 'm8', status: 'disabled', originDeviceId: 'device-me' },
      ctx,
    )
    expect(emitEntityUpdated).not.toHaveBeenCalled()
    expect(callRefetch).toHaveBeenCalledWith('team')
  })

  it('team.invite.created -> callRefetch(invites)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'team.invite.created', inviteId: 'i1' }, ctx)
    expect(callRefetch).toHaveBeenCalledWith('invites')
    expect(callRefetch).not.toHaveBeenCalledWith('team')
  })

  it('team.invite.deleted -> callRefetch(invites) + emitEntityDeleted(invite, inviteId) when remote', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'team.invite.deleted', inviteId: 'inv-del', originDeviceId: 'other-device' },
      ctx,
    )
    expect(callRefetch).toHaveBeenCalledWith('invites')
    expect(emitEntityDeleted).toHaveBeenCalledWith('invite', 'inv-del')
  })

  it('team.invite.deleted -> does NOT emitEntityDeleted when own device (echo-suppressed)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'team.invite.deleted', inviteId: 'inv-del', originDeviceId: 'device-me' },
      ctx,
    )
    expect(emitEntityDeleted).not.toHaveBeenCalled()
    expect(callRefetch).toHaveBeenCalledWith('invites')
  })

  it('team.invite.consumed -> callRefetch(invites) + emitEntityDeleted(invite, inviteId) when remote', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'team.invite.consumed', inviteId: 'inv-con', consumedByName: 'Alice', originDeviceId: 'other-device' },
      ctx,
    )
    expect(callRefetch).toHaveBeenCalledWith('invites')
    expect(emitEntityDeleted).toHaveBeenCalledWith('invite', 'inv-con')
  })

  it('team.invite.consumed -> does NOT emitEntityDeleted when own device (echo-suppressed)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'team.invite.consumed', inviteId: 'inv-con', consumedByName: 'Alice', originDeviceId: 'device-me' },
      ctx,
    )
    expect(emitEntityDeleted).not.toHaveBeenCalled()
    expect(callRefetch).toHaveBeenCalledWith('invites')
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

  it('product.created -> does NOT emitEntityUpdated', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'product.created', productId: 'p1' }, ctx)
    expect(emitEntityUpdated).not.toHaveBeenCalled()
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

  it('product.updated -> emitEntityUpdated(product, productId) when remote', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'product.updated', productId: 'prod-upd', fields: ['price'], originDeviceId: 'other-device' },
      ctx,
    )
    expect(emitEntityUpdated).toHaveBeenCalledWith('product', 'prod-upd')
  })

  it('product.updated -> does NOT emitEntityUpdated when own device (echo-suppressed)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'product.updated', productId: 'prod-upd', fields: ['price'], originDeviceId: 'device-me' },
      ctx,
    )
    expect(emitEntityUpdated).not.toHaveBeenCalled()
    // refetch is still unconditional
    expect(callRefetch).toHaveBeenCalledWith('products')
  })

  it('product.deleted -> callRefetch(products)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'product.deleted', productId: 'p1' }, ctx)
    expect(callRefetch).toHaveBeenCalledWith('products')
  })

  it('product.deleted -> emitEntityDeleted(product, productId) when remote', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'product.deleted', productId: 'prod-xyz', originDeviceId: 'other-device' },
      ctx,
    )
    expect(emitEntityDeleted).toHaveBeenCalledWith('product', 'prod-xyz')
  })

  it('product.deleted -> does NOT emitEntityDeleted when own device (echo-suppressed)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'product.deleted', productId: 'prod-xyz', originDeviceId: 'device-me' },
      ctx,
    )
    expect(emitEntityDeleted).not.toHaveBeenCalled()
    expect(callRefetch).toHaveBeenCalledWith('products')
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

  // --- category events ---

  it('category.created -> callRefetch(categories)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'category.created', categoryId: 'cat1' }, ctx)
    expect(callRefetch).toHaveBeenCalledWith('categories')
  })

  it('category.created -> does NOT emitEntityUpdated', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'category.created', categoryId: 'cat1' }, ctx)
    expect(emitEntityUpdated).not.toHaveBeenCalled()
  })

  it('category.updated -> callRefetch(categories)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'category.updated', categoryId: 'cat2', fields: ['name'] },
      ctx,
    )
    expect(callRefetch).toHaveBeenCalledWith('categories')
  })

  it('category.updated -> emitEntityUpdated(category, categoryId) when remote', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'category.updated', categoryId: 'cat2', fields: ['name'], originDeviceId: 'other-device' },
      ctx,
    )
    expect(emitEntityUpdated).toHaveBeenCalledWith('category', 'cat2')
  })

  it('category.updated -> does NOT emitEntityUpdated when own device (echo-suppressed)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'category.updated', categoryId: 'cat2', fields: ['name'], originDeviceId: 'device-me' },
      ctx,
    )
    expect(emitEntityUpdated).not.toHaveBeenCalled()
    expect(callRefetch).toHaveBeenCalledWith('categories')
  })

  it('category.deleted -> callRefetch(categories) + callRefetch(products)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'category.deleted', categoryId: 'cat3', originDeviceId: 'other-device' },
      ctx,
    )
    expect(callRefetch).toHaveBeenCalledWith('categories')
    expect(callRefetch).toHaveBeenCalledWith('products')
  })

  it('category.deleted -> emitEntityDeleted(category, categoryId) when remote', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'category.deleted', categoryId: 'cat3', originDeviceId: 'other-device' },
      ctx,
    )
    expect(emitEntityDeleted).toHaveBeenCalledWith('category', 'cat3')
  })

  it('category.deleted -> does NOT emitEntityDeleted when own device (echo-suppressed)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'category.deleted', categoryId: 'cat3', originDeviceId: 'device-me' },
      ctx,
    )
    expect(emitEntityDeleted).not.toHaveBeenCalled()
    // refetch is still unconditional
    expect(callRefetch).toHaveBeenCalledWith('categories')
    expect(callRefetch).toHaveBeenCalledWith('products')
  })

  it('category.reordered -> callRefetch(categories)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'category.reordered' }, ctx)
    expect(callRefetch).toHaveBeenCalledWith('categories')
  })

  it('category.reordered -> does NOT emitEntityUpdated or emitEntityDeleted', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'category.reordered' }, ctx)
    expect(emitEntityUpdated).not.toHaveBeenCalled()
    expect(emitEntityDeleted).not.toHaveBeenCalled()
  })

  // --- provider events ---

  it('provider.created -> callRefetch(providers)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'provider.created', providerId: 'prov1' }, ctx)
    expect(callRefetch).toHaveBeenCalledWith('providers')
  })

  it('provider.created -> does NOT emitEntityUpdated', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'provider.created', providerId: 'prov1' }, ctx)
    expect(emitEntityUpdated).not.toHaveBeenCalled()
  })

  it('provider.updated -> callRefetch(providers)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'provider.updated', providerId: 'prov2', fields: ['name'] },
      ctx,
    )
    expect(callRefetch).toHaveBeenCalledWith('providers')
  })

  it('provider.updated -> emitEntityUpdated(provider, providerId) when remote', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'provider.updated', providerId: 'prov-upd', fields: ['phone'], originDeviceId: 'other-device' },
      ctx,
    )
    expect(emitEntityUpdated).toHaveBeenCalledWith('provider', 'prov-upd')
  })

  it('provider.updated -> does NOT emitEntityUpdated when own device (echo-suppressed)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'provider.updated', providerId: 'prov-upd', fields: ['phone'], originDeviceId: 'device-me' },
      ctx,
    )
    expect(emitEntityUpdated).not.toHaveBeenCalled()
    expect(callRefetch).toHaveBeenCalledWith('providers')
  })

  it('provider.deleted -> callRefetch(providers)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'provider.deleted', providerId: 'prov3' }, ctx)
    expect(callRefetch).toHaveBeenCalledWith('providers')
  })

  it('provider.deleted -> emitEntityDeleted(provider, providerId) when remote', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'provider.deleted', providerId: 'prov-del', originDeviceId: 'other-device' },
      ctx,
    )
    expect(emitEntityDeleted).toHaveBeenCalledWith('provider', 'prov-del')
  })

  it('provider.deleted -> does NOT emitEntityDeleted when own device (echo-suppressed)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'provider.deleted', providerId: 'prov-del', originDeviceId: 'device-me' },
      ctx,
    )
    expect(emitEntityDeleted).not.toHaveBeenCalled()
    expect(callRefetch).toHaveBeenCalledWith('providers')
  })

  // --- sale events ---

  it('sale.created -> callRefetch(sales) + callRefetch(products)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'sale.created', saleId: 's1' }, ctx)
    expect(callRefetch).toHaveBeenCalledWith('sales')
    expect(callRefetch).toHaveBeenCalledWith('products')
  })

  it('sale.created -> does NOT emitEntityUpdated or emitEntityDeleted', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'sale.created', saleId: 's1' }, ctx)
    expect(emitEntityUpdated).not.toHaveBeenCalled()
    expect(emitEntityDeleted).not.toHaveBeenCalled()
  })

  // --- order events ---

  it('order.created -> callRefetch(orders)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'order.created', orderId: 'o1' }, ctx)
    expect(callRefetch).toHaveBeenCalledWith('orders')
  })

  it('order.created -> does NOT emitEntityUpdated', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'order.created', orderId: 'o1' }, ctx)
    expect(emitEntityUpdated).not.toHaveBeenCalled()
  })

  it('order.updated -> callRefetch(orders)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'order.updated', orderId: 'o2', fields: ['total'] },
      ctx,
    )
    expect(callRefetch).toHaveBeenCalledWith('orders')
  })

  it('order.updated -> emitEntityUpdated(order, orderId) when remote', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'order.updated', orderId: 'o3', fields: ['items'], originDeviceId: 'other-device' },
      ctx,
    )
    expect(emitEntityUpdated).toHaveBeenCalledWith('order', 'o3')
  })

  it('order.updated -> does NOT emitEntityUpdated when own device (echo-suppressed)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'order.updated', orderId: 'o3', fields: ['items'], originDeviceId: 'device-me' },
      ctx,
    )
    expect(emitEntityUpdated).not.toHaveBeenCalled()
    expect(callRefetch).toHaveBeenCalledWith('orders')
  })

  it('order.received -> callRefetch(orders) + callRefetch(products)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'order.received', orderId: 'o4' }, ctx)
    expect(callRefetch).toHaveBeenCalledWith('orders')
    expect(callRefetch).toHaveBeenCalledWith('products')
  })

  it('order.received -> emitEntityUpdated(order, orderId) when remote', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'order.received', orderId: 'o5', originDeviceId: 'other-device' },
      ctx,
    )
    expect(emitEntityUpdated).toHaveBeenCalledWith('order', 'o5')
  })

  it('order.received -> does NOT emitEntityUpdated when own device (echo-suppressed)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'order.received', orderId: 'o5', originDeviceId: 'device-me' },
      ctx,
    )
    expect(emitEntityUpdated).not.toHaveBeenCalled()
    expect(callRefetch).toHaveBeenCalledWith('orders')
    expect(callRefetch).toHaveBeenCalledWith('products')
  })

  it('order.deleted -> callRefetch(orders)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'order.deleted', orderId: 'o6' }, ctx)
    expect(callRefetch).toHaveBeenCalledWith('orders')
  })

  it('order.deleted -> emitEntityDeleted(order, orderId) when remote', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'order.deleted', orderId: 'o7', originDeviceId: 'other-device' },
      ctx,
    )
    expect(emitEntityDeleted).toHaveBeenCalledWith('order', 'o7')
  })

  it('order.deleted -> does NOT emitEntityDeleted when own device (echo-suppressed)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'order.deleted', orderId: 'o7', originDeviceId: 'device-me' },
      ctx,
    )
    expect(emitEntityDeleted).not.toHaveBeenCalled()
    expect(callRefetch).toHaveBeenCalledWith('orders')
  })

  // --- sales-session events ---

  it('sales_session.opened -> callRefetch(sales-sessions)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'sales_session.opened', sessionId: 'sess1' }, ctx)
    expect(callRefetch).toHaveBeenCalledWith('sales-sessions')
  })

  it('sales_session.opened -> does NOT emitEntityUpdated', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'sales_session.opened', sessionId: 'sess1' }, ctx)
    expect(emitEntityUpdated).not.toHaveBeenCalled()
  })

  it('sales_session.closed -> callRefetch(sales-sessions)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent({ type: 'sales_session.closed', sessionId: 'sess2' }, ctx)
    expect(callRefetch).toHaveBeenCalledWith('sales-sessions')
  })

  it('sales_session.closed -> emitEntityUpdated(sales-session, sessionId) when remote', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'sales_session.closed', sessionId: 'sess3', originDeviceId: 'other-device' },
      ctx,
    )
    expect(emitEntityUpdated).toHaveBeenCalledWith('sales-session', 'sess3')
  })

  it('sales_session.closed -> does NOT emitEntityUpdated when own device (echo-suppressed)', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    dispatchRealtimeEvent(
      { type: 'sales_session.closed', sessionId: 'sess3', originDeviceId: 'device-me' },
      ctx,
    )
    expect(emitEntityUpdated).not.toHaveBeenCalled()
    expect(callRefetch).toHaveBeenCalledWith('sales-sessions')
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
  // Entity-event emits (emitEntityDeleted, emitEntityUpdated) are suppressed
  // when the event originates from this device. callRefetch calls are always
  // unconditional — the publisher needs its list views refreshed too.

  it('system.resync (no originDeviceId) -> callAllRefetches without error', async () => {
    const { dispatchRealtimeEvent } = await import('./handlers')
    // system.* events have no originDeviceId; the isSelfEcho check must be graceful
    expect(() => {
      dispatchRealtimeEvent({ type: 'system.resync' }, ctx)
    }).not.toThrow()
    expect(callAllRefetches).toHaveBeenCalled()
  })

  it('event with own deviceId still triggers refetch (refetch is not echo-suppressed)', async () => {
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
