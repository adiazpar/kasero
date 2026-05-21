# Ledger + Inventory Simplification — Design

**Date:** 2026-05-20
**Status:** Draft v2 (review feedback applied)
**Scope:** Two-phase change. **Phase A** adds expenses as a first-class concept (purely additive, behind a feature flag). **Phase B** removes the provider/order subsystem and replaces it with a lightweight inventory adjustment flow (destructive, gated on Phase A being live and exercised).

---

## Motivation

Two threads collided:

1. **Missing feature:** the app has no notion of business expenses. Users surveyed expressed surprise — running a small business means tracking money out, not just money in.
2. **Existing complexity that isn't pulling weight:** the provider/order subsystem (providers + orders + order items + provider notes, with `pending → received` lifecycle, ETAs, and a relationship graph) over-complicates the flow per user feedback.

Both problems resolve with a single coherent direction: separate the **operational** act of restocking from the **financial** act of recording money spent, offer a one-tap bridge between them, and shed the supplier-relationship machinery. But the implementations have different risk profiles, so we phase them.

---

## Phasing

| Phase | Risk | Reversibility | Ships behind flag? |
|---|---|---|---|
| **A. Add expenses + Ledger tab** | Low (purely additive) | Reversible (drop one table, revert UI) | Yes — `expenses_v1` feature flag |
| **B. Remove providers/orders + add inventory adjustments** | High (destructive migration, dropped tables, UI removal, realtime channel removal) | One-way (Turso PITR window only) | Phase B ships *after* Phase A has been live for ≥1 release and we've confirmed expenses work in production |

Phase A and Phase B are designed in this doc but **planned and shipped as separate PRs**.

---

## Goals

- Add `expenses` as a first-class concept users can record, view, and aggregate.
- Reframe the Sales tab as **Ledger**, with `Sales | Expenses` sub-tabs — one place for the financial story.
- Replace the Orders sub-tab under Products with an **Inventory** sub-tab — lightweight per-product or bulk stock adjustments.
- Preserve the most useful affordance of the old order flow ("I just bought stock, log the spend too") as an optional checkbox on the inventory adjustment screen — single atomic write, with a real FK linking the two records.
- Deprecate and remove the provider/order subsystem cleanly. Migrate received orders to expenses; drop pending orders with a one-time user-visible disclosure list.
- Net result: smaller schema, fewer modals, fewer routes, fewer realtime channels, clearer mental model.

## Non-goals

- Cost-of-goods accounting (per-product margin).
- Supplier analytics, reorder reminders, or any feature that requires modeling a counterparty over time.
- Receipt OCR / auto-extraction from photo (photo attach only).
- Multi-currency expenses.
- Recurring expenses.

---

## Information architecture

### Before

| Bottom tab | Contents |
|---|---|
| Home | Dashboard |
| Sales | Sales list, sessions |
| Products | `Products | Orders` sub-tabs |
| Manage | Providers, team, settings, etc. |

### After (post-Phase B)

| Bottom tab | Contents |
|---|---|
| Home | Dashboard (gains a "this month" summary card in Phase A) |
| **Ledger** *(renamed from Sales in Phase A)* | `Sales | Expenses` sub-tabs |
| Products | `Products | Inventory` sub-tabs *(Phase B: Orders sub-tab replaced)* |
| Manage | Team, settings, etc. *(Phase B: Providers removed)* |

Bottom-bar count stays at 4. No new top-level tab.

**Phase A intermediate state:** Sales tab is renamed Ledger, gains `Expenses` sub-tab, but Products tab still has Orders sub-tab and Manage still has Providers. The Ledger Expenses tab shows only manual expenses during Phase A — no order data appears there. This is deliberate so we can ship expenses without coupling them to the destructive cut.

---

## Data model

### Phase A: new tables

#### `expenses`

```ts
export const expenses = sqliteTable('expenses', {
  id: text('id').primaryKey(),
  businessId: text('business_id').references(() => businesses.id, { onDelete: 'cascade' }).notNull(),
  createdByUserId: text('created_by_user_id').references(() => users.id).notNull(),
  expenseNumber: integer('expense_number'),               // per-business sequential, auto-numbered (mirrors orderNumber/saleNumber)
  date: integer('date', { mode: 'timestamp' }).notNull(),
  amount: real('amount').notNull(),                       // business currency
  categoryId: text('category_id').references(() => expenseCategories.id),  // nullable
  note: text('note'),
  photoUrl: text('photo_url'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),  // SQL-level default, matches products
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
}, (table) => [
  index('idx_expenses_business_id').on(table.businessId),
  index('idx_expenses_business_date').on(table.businessId, table.date),
])
```

