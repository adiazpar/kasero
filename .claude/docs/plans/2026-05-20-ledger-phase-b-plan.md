# Ledger Phase B — Implementation Plan

> Phase B is destructive. Drops 4 tables, ~12 routes, all provider/order UI. No data preservation — clean cut. Single PR.

**Goal:** Remove the provider/order subsystem entirely. Replace with a lightweight `inventory_adjustments` table + an Inventory sub-tab under Products. Provide a one-tap "Log as expense" bridge from inventory adjustments to the Ledger.

**Decisions locked (from user, 2026-05-20):**
- One big push, no staging.
- No disclosure banner, no migration of existing rows — tables just dropped.
- "Log as expense" checkbox defaults to **unchecked** always.
- No `expenseNumber` backfill from `orderNumber`. New system.
- No real users; no coordination needed.

**Spec:** `.claude/docs/plans/2026-05-20-ledger-and-inventory-simplification-design.md`

---

## File-level changes

### Schema (`packages/shared/src/db/schema.ts`)

**Add:**
- `inventoryAdjustments` table — id, businessId (fk cascade), productId (fk cascade), createdByUserId (fk), delta (integer signed), reason (text nullable), relatedExpenseId (fk → expenses, onDelete set null), createdAt (timestamp default unixepoch). Indexes on businessId, productId, (businessId, createdAt).

**Remove:**
- `orders` table
- `orderItems` table
- `providers` table
- `providerNotes` table
- `businesses.nextOrderNumber` column

### Backend new

- `POST /api/businesses/[bid]/inventory-adjustments` — atomic transaction: insert expense (if payload present), insert inventory_adjustments row with relatedExpenseId, update products.stock. Publishes `inventory.adjusted` + optionally `expense.created`.
- `GET /api/businesses/[bid]/inventory-adjustments` — history list, paginated.

### Backend removed

- All routes under `apps/api/src/app/api/businesses/[businessId]/providers/**`
- All routes under `apps/api/src/app/api/businesses/[businessId]/orders/**`

### Shared

- `ApiMessageCode`: add `INVENTORY_ADJUSTMENT_*`. Remove all `ORDER_*`, `PROVIDER_*`, `PRODUCT_PENDING_ORDER_BLOCK`.
- `BusinessRealtimeEvent`: add `inventory.adjusted`. Remove `provider.*` and `order.*` variants.

### Frontend new

- `apps/web/src/components/inventory/InventoryView.tsx` — sub-tab content under Products.
- `apps/web/src/components/inventory/InventoryListItem.tsx` — per-product row with current stock + adjust button.
- `apps/web/src/components/inventory/AdjustStockModal.tsx` — single-step modal with delta input, reason, optional "Log as expense" sub-form.
- `apps/web/src/contexts/inventory-adjustments-context.tsx` — list + create (if needed for history view).

### Frontend removed (entire directories)

- `apps/web/src/components/providers/` — all files
- `apps/web/src/components/products/OrdersTab.tsx`
- `apps/web/src/components/products/OrderListItem.tsx`
- `apps/web/src/routes/tabs/ProvidersTab.tsx`
- `apps/web/src/routes/tabs/ProviderDetailPage.tsx`
- `apps/web/src/contexts/providers-context.tsx`
- `apps/web/src/contexts/orders-context.tsx`
- Provider/order modals and helpers

### Frontend modified

- `ProductsView.tsx` — Orders sub-tab → Inventory sub-tab. Same TabContainer shape.
- `BusinessTabsLayout.tsx` — remove ProvidersTab and ProviderDetailPage routes.
- `ManageTab.tsx` — remove Providers entry from the manage menu.
- `realtime/handlers.ts` — remove provider.*/order.* cases. Add `inventory.adjusted`.
- `realtime/refetch-registry.ts` — remove `'orders'` and `'providers'`. Add `'inventory-adjustments'`.
- `realtime/entity-events.ts` — remove `'order'` and `'provider'`. Add `'inventory-adjustment'`.
- Realtime exhaustive test — same cleanup.
- i18n JSONs (en-US, es, ja) — remove `provider*.*`, `order*.*`, related error keys. Add `inventory.*` + `inventory_adjustment.*` keys. Regen messageIds.

### i18n changes

- Remove keys: anything under `provider`, `providers`, `order`, `orders`, `pending_order`. Search and delete.
- Remove ApiMessageCode translations for `ORDER_*`, `PROVIDER_*`, `PRODUCT_PENDING_ORDER_BLOCK`.
- Add: `inventory.*` keys for the sub-tab UI; `inventory_adjustment.*` for the modal; `error.INVENTORY_ADJUSTMENT_*` and `success.INVENTORY_ADJUSTMENT_*`.

### Cascade and helpers

