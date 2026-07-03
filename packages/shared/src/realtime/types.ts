/**
 * Realtime event types — shared discriminated union consumed by both
 * the API (publisher) and the web client (handler dispatch). The
 * exhaustiveness check in handlers.ts and the server-side typing of
 * publish helpers depend on this file being the single source of truth.
 *
 * Three delivery tiers:
 *   - BusinessRealtimeEvent: pub/sub on `business:{id}`, missable.
 *   - UserRealtimeEvent: pub/sub on `user:{id}`, missable (focus refetch backs up).
 *   - CriticalUserRealtimeEvent: pub/sub + stream on `user:{id}`/`stream:user:{id}`,
 *     must survive an SSE reconnect.
 *   - SystemRealtimeEvent: emitted by the SSE handler itself, never via Redis.
 */

import type { ApiMessageCode } from '../api-messages'
import type { BusinessRole } from '../business-role'

// Every event payload may carry the originating client's deviceId so
// the publishing client can suppress its own echo in the handler layer.
interface WithOrigin {
  originDeviceId?: string
}

export type BusinessRealtimeEvent =
  | ({ type: 'team.member.joined'; memberId: string } & WithOrigin)
  | ({ type: 'team.member.removed'; memberId: string } & WithOrigin)
  | ({ type: 'team.member.role_changed'; memberId: string; role: BusinessRole } & WithOrigin)
  | ({ type: 'team.member.status_changed'; memberId: string; status: 'active' | 'disabled' } & WithOrigin)
  | ({ type: 'team.invite.created'; inviteId: string } & WithOrigin)
  | ({ type: 'team.invite.regenerated'; inviteId: string } & WithOrigin)
  | ({ type: 'team.invite.consumed'; inviteId: string; consumedByName: string } & WithOrigin)
  | ({ type: 'team.invite.deleted'; inviteId: string } & WithOrigin)
  | ({
      type: 'business.updated'
      fields: Array<'name' | 'locale' | 'currency' | 'iconUrl' | 'taxRate' | 'taxMode'>
    } & WithOrigin)
  // Product catalog events. Inventory ("stock") is not a separate domain
  // in this codebase — it's the `products.stock` column adjusted by the
  // stock-adjust route, and reflected via `product.updated fields:['stock']`.
  // Fields enumerated here mirror every column the product create/update/
  // stock routes can touch; extend the literal type when a new column
  // becomes mutable.
  | ({ type: 'product.created'; productId: string } & WithOrigin)
  | ({
      type: 'product.updated'
      productId: string
      fields: Array<
        | 'name'
        | 'price'
        | 'categoryId'
        | 'icon'
        | 'barcode'
        | 'stock'
        | 'active'
      >
    } & WithOrigin)
  | ({ type: 'product.deleted'; productId: string } & WithOrigin)
  // Product-list display preferences on the business row (sortPreference,
  // defaultCategoryId). Distinct from `business.updated` because the
  // refetch target is the per-business product-settings, not the business
  // metadata header.
  | ({
      type: 'product.settings.updated'
      fields: Array<'defaultCategoryId' | 'sortPreference'>
    } & WithOrigin)
  // Category events. The mutable columns on product_categories are `name`
  // (PATCH /categories/[id]) and `sortOrder` (POST /categories/reorder).
  | ({ type: 'category.created'; categoryId: string } & WithOrigin)
  | ({
      type: 'category.updated'
      categoryId: string
      fields: Array<'name' | 'sortOrder'>
    } & WithOrigin)
  | ({ type: 'category.deleted'; categoryId: string } & WithOrigin)
  | ({ type: 'category.reordered' } & WithOrigin)
  // Expense events.
  | ({ type: 'expense.created'; expenseId: string } & WithOrigin)
  | ({ type: 'expense.updated'; expenseId: string } & WithOrigin)
  | ({ type: 'expense.deleted'; expenseId: string } & WithOrigin)
  | ({ type: 'expense_category.created'; categoryId: string } & WithOrigin)
  | ({ type: 'expense_category.updated'; categoryId: string } & WithOrigin)
  | ({ type: 'expense_category.deleted'; categoryId: string } & WithOrigin)
  // Sales (customer-facing transactions). POST /sales creates; POST
  // /sales/[id]/void reverses (rows are never hard-deleted, so there is no
  // `sale.deleted` variant). The handlers for both events also refetch
  // `products` because create decrements `products.stock` per line item and
  // void restores it; that cascade is intentionally handled by the client
  // refetch instead of extra `product.updated` publishes.
  | ({ type: 'sale.created'; saleId: string } & WithOrigin)
  | ({ type: 'sale.voided'; saleId: string } & WithOrigin)
  // Inventory adjustments (manual stock corrections tracked in inventory_adjustments).
  | ({ type: 'inventory.adjusted'; adjustmentId: string; productId: string; relatedExpenseId: string | null } & WithOrigin)
  // Sales sessions (cash-drawer reconciliation framing a stretch of sales).
  // Only open and close are mutations; both transitions are fired here.
  | ({ type: 'sales_session.opened'; sessionId: string } & WithOrigin)
  | ({ type: 'sales_session.closed'; sessionId: string } & WithOrigin)

export type UserRealtimeEvent =
  | ({
      type: 'profile.updated'
      fields: Array<'displayName' | 'email' | 'language'>
    } & WithOrigin)
  | ({
      type: 'business.list.changed'
      reason: 'added' | 'removed' | 'renamed'
    } & WithOrigin)

export type CriticalUserRealtimeEvent =
  | ({
      type: 'session.revoked'
      businessId: string
      reason: 'removed' | 'business_deleted' | 'ownership_transferred'
    } & WithOrigin)
  | ({ type: 'business.deleted'; businessId: string } & WithOrigin)
  | ({
      type: 'ownership.transferred'
      businessId: string
      role: 'former_owner' | 'new_owner'
    } & WithOrigin)

export type SystemRealtimeEvent =
  | { type: 'system.resync' }
  | { type: 'system.error'; code: ApiMessageCode }
  | { type: 'system.auth_expired' }

export type RealtimeEvent =
  | BusinessRealtimeEvent
  | UserRealtimeEvent
  | CriticalUserRealtimeEvent
  | SystemRealtimeEvent

// Channel name helpers — the ONLY way to construct channel names.
// The template-literal return types let downstream code that takes a
// `BusinessChannel`/`UserChannel`/`UserStream` reject a raw string at
// the call site, so a route can never accidentally publish to an
// untyped channel constructed inline.
export type BusinessChannel = `business:${string}`
export type UserChannel = `user:${string}`
export type UserStream = `stream:user:${string}`

export function businessChannel(businessId: string): BusinessChannel {
  return `business:${businessId}`
}
export function userChannel(userId: string): UserChannel {
  return `user:${userId}`
}
export function userStream(userId: string): UserStream {
  return `stream:user:${userId}`
}