#### `expense_categories`

Mirrors `product_categories` (relation, not free-text). Avoids the hybrid English-leak problem from v1 of this spec.

```ts
export const expenseCategories = sqliteTable('expense_categories', {
  id: text('id').primaryKey(),
  businessId: text('business_id').references(() => businesses.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
}, (table) => [
  index('idx_expense_categories_business_id').on(table.businessId),
])
```

On business creation, seed a small default set per business: `Supplies`, `Fees`, `Transport`, `Other`. Seeded with the business's `locale`-appropriate names (use the same seeding pattern used elsewhere for default product categories if one exists; otherwise seed in `en-US` and let user rename — see open questions). Users can rename, delete, and add categories; same UI primitives as product categories.

#### `businesses.nextExpenseNumber`

Add column mirroring `nextOrderNumber` / `nextSaleNumber` / `nextProductNumber` at `schema.ts:19-26`. Used to compute per-business `expenseNumber`.

### Phase B: new table

#### `inventory_adjustments`

Cheap log, no v1 UI surface. Carries the FK that links to optionally-created expenses. Answers "where did 30 units go?" the moment a user asks.

```ts
export const inventoryAdjustments = sqliteTable('inventory_adjustments', {
  id: text('id').primaryKey(),
  businessId: text('business_id').references(() => businesses.id, { onDelete: 'cascade' }).notNull(),
  productId: text('product_id').references(() => products.id, { onDelete: 'cascade' }).notNull(),
  createdByUserId: text('created_by_user_id').references(() => users.id).notNull(),
  delta: integer('delta').notNull(),                                     // signed; +50 = restock, -3 = spoilage
  reason: text('reason'),                                                // free-text note, nullable
  relatedExpenseId: text('related_expense_id').references(() => expenses.id, { onDelete: 'set null' }),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
}, (table) => [
  index('idx_inventory_adjustments_business_id').on(table.businessId),
  index('idx_inventory_adjustments_product_id').on(table.productId),
  index('idx_inventory_adjustments_business_created').on(table.businessId, table.createdAt),
])
```

`products.stock` continues to be the source of truth for current stock; `inventory_adjustments` is the audit log of changes. Every insert into `inventory_adjustments` is paired with a `products.stock` mutation **in the same Drizzle transaction** (see Bridge below).

### Phase B: tables to drop

After the data migration in Phase B:
- `orders`
- `order_items`
- `providers`
- `provider_notes`
- `businesses.nextOrderNumber` column

### Realtime channels

**Phase A adds:**
- `expense.created`, `expense.updated`, `expense.deleted` — business channel, non-critical (UI hints), fail open per `realtime-system.md`.

**Phase B removes:**
- All `provider.*` event types and their client handlers / context registrations (`providers-context.tsx`, `orders-context.tsx`). Recent commit `b1c0bac4` explicitly wired provider event handlers — those are removed in the same PR as the schema drop.
- All `order.*` event types and handlers.

**Phase B adds:**
- `inventory.adjusted` — business channel, non-critical, fail open. Includes `productId`, `delta`, `newStock`, optional `relatedExpenseId`. Replaces what `product.updated` partially covered for stock changes; `product.updated` continues to fire for non-stock product edits.

---

## Migration plan (Phase B)

One-shot data migration, run on Phase B deploy. **Idempotent** (checks `expenses.id` collisions via deterministic ID derivation from `orders.id`).

### Step 1 — Migrate `status='received'` orders to expenses

For each row in `orders` where `status = 'received'`:

1. Insert into `expenses`:
   - `id`: deterministic UUIDv5 derived from `orders.id` (so re-running the migration is a no-op).
   - `businessId`, `createdByUserId`: copied (use `receivedByUserId` if `createdByUserId` is null per the `// legacy rows from before this column existed` note at `schema.ts:264-266`).
   - `expenseNumber`: NULL on migrated rows; new expenses post-migration get sequential numbers. (Alternative: backfill from `orderNumber`. **Recommendation: backfill** — preserves the user-visible reference users may have memorized.)
   - `date`: `orders.receivedDate` (the day the money actually went out, per ledger semantics).
   - `amount`: `orders.total`.
   - `categoryId`: the per-business "Supplies" category id (looked up; seeded if absent).
   - `note`: structured composition. Format:
     ```
     {providerName} — order #{orderNumber}
     {itemName} ×{qty} @ {unitCost} = {lineTotal}
     {itemName} ×{qty} @ {unitCost} = {lineTotal}
     ...
     ```
     Truncate at 2000 chars (note column is unbounded in SQLite, choose a sensible cap). If `providers` row missing, use literal string "Unknown provider".
   - `photoUrl`: null.

### Step 2 — Handle `status='pending'` orders explicitly

Pending orders represent money the user has not spent yet. Migrating them as expenses backfills false spend. They are **not** silently converted.

Instead:

1. Before Phase B deploys, the Phase A release ships a one-time banner / screen visible to users with pending orders, listing them with provider name, date, total, and items. Copy: *"We're simplifying how orders work. These pending orders will be removed in the next update. Mark them received (or take note) before then."*
2. On Phase B deploy, any pending orders still in the database are dropped with their items. No expense rows are created from them.
3. The decision and disclosure window is documented in the user-facing changelog.

### Step 3 — Drop tables

After expense inserts complete and verification queries confirm row counts:

```sql
DROP TABLE order_items;
DROP TABLE orders;
DROP TABLE provider_notes;
DROP TABLE providers;
ALTER TABLE businesses DROP COLUMN next_order_number;
```

### Explicitly dropped data

The migration is **not lossless**. These are dropped:

| Dropped field | Why it's acceptable |
|---|---|
| `order_items.unitCost` | Preserved in the composed note string for human reference; not queryable. |
| `order_items.quantity`, `productName` snapshot | Preserved in note string. |
| `orders.estimatedArrival` | Only relevant to pending orders, which are dropped wholesale. |
| `orders.createdBy` vs `receivedBy` distinction | Collapsed into one `createdByUserId`. |
| `providers.contact` and other provider metadata | Lost. Provider name preserved in expense note. |
| `provider_notes.*` | Lost entirely. Users with active provider notes are warned in the same pre-Phase-B disclosure as pending orders. |

This is a deliberate trade documented in the user-facing release notes.

### Rollback

Phase B is destructive. Rollback policy:

- Take a Turso snapshot immediately before running the migration. Verify the snapshot before proceeding.
- After deploy, any `expenses` or `inventory_adjustments` rows created by users will be lost if we restore. Document this explicitly in the runbook.
- Turso PITR window is finite; the verification period (during which a rollback decision could be made) must fit inside it. Confirm the current window before scheduling Phase B; defer if it's shorter than 24h.
- Rollback path: restore snapshot → revert Phase B deploy → users see Phase A state again (expenses table preserved with no new data, providers/orders back).

---

## UI changes

### Phase A: Ledger tab

- Renamed from Sales. Tab key changes from `sales` to `ledger`; sub-tab labels remain `Sales` and `Expenses`.
- Same `BusinessHeader` + `IonContent` shell.
- `TabContainer` with `Sales` (existing list, unchanged) and `Expenses` (new list).
- Expense list row: amount (large, right-aligned), category chip, date, photo thumbnail if present. Tap → detail modal.
- Totals strip at top: "This month: $X" for the sub-tab in view.
- FAB / add button on the Expenses sub-tab → opens `AddExpenseModal`.
- Date-grouped, newest first; matches Sales' existing visual treatment.

### Phase A: `AddExpenseModal` and `EditExpenseModal`

Per `.claude/docs/modal-system.md`:

- Single step (no wizard).
- Fields: `amount` (PriceInput, required), `date` (date picker, default today), `categoryId` (combo from `expense_categories` with "Add category…" affordance), `note` (multiline, optional), `photo` (camera/gallery picker via existing upload pipeline, optional).
- Footer: Cancel | Save. Optimistic UI per existing patterns.
- Separate add and edit modals — never combine with conditional rendering.

### Phase A: Home summary card

Card on Home showing the current month: `+ $income / − $expenses / net $X`. Three colored numbers, tap to drill into Ledger on the corresponding sub-tab. Net number is the headline.