- `apps/api/src/lib/business-auth.ts` — remove `assertProviderInBusiness`. Add `assertInventoryAdjustmentInBusiness` if needed (probably not — atomic txn doesn't need it).
- `apps/api/src/app/api/businesses/[businessId]/route.ts` — business-delete cascade: remove `order_items → orders → provider_notes → providers` deletion steps. Add `inventory_adjustments` (though FK cascade should handle it).
- `apps/api/src/app/api/businesses/[businessId]/products/[id]/route.ts` — remove the PRODUCT_PENDING_ORDER_BLOCK check (lines ~294-318).

---

## Execution plan (tasks)

### Task 1: Add inventory_adjustments table + schema

Modify `packages/shared/src/db/schema.ts`:

```ts
export const inventoryAdjustments = sqliteTable('inventory_adjustments', {
  id: text('id').primaryKey(),
  businessId: text('business_id').references(() => businesses.id, { onDelete: 'cascade' }).notNull(),
  productId: text('product_id').references(() => products.id, { onDelete: 'cascade' }).notNull(),
  createdByUserId: text('created_by_user_id').references(() => users.id).notNull(),
  delta: integer('delta').notNull(),
  reason: text('reason'),
  relatedExpenseId: text('related_expense_id').references(() => expenses.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
}, (table) => [
  index('idx_inventory_adjustments_business_id').on(table.businessId),
  index('idx_inventory_adjustments_product_id').on(table.productId),
  index('idx_inventory_adjustments_business_created').on(table.businessId, table.createdAt),
])
```

Run `npm run db:push` from `apps/api`. Commit.

### Task 2: ApiMessageCode + realtime event type additions

`packages/shared/src/api-messages.ts`: add `INVENTORY_ADJUSTMENT_CREATED`, `INVENTORY_ADJUSTMENT_INVALID_DELTA`, `INVENTORY_ADJUSTMENT_FORBIDDEN_NOT_MANAGER`, `PRODUCT_NOT_FOUND_FOR_ADJUSTMENT`.

`packages/shared/src/realtime/types.ts`: add `inventory.adjusted` variant to `BusinessRealtimeEvent`.

`packages/shared/src/types/`: add `InventoryAdjustment` type re-exporting from schema. Update barrel.

Rebuild shared (`cd packages/shared && npx tsc -b`). Commit.

### Task 3: POST /inventory-adjustments endpoint + tests

Create `apps/api/src/app/api/businesses/[businessId]/inventory-adjustments/route.ts`:

- Zod schema: `delta: number().int().refine(d => d !== 0)`, `reason: string().max(500).optional().nullable()`, `productId: string()`, optional `expense: { amount: number().positive(), categoryId: string().optional().nullable() }`.
- `withBusinessAuth` + inline `canManageBusiness` gate (same pattern as expenses).
- Single Drizzle transaction:
  1. Fetch product to confirm it exists and belongs to business (400 with `PRODUCT_NOT_FOUND_FOR_ADJUSTMENT` if not).
  2. If `expense` payload present: insert expense row (use the existing nextExpenseNumber pattern), capture id.
  3. Insert inventory_adjustments row with `relatedExpenseId` (or null).
  4. Update `products.stock = stock + delta` (clamp at 0 if would go negative? — let server allow negative for now, document if needed).
  5. Publish `inventory.adjusted` post-commit; also publish `expense.created` if expense was inserted.
- Return `{ data: { adjustment, expense? } }`.

Tests: co-located `route.test.ts` (in `__tests__/` per parent-route convention). Cover: creates adjustment only, creates adjustment + expense atomically (verify both rows + relatedExpenseId link), rejects when product not in business, rejects delta=0, gated to manager role.

Commit.

### Task 4: GET /inventory-adjustments (history)

`route.ts` adds GET handler — paginated list (limit 50, cursor on createdAt desc), filterable by `productId`. Standard pattern.

Test in same file. Commit.

### Task 5: Frontend — InventoryAdjustmentsContext + entity-events/refetch wiring

`apps/web/src/lib/realtime/refetch-registry.ts`: add `'inventory-adjustments'` to RefetchKey, remove `'orders'` and `'providers'`.

`apps/web/src/lib/realtime/entity-events.ts`: add `'inventory-adjustment'`, remove `'order'` and `'provider'`.

`apps/web/src/lib/realtime/handlers.ts`: 
- Add case for `inventory.adjusted` → callRefetch('inventory-adjustments') + callRefetch('products') (stock changed).
- Remove all `provider.*` and `order.*` cases.

`apps/web/src/test/realtime-types.test.ts` (api-side equivalent): remove provider/order cases, add inventory.adjusted.

`apps/web/src/contexts/inventory-adjustments-context.tsx`: provider + hook exposing list (for history view if needed) + `create()` action. Wire into BusinessProvidersFromUrl.

Commit.

### Task 6: Frontend — InventoryView, InventoryListItem, AdjustStockModal

Create:
- `apps/web/src/components/inventory/InventoryView.tsx` — list of products sorted by stock asc. Each row tappable, opens AdjustStockModal.
- `apps/web/src/components/inventory/InventoryListItem.tsx` — product name, current stock, `+`/`−` quick actions or single-tap to open modal.
- `apps/web/src/components/inventory/AdjustStockModal.tsx`:
  - Field: `delta` (signed integer input, current stock displayed above for context)
  - Field: `reason` (textarea, optional, max 500)
  - Checkbox: "Log as expense" — **default OFF always**, regardless of delta sign.
  - When checked, reveal: amount (PriceInput), category (ExpenseCategoryPicker).
  - Save: POST /inventory-adjustments with optional expense payload.
  - Optimistic close on success.

CSS in `apps/web/src/styles/inventory-tab.css`. Use CSS variables only.

i18n keys in en-US, es, ja for: inventory tab labels, modal fields, errors. Regen messageIds.

Commit.

### Task 7: Frontend — Replace Orders sub-tab with Inventory under Products

Modify `apps/web/src/components/tab-shell/views/ProductsView.tsx`:
- Replace import of OrdersTab/related with InventoryView.
- Sub-tab label changes from `products.tab_orders` to `products.tab_inventory` (add new i18n key, drop old).
- Tab-switcher logic updated.

Don't delete OrdersTab.tsx yet — that happens in Task 10. Just stop using it.

Commit.

### Task 8: Drop API routes for providers and orders

Delete entire directories:
- `apps/api/src/app/api/businesses/[businessId]/providers/`
- `apps/api/src/app/api/businesses/[businessId]/orders/`

Remove `assertProviderInBusiness` from `apps/api/src/lib/business-auth.ts`.

Remove the PRODUCT_PENDING_ORDER_BLOCK check from `apps/api/src/app/api/businesses/[businessId]/products/[id]/route.ts` — find the block (around lines 294-318) and delete the SELECT-from-orders pre-check plus its error return.

Update `apps/api/src/app/api/businesses/[businessId]/route.ts` business-delete cascade: remove the order_items → orders → provider_notes → providers deletion steps. They'd cascade automatically from the schema FKs once those tables are dropped anyway.

Commit.

### Task 9: Drop providers/orders tables from schema + db:push

Modify `packages/shared/src/db/schema.ts`:
- Delete the `orders` table definition.
- Delete the `orderItems` table definition.
- Delete the `providers` table definition.
- Delete the `providerNotes` table definition.
- Delete the `nextOrderNumber` column from `businesses`.

Run `cd apps/api && npm run db:push` (with `--force` since dropping tables is destructive).

Commit.

### Task 10: Frontend — delete all provider/order components, routes, contexts

Delete:
- `apps/web/src/components/providers/` (entire dir)
- `apps/web/src/components/products/OrdersTab.tsx`
- `apps/web/src/components/products/OrderListItem.tsx`
- `apps/web/src/routes/tabs/ProvidersTab.tsx`
- `apps/web/src/routes/tabs/ProviderDetailPage.tsx`
- `apps/web/src/contexts/providers-context.tsx`
- `apps/web/src/contexts/orders-context.tsx`
- Any related modals, hooks, styles only used by provider/order UI

Update:
- `apps/web/src/routes/BusinessTabsLayout.tsx` — remove ProvidersTab and ProviderDetailPage route registrations.
- `apps/web/src/routes/tabs/ManageTab.tsx` — remove Providers menu entry.
- `apps/web/src/routes/BusinessProvidersFromUrl.tsx` — remove `<ProvidersProvider>` and `<OrdersProvider>` wrappers.
- `apps/web/src/hooks/useSessionCache.ts` — remove `ORDERS` and `PROVIDERS` from cache keys.

Commit.

### Task 11: Shared — remove ApiMessageCodes and realtime events for provider/order

`packages/shared/src/api-messages.ts`: remove all `ORDER_*`, `PROVIDER_*`, `PRODUCT_PENDING_ORDER_BLOCK`.

`packages/shared/src/realtime/types.ts`: remove all `provider.*` and `order.*` variants from the union.

Rebuild shared. Commit.

### Task 12: i18n cleanup + regen

Edit `apps/web/src/i18n/messages/{en-US,es,ja}.json`:
- Remove keys: `provider.*`, `providers.*`, `provider_notes.*`, `provider_modal.*`, `order.*`, `orders.*`, `order_modal.*`, `pending_order.*`.
- Remove `error.ORDER_*`, `success.ORDER_*`, `error.PROVIDER_*`, `success.PROVIDER_*`, `error.PRODUCT_PENDING_ORDER_BLOCK`.
- Add inventory keys (added in Task 6, ensure all 3 locales have parity).
- Regen via `npm run i18n:types --workspace=apps/web`.

Commit.

### Task 13: Final cleanup pass

- `apps/api/src/app/api/businesses/create/route.ts` — if it seeds default providers (it might), remove that.
- Any tests that reference dropped tables/routes — delete them.
- `apps/web/src/lib/realtime/handlers.ts` — sanity check: dispatcher is exhaustive and only contains valid event types.
- Run full lint + tsc + tests across both apps. Fix anything that breaks.

Commit.

### Task 14: Smoke + verification

- `cd apps/api && npx tsc --noEmit` — zero errors (except 0 pre-existing now).
- `cd apps/web && npx tsc --noEmit` — zero errors.
- `cd apps/api && npx vitest run` — all green.
- `npm run build` — succeeds.
- `npm run lint` — zero errors.

No commits unless something needed fixing.