**Deferral option:** ship Ledger + AddExpenseModal first, ship the Home card in a follow-up if it pushes scope. Decision in open questions.

### Phase B: Inventory sub-tab (replaces Orders sub-tab under Products)

- List of products with current stock, sorted by lowest stock first.
- Each row: product name, current stock, quick `+` / `−` buttons that open the adjustment sheet (Modal compound component, single step).
- Top-right "Bulk adjust" toggle enables stocktake mode: checklist-style entry of new stock counts across products. Optional, not the primary flow.
- "History" affordance (top-right) opens a per-business chronological list of `inventory_adjustments` — read-only, deep-link to product detail. Useful for the "where did 30 units go?" case.

### Phase B: Inventory adjustment sheet (the bridge)

Fields:
- `delta` (signed number) — current stock displayed above for reference.
- `reason` (optional free-text).
- **Checkbox: "Log as expense"** — **default checked when `delta > 0`**, default unchecked when `delta ≤ 0`. Restocks usually cost money; removals (spoilage, transfer out) usually do not.
- When checkbox is checked, reveals `amount` (PriceInput) and `categoryId` (combo, default "Supplies"). The amount field gains focus immediately after the user enters a positive delta.

Footer: Cancel | Save.

### Bridge: single atomic write

The sheet calls **one endpoint**, not two:

```
POST /api/businesses/:bid/inventory-adjustments
{
  productId: string,
  delta: number,
  reason?: string,
  expense?: {
    amount: number,
    categoryId?: string,
  }
}
```

Server handler in a single Drizzle transaction:
1. Insert `expenses` row (if `expense` payload present), capture id.
2. Insert `inventory_adjustments` row with `relatedExpenseId` (or null).
3. Update `products.stock` by `delta`.
4. Publish `inventory.adjusted` realtime event (and `expense.created` if applicable), post-commit.

Failure modes: any DB error rolls back all writes — no partial state. Network failure mid-flight: client retries with idempotency key (request UUID generated client-side, server dedupes on it). Matches the offline-envelope conventions in `backend-patterns.md`.

Editing an expense that has a related inventory adjustment: the inventory adjustment is **not** re-derived. The link is for traceability only; editing/deleting one record leaves the other intact. UI surfaces the link in both detail modals ("Related: stock +30" / "Related: expense $50") so the user can navigate between them.

Deleting an expense that has a related inventory adjustment: the adjustment's `relatedExpenseId` is set to NULL via the FK's `onDelete: 'set null'`. The audit row remains. Symmetrically, deleting a product cascades the adjustment rows away (which is fine — they're audit, not source-of-truth).

---

## API + routes

### Phase A: new routes

- `POST   /api/businesses/:bid/expenses`
- `GET    /api/businesses/:bid/expenses` (paginated, date-filterable)
- `GET    /api/businesses/:bid/expenses/:id`
- `PATCH  /api/businesses/:bid/expenses/:id`
- `DELETE /api/businesses/:bid/expenses/:id`
- `GET    /api/businesses/:bid/expenses/summary` (monthly aggregates for Home card)
- `POST   /api/businesses/:bid/expense-categories`
- `GET    /api/businesses/:bid/expense-categories`
- `PATCH  /api/businesses/:bid/expense-categories/:id`
- `DELETE /api/businesses/:bid/expense-categories/:id`

All return `ApiMessageCode` envelopes. All inputs validated with Zod using the generic issue mapper. Photos go through the existing icon-upload pipeline (same CSP origin, same constraints).

### Phase B: new route

- `POST   /api/businesses/:bid/inventory-adjustments` — single atomic endpoint described in Bridge above.
- `GET    /api/businesses/:bid/inventory-adjustments` — list for the Inventory History view.

### Phase B: routes to remove

- All `/api/businesses/:bid/providers/*` (list, create, read, update, delete, notes CRUD).
- All `/api/businesses/:bid/orders/*` (list, create, receive, update, delete, line items).

Net route delta: Phase A `+10`, Phase B `−12 + 2 = −10`. Overall: roughly flat, with a clearer surface.

### Cleanup checklist (Phase B)

These are easy to miss and will leave dangling code if forgotten. The Phase B PR explicitly addresses all of them:

- `apps/api/src/lib/business-auth.ts:222-232` — remove `assertProviderInBusiness()` helper.
- `apps/api/src/app/api/businesses/[businessId]/products/[id]/route.ts:294-318` — remove the `PRODUCT_PENDING_ORDER_BLOCK` check; the block is meaningless without orders.
- `packages/shared/src/api-messages.ts:74` — remove `PRODUCT_PENDING_ORDER_BLOCK` and all `ORDER_*` / `PROVIDER_*` codes.
- `apps/web/src/i18n/messages/{en-US,es,ja}.json` — remove translations for all `ORDER_*` / `PROVIDER_*` / `PRODUCT_PENDING_ORDER_BLOCK` keys. Regenerate `messageIds.d.ts`.
- `apps/api/src/app/api/businesses/[businessId]/route.ts:231-323` — remove `order_items → orders → provider_notes → providers` from the manual business-delete cascade transaction. Add `expenses` + `expense_categories` + `inventory_adjustments` (though `onDelete: 'cascade'` should handle these automatically — verify).
- `apps/web/src/lib/realtime/` — remove `provider.*` and `order.*` event types from `realtime/types.ts:81-109`.
- `apps/web/src/contexts/providers-context.tsx`, `orders-context.tsx` — delete (or remove provider/order portions if shared with anything surviving).
- All provider/order UI: `routes/tabs/ProvidersTab.tsx`, `ProviderDetailPage.tsx`, `components/providers/**`, `components/products/OrdersTab.tsx`, `OrderListItem.tsx`, and any modals under them.
- Tests for the above — delete in the same PR. Any mock or fixture that references provider/order tables will fail loudly post-drop; that's the intended signal.

---

## i18n

Per the 7 rules in `.claude/docs/i18n-system.md`:

- New message IDs land in `en-US.json` first under `ledger.*`, `expenses.*`, `inventory.*`. Translations added directly for `es.json` and `ja.json`.
- After adding keys: regenerate `apps/web/src/i18n/messageIds.d.ts` via `npm run i18n:types --workspace=apps/web`.
- Phase B removes translations for the dropped keys in all three locales.

### Phase A new `ApiMessageCode` values

Following the existing subject-first naming pattern (`ORDER_INVALID_DATE`, `SALE_INVALID_DATE`):

- `EXPENSE_CREATED`
- `EXPENSE_UPDATED`
- `EXPENSE_DELETED`
- `EXPENSE_NOT_FOUND`
- `EXPENSE_FORBIDDEN_NOT_MANAGER`  *(matches `ORDER_FORBIDDEN_NOT_MANAGER`, `PROVIDER_FORBIDDEN_NOT_MANAGER`)*
- `EXPENSE_ID_REQUIRED`
- `EXPENSE_INVALID_AMOUNT`
- `EXPENSE_INVALID_DATE`
- `EXPENSE_CATEGORY_CREATED`, `EXPENSE_CATEGORY_UPDATED`, `EXPENSE_CATEGORY_DELETED`, `EXPENSE_CATEGORY_NOT_FOUND`
- `EXPENSE_CATEGORY_IN_USE` *(deletion blocked when expenses reference it; mirrors `PRODUCT_CATEGORY_IN_USE` if it exists)*

### Phase B new `ApiMessageCode` values

- `INVENTORY_ADJUSTMENT_CREATED`
- `INVENTORY_ADJUSTMENT_INVALID_DELTA`
- `INVENTORY_ADJUSTMENT_FORBIDDEN_NOT_MANAGER`

---

## Open questions for review

1. **Pending-order disclosure UX.** Banner in Ledger tab, modal on app open, both, or a dedicated screen in Manage? Recommendation: a small dismissible banner on the Ledger tab during Phase A, plus a one-time modal on Phase B first open listing the exact orders that will be dropped.
2. **`expenseNumber` backfill from `orderNumber`.** Recommendation: backfill. Preserves user-visible references.
3. **Seed expense category names — locale-aware or `en-US`?** Recommendation: seed in the business `locale` if a translation exists; fall back to `en-US`. Reuse whatever pattern `product_categories` uses (verify during plan).
4. **Home summary card timing.** Ship in Phase A or defer? Recommendation: ship in Phase A. It's the only piece touching Home and it sells the feature at first sight.
5. **Phase A feature flag scope.** Per-business opt-in for early validation, or global on/off? Recommendation: global. The feature is non-destructive; flag exists only to gate enablement during initial rollout.
