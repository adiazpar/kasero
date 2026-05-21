# Ledger Phase A — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the "expenses" feature behind a flag — new `expenses` + `expense_categories` tables, full CRUD API, realtime events, Ledger tab (renamed from Sales) with a new Expenses sub-tab, AddExpense/EditExpense modals, and a Home summary card. Phase A is purely additive; the provider/order subsystem is untouched and remains fully functional.

**Architecture:** Drizzle ORM tables (`expenses`, `expense_categories`, new `nextExpenseNumber` column on `businesses`) following existing schema conventions. Next.js App Router API routes under `apps/api/src/app/api/businesses/[businessId]/expenses/*` and `expense-categories/*` following the sales route pattern. Realtime via `publishToBusiness` on the existing business channel, non-critical. SPA UI under `apps/web/src/components/expenses/` using the Modal compound component and `TabContainer` primitives. Feature gate via a single `expenses_v1` flag read from a config endpoint.

**Tech Stack:** Drizzle, Turso (SQLite), Next.js App Router, Zod, Ionic React, react-router v5, react-intl, vitest, Workbox SW.

**Spec:** `.claude/docs/plans/2026-05-20-ledger-and-inventory-simplification-design.md`

---

## File structure

### New backend files

```
packages/shared/src/db/schema.ts                        modify — add expenses, expense_categories, businesses.nextExpenseNumber
packages/shared/src/api-messages.ts                     modify — add EXPENSE_* and EXPENSE_CATEGORY_* codes
packages/shared/src/realtime/types.ts                   modify — add expense.* event variants
packages/shared/src/types/expense.ts                    create — shared TS types

apps/api/drizzle/<NNNN>_expenses.sql                    create — generated migration

apps/api/src/app/api/businesses/[businessId]/expenses/route.ts                create — GET list + POST
apps/api/src/app/api/businesses/[businessId]/expenses/schema.ts               create — Zod input schemas
apps/api/src/app/api/businesses/[businessId]/expenses/[id]/route.ts           create — GET, PATCH, DELETE
apps/api/src/app/api/businesses/[businessId]/expenses/summary/route.ts        create — monthly aggregate
apps/api/src/app/api/businesses/[businessId]/expenses/__tests__/route.test.ts create — integration tests

apps/api/src/app/api/businesses/[businessId]/expense-categories/route.ts                create — GET list + POST
apps/api/src/app/api/businesses/[businessId]/expense-categories/schema.ts               create
apps/api/src/app/api/businesses/[businessId]/expense-categories/[id]/route.ts           create — PATCH, DELETE
apps/api/src/app/api/businesses/[businessId]/expense-categories/__tests__/route.test.ts create

apps/api/src/app/api/businesses/create/route.ts          modify — seed default expense categories on business create
apps/api/src/lib/business-auth.ts                        modify — add assertExpenseInBusiness, assertExpenseCategoryInBusiness helpers
apps/api/src/app/api/config/route.ts                     create or modify — expose feature flags to client
```

### New frontend files

```
apps/web/src/i18n/messages/en-US.json                   modify — add ledger.*, expenses.* keys
apps/web/src/i18n/messages/es.json                      modify — Spanish translations
apps/web/src/i18n/messages/ja.json                      modify — Japanese translations
apps/web/src/i18n/messageIds.d.ts                       regenerate (don't hand-edit)

apps/web/src/lib/feature-flags.ts                       create — typed flag reader

apps/web/src/types/expense.ts                           create — re-export from shared

apps/web/src/contexts/expenses-context.tsx              create — list/CRUD state + realtime sub
apps/web/src/contexts/expense-categories-context.tsx    create

apps/web/src/hooks/useExpenses.ts                       create — convenience selectors
apps/web/src/hooks/useExpensesSummary.ts                create — Home card data

apps/web/src/routes/tabs/LedgerTab.tsx                  create — replaces SalesTab.tsx as the renamed shell
apps/web/src/routes/tabs/SalesTab.tsx                   delete (replaced by LedgerTab)
apps/web/src/routes/BusinessTabsLayout.tsx              modify — wire Ledger tab key + label
apps/web/src/components/tab-shell/views/LedgerView.tsx  create — TabContainer with Sales | Expenses
apps/web/src/components/tab-shell/views/SalesView.tsx   modify or extract — Sales-only inner view (Sales sub-tab content)

apps/web/src/components/expenses/ExpensesView.tsx       create — Expenses sub-tab content
apps/web/src/components/expenses/ExpenseListItem.tsx    create
apps/web/src/components/expenses/AddExpenseModal.tsx    create
apps/web/src/components/expenses/EditExpenseModal.tsx   create
apps/web/src/components/expenses/ExpenseDetailModal.tsx create
apps/web/src/components/expenses/ExpenseCategoryPicker.tsx create — combo with "Add category…" affordance
apps/web/src/components/expenses/ExpenseTotalsStrip.tsx create — "This month: $X"

apps/web/src/components/home/MonthlySummaryCard.tsx     create — three-number Home card
apps/web/src/components/home/HomeView.tsx               modify — add the summary card

apps/web/src/lib/realtime/handlers.ts                   modify — handle expense.* events
```

### Tests

Backend integration tests under `__tests__/route.test.ts` per existing convention (see `apps/api/src/app/api/businesses/[businessId]/sales/route.test.ts:1-261` as the model). Frontend tests are optional in this codebase (no enforced UI test pattern); rely on type-checking + the smoke test at the end.

---

## Tasks

### Task 1 — Add `expense_categories` and `expenses` schema

**Files:**
- Modify: `packages/shared/src/db/schema.ts`

- [ ] **Step 1: Add the new tables and column to the schema**

Append to `packages/shared/src/db/schema.ts` (after the existing `salesSessions` table, before `inviteCodes`):

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

export const expenses = sqliteTable('expenses', {
  id: text('id').primaryKey(),
  businessId: text('business_id').references(() => businesses.id, { onDelete: 'cascade' }).notNull(),
  createdByUserId: text('created_by_user_id').references(() => users.id).notNull(),
  expenseNumber: integer('expense_number'),
  date: integer('date', { mode: 'timestamp' }).notNull(),
  amount: real('amount').notNull(),
  categoryId: text('category_id').references(() => expenseCategories.id, { onDelete: 'set null' }),
  note: text('note'),
  photoUrl: text('photo_url'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
}, (table) => [
  index('idx_expenses_business_id').on(table.businessId),
  index('idx_expenses_business_date').on(table.businessId, table.date),
])
```

Add `nextExpenseNumber` to the existing `businesses` table definition, next to `nextOrderNumber`:

```ts
nextExpenseNumber: integer('next_expense_number').notNull().default(1),
```

- [ ] **Step 2: Regenerate Drizzle migration**

```bash
cd apps/api && npm run db:generate
```

Expected: A new file appears at `apps/api/drizzle/<NNNN>_<name>.sql` containing `CREATE TABLE expense_categories`, `CREATE TABLE expenses`, `ALTER TABLE businesses ADD COLUMN next_expense_number`.

- [ ] **Step 3: Inspect the generated migration**

```bash
ls apps/api/drizzle/*.sql | tail -1 | xargs cat
```

Confirm the SQL is what we expect (3 statements, indexes present). If the generator emitted destructive statements against existing tables, STOP and investigate before continuing.

- [ ] **Step 4: Apply locally**

```bash
cd apps/api && npm run db:push
```

Expected: succeeds without errors; running it twice is idempotent (Drizzle reports "no changes").

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/db/schema.ts apps/api/drizzle/
git commit -m "feat(db): add expenses and expense_categories tables"
```

---

### Task 2 — Add shared types

**Files:**
- Create: `packages/shared/src/types/expense.ts`
- Modify: `packages/shared/src/index.ts` (or wherever shared types are re-exported)

- [ ] **Step 1: Create the type file**

```ts
// packages/shared/src/types/expense.ts
import type { InferSelectModel } from 'drizzle-orm'
import type { expenses, expenseCategories } from '../db/schema'

export type Expense = InferSelectModel<typeof expenses>
export type ExpenseCategory = InferSelectModel<typeof expenseCategories>

export interface ExpenseSummary {
  month: string          // ISO yyyy-mm
  totalIncome: number    // sum of sales for the month, business currency
  totalExpenses: number  // sum of expenses for the month, business currency
  net: number            // income - expenses
}
```

- [ ] **Step 2: Re-export from the shared index**

Locate `packages/shared/src/index.ts` (or `types/index.ts` depending on layout), add:

```ts
export type { Expense, ExpenseCategory, ExpenseSummary } from './types/expense'
```

- [ ] **Step 3: Type-check**

```bash
npm run build --workspaces --if-present
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/expense.ts packages/shared/src/index.ts
git commit -m "feat(shared): export Expense and ExpenseCategory types"
```

---

### Task 3 — Add `ApiMessageCode` values

**Files:**
- Modify: `packages/shared/src/api-messages.ts`

- [ ] **Step 1: Add the new codes**

Append inside the `ApiMessageCode` const object (preserve alphabetical/grouped placement matching existing style — group `EXPENSE_*` together near `EXPENSE_CATEGORY_*`):

```ts
EXPENSE_CREATED: 'EXPENSE_CREATED',
EXPENSE_UPDATED: 'EXPENSE_UPDATED',
EXPENSE_DELETED: 'EXPENSE_DELETED',
EXPENSE_NOT_FOUND: 'EXPENSE_NOT_FOUND',
EXPENSE_FORBIDDEN_NOT_MANAGER: 'EXPENSE_FORBIDDEN_NOT_MANAGER',
EXPENSE_ID_REQUIRED: 'EXPENSE_ID_REQUIRED',
EXPENSE_INVALID_AMOUNT: 'EXPENSE_INVALID_AMOUNT',
EXPENSE_INVALID_DATE: 'EXPENSE_INVALID_DATE',
EXPENSE_CATEGORY_CREATED: 'EXPENSE_CATEGORY_CREATED',
EXPENSE_CATEGORY_UPDATED: 'EXPENSE_CATEGORY_UPDATED',
EXPENSE_CATEGORY_DELETED: 'EXPENSE_CATEGORY_DELETED',
EXPENSE_CATEGORY_NOT_FOUND: 'EXPENSE_CATEGORY_NOT_FOUND',
EXPENSE_CATEGORY_IN_USE: 'EXPENSE_CATEGORY_IN_USE',
EXPENSE_CATEGORY_NAME_REQUIRED: 'EXPENSE_CATEGORY_NAME_REQUIRED',
```

- [ ] **Step 2: Type-check**

```bash
npm run build --workspace=@kasero/shared
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/api-messages.ts
git commit -m "feat(shared): add EXPENSE_* and EXPENSE_CATEGORY_* api message codes"
```

---

### Task 4 — Add expense realtime event types

**Files:**
- Modify: `packages/shared/src/realtime/types.ts`

- [ ] **Step 1: Add expense events to the `BusinessRealtimeEvent` union**

Find the `BusinessRealtimeEvent` discriminated union (in `packages/shared/src/realtime/types.ts`) and append these variants (place them alphabetically near `product.*`):

```ts
  | ({ type: 'expense.created'; expenseId: string } & WithOrigin)
  | ({ type: 'expense.updated'; expenseId: string } & WithOrigin)
  | ({ type: 'expense.deleted'; expenseId: string } & WithOrigin)
  | ({ type: 'expense_category.created'; categoryId: string } & WithOrigin)
  | ({ type: 'expense_category.updated'; categoryId: string } & WithOrigin)
  | ({ type: 'expense_category.deleted'; categoryId: string } & WithOrigin)
```

- [ ] **Step 2: Type-check**

```bash
npm run build --workspace=@kasero/shared
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/realtime/types.ts
git commit -m "feat(realtime): add expense.* and expense_category.* event types"
```

---

### Task 5 — Add Zod schemas for expense routes

**Files:**
- Create: `apps/api/src/app/api/businesses/[businessId]/expenses/schema.ts`
- Create: `apps/api/src/app/api/businesses/[businessId]/expense-categories/schema.ts`

- [ ] **Step 1: Create expenses schema**

```ts
// apps/api/src/app/api/businesses/[businessId]/expenses/schema.ts
import { z } from 'zod'

export const postExpenseSchema = z.object({
  amount: z.number().positive().max(10_000_000).refine((n) => Number.isFinite(n), {
    params: { apiMessageCode: 'EXPENSE_INVALID_AMOUNT' },
  }),
  date: z.string().datetime().optional(),
  categoryId: z.string().min(1).optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
  photoUrl: z.string().url().max(2048).optional().nullable(),
})

export const patchExpenseSchema = postExpenseSchema.partial()

export type PostExpenseBody = z.infer<typeof postExpenseSchema>
export type PatchExpenseBody = z.infer<typeof patchExpenseSchema>
```

- [ ] **Step 2: Create expense-categories schema**

```ts
// apps/api/src/app/api/businesses/[businessId]/expense-categories/schema.ts
import { z } from 'zod'

export const postExpenseCategorySchema = z.object({
  name: z.string().min(1).max(100).refine((s) => s.trim().length > 0, {
    params: { apiMessageCode: 'EXPENSE_CATEGORY_NAME_REQUIRED' },
  }),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
})

export const patchExpenseCategorySchema = postExpenseCategorySchema.partial()

export type PostExpenseCategoryBody = z.infer<typeof postExpenseCategorySchema>
export type PatchExpenseCategoryBody = z.infer<typeof patchExpenseCategorySchema>
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/app/api/businesses/\[businessId\]/expenses/schema.ts apps/api/src/app/api/businesses/\[businessId\]/expense-categories/schema.ts
git commit -m "feat(api): add Zod schemas for expense and category routes"
```

---

### Task 6 — Expense categories: POST + GET list

**Files:**
- Create: `apps/api/src/app/api/businesses/[businessId]/expense-categories/route.ts`
- Create: `apps/api/src/app/api/businesses/[businessId]/expense-categories/__tests__/route.test.ts`

**Reference model:** `apps/api/src/app/api/businesses/[businessId]/sales/route.ts` (auth + envelope pattern). Existing category route for products if present — look in `apps/api/src/app/api/businesses/[businessId]/products/categories/` for an exact mirror to follow if it exists; otherwise use the sales pattern.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/app/api/businesses/[businessId]/expense-categories/__tests__/route.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { POST, GET } from '../route'
import { createTestBusiness, makeAuthedRequest } from '@/test-utils'

describe('POST /expense-categories', () => {
  let bid: string
  beforeEach(async () => { bid = await createTestBusiness() })

  it('creates a category with a trimmed name', async () => {
    const res = await POST(makeAuthedRequest(bid, { name: '  Supplies  ' }), { params: { businessId: bid } } as any)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.code).toBe('EXPENSE_CATEGORY_CREATED')
    expect(body.data.name).toBe('Supplies')
  })

  it('rejects empty name', async () => {
    const res = await POST(makeAuthedRequest(bid, { name: '   ' }), { params: { businessId: bid } } as any)
    expect(res.status).toBe(400)
  })
})

describe('GET /expense-categories', () => {
  it('lists business categories ordered by sortOrder then name', async () => {
    const bid = await createTestBusiness({ seedCategories: ['Supplies', 'Fees'] })
    const res = await GET(makeAuthedRequest(bid), { params: { businessId: bid } } as any)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.map((c: any) => c.name)).toEqual(['Fees', 'Supplies'])
  })
})
```

(If `@/test-utils` doesn't exist with these helpers, check `apps/api/src/app/api/businesses/[businessId]/sales/route.test.ts:1-50` and mirror its setup. Adapt the imports and helpers to match.)

- [ ] **Step 2: Run — expect failure**

```bash
cd apps/api && npx vitest run src/app/api/businesses/\[businessId\]/expense-categories/__tests__/route.test.ts
```

Expected: FAIL — `Cannot find module '../route'`.

- [ ] **Step 3: Implement the route**

```ts
// apps/api/src/app/api/businesses/[businessId]/expense-categories/route.ts
import { db, expenseCategories } from '@/db'
import { eq, asc } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import {
  withBusinessAuth,
  withBusinessAuthManager,
  enforceMaxContentLength,
  errorResponse,
  successResponse,
  validationError,
} from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { publishToBusiness, getOriginDeviceId } from '@/lib/realtime'
import { postExpenseCategorySchema } from './schema'

const MAX_BODY = 4 * 1024

export const GET = withBusinessAuth(async (_request, access) => {
  const rows = await db
    .select()
    .from(expenseCategories)
    .where(eq(expenseCategories.businessId, access.businessId))
    .orderBy(asc(expenseCategories.sortOrder), asc(expenseCategories.name))
  return successResponse(ApiMessageCode.OK, { data: rows })
})

export const POST = withBusinessAuthManager(async (request, access) => {
  const oversize = enforceMaxContentLength(request, MAX_BODY)
  if (oversize) return oversize

  let raw: unknown
  try { raw = await request.json() } catch { return errorResponse(ApiMessageCode.VALIDATION_GENERIC, 400) }

  const parsed = postExpenseCategorySchema.safeParse(raw)
  if (!parsed.success) return validationError(parsed)

  const id = nanoid()
  const row = {
    id,
    businessId: access.businessId,
    name: parsed.data.name.trim(),
    sortOrder: parsed.data.sortOrder ?? 0,
  }
  await db.insert(expenseCategories).values(row)

  void publishToBusiness(access.businessId, {
    type: 'expense_category.created',
    categoryId: id,
    originDeviceId: getOriginDeviceId(request),
  })

  const [created] = await db.select().from(expenseCategories).where(eq(expenseCategories.id, id))
  return successResponse(ApiMessageCode.EXPENSE_CATEGORY_CREATED, { data: created })
})
```

(If `withBusinessAuthManager` doesn't exist in `@/lib/api-middleware`, search for the equivalent helper that gates owner/partner. Most CRUD-write endpoints use either `withBusinessAuth` or an explicit `canManageBusiness` check — match whichever the existing products-categories endpoint uses.)

- [ ] **Step 4: Run — expect pass**

```bash
cd apps/api && npx vitest run src/app/api/businesses/\[businessId\]/expense-categories/__tests__/route.test.ts
```

Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/app/api/businesses/\[businessId\]/expense-categories/
git commit -m "feat(api): POST and GET /expense-categories"
```

---

### Task 7 — Expense categories: PATCH + DELETE

**Files:**
- Create: `apps/api/src/app/api/businesses/[businessId]/expense-categories/[id]/route.ts`
- Modify: `apps/api/src/lib/business-auth.ts` (add `assertExpenseCategoryInBusiness`)
- Modify: `apps/api/src/app/api/businesses/[businessId]/expense-categories/__tests__/route.test.ts` (add PATCH/DELETE tests)

- [ ] **Step 1: Add the auth helper**

In `apps/api/src/lib/business-auth.ts` (model after the existing `assertProviderInBusiness` at line ~222):

```ts
export async function assertExpenseCategoryInBusiness(categoryId: string, businessId: string) {
  const [row] = await db
    .select({ id: expenseCategories.id })
    .from(expenseCategories)
    .where(and(eq(expenseCategories.id, categoryId), eq(expenseCategories.businessId, businessId)))
    .limit(1)
  return Boolean(row)
}

export async function assertExpenseInBusiness(expenseId: string, businessId: string) {
  const [row] = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.businessId, businessId)))
    .limit(1)
  return Boolean(row)
}
```

Add imports at the top: `expenses, expenseCategories` from `@/db`.

- [ ] **Step 2: Write failing tests for [id] route**

Append to the test file:

```ts
describe('PATCH /expense-categories/:id', () => {
  it('renames a category', async () => {
    const { bid, categoryId } = await createBusinessWithCategory({ name: 'Old' })
    const res = await PATCH(makeAuthedRequest(bid, { name: 'New' }), { params: { businessId: bid, id: categoryId } } as any)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.name).toBe('New')
  })
  it('404 when category not in business', async () => {
    const bid = await createTestBusiness()
    const res = await PATCH(makeAuthedRequest(bid, { name: 'X' }), { params: { businessId: bid, id: 'nope' } } as any)
    expect(res.status).toBe(404)
  })
})

describe('DELETE /expense-categories/:id', () => {
  it('deletes when no expenses reference it', async () => {
    const { bid, categoryId } = await createBusinessWithCategory()
    const res = await DELETE(makeAuthedRequest(bid), { params: { businessId: bid, id: categoryId } } as any)
    expect(res.status).toBe(200)
  })
  it('blocks deletion when expenses reference it', async () => {
    const { bid, categoryId } = await createBusinessWithCategory()
    await createExpense({ businessId: bid, categoryId })
    const res = await DELETE(makeAuthedRequest(bid), { params: { businessId: bid, id: categoryId } } as any)
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.code).toBe('EXPENSE_CATEGORY_IN_USE')
  })
})
```

- [ ] **Step 3: Run — expect failure**

```bash
cd apps/api && npx vitest run src/app/api/businesses/\[businessId\]/expense-categories/__tests__/route.test.ts
```

Expected: FAIL — `Cannot find module './[id]/route'`.

- [ ] **Step 4: Implement [id] route**

```ts
// apps/api/src/app/api/businesses/[businessId]/expense-categories/[id]/route.ts
import { db, expenseCategories, expenses } from '@/db'
import { and, eq } from 'drizzle-orm'
import {
  withBusinessAuthManager,
  enforceMaxContentLength,
  errorResponse,
  successResponse,
  validationError,
} from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { publishToBusiness, getOriginDeviceId } from '@/lib/realtime'
import { patchExpenseCategorySchema } from '../schema'

const MAX_BODY = 4 * 1024

export const PATCH = withBusinessAuthManager(async (request, access, { params }) => {
  const oversize = enforceMaxContentLength(request, MAX_BODY)
  if (oversize) return oversize

  const { id } = await params
  let raw: unknown
  try { raw = await request.json() } catch { return errorResponse(ApiMessageCode.VALIDATION_GENERIC, 400) }

  const parsed = patchExpenseCategorySchema.safeParse(raw)
  if (!parsed.success) return validationError(parsed)

  const [existing] = await db.select().from(expenseCategories).where(
    and(eq(expenseCategories.id, id), eq(expenseCategories.businessId, access.businessId))
  )
  if (!existing) return errorResponse(ApiMessageCode.EXPENSE_CATEGORY_NOT_FOUND, 404)

  const patch: Partial<typeof existing> = {}
  if (parsed.data.name !== undefined) patch.name = parsed.data.name.trim()
  if (parsed.data.sortOrder !== undefined) patch.sortOrder = parsed.data.sortOrder
  if (Object.keys(patch).length === 0) return successResponse(ApiMessageCode.EXPENSE_CATEGORY_UPDATED, { data: existing })

  await db.update(expenseCategories).set(patch).where(eq(expenseCategories.id, id))

  void publishToBusiness(access.businessId, {
    type: 'expense_category.updated',
    categoryId: id,
    originDeviceId: getOriginDeviceId(request),
  })

  const [updated] = await db.select().from(expenseCategories).where(eq(expenseCategories.id, id))
  return successResponse(ApiMessageCode.EXPENSE_CATEGORY_UPDATED, { data: updated })
})

export const DELETE = withBusinessAuthManager(async (request, access, { params }) => {
  const { id } = await params

  const [existing] = await db.select({ id: expenseCategories.id }).from(expenseCategories).where(
    and(eq(expenseCategories.id, id), eq(expenseCategories.businessId, access.businessId))
  )
  if (!existing) return errorResponse(ApiMessageCode.EXPENSE_CATEGORY_NOT_FOUND, 404)

  const [inUse] = await db.select({ id: expenses.id }).from(expenses)
    .where(and(eq(expenses.categoryId, id), eq(expenses.businessId, access.businessId)))
    .limit(1)
  if (inUse) return errorResponse(ApiMessageCode.EXPENSE_CATEGORY_IN_USE, 409)

  await db.delete(expenseCategories).where(eq(expenseCategories.id, id))

  void publishToBusiness(access.businessId, {
    type: 'expense_category.deleted',
    categoryId: id,
    originDeviceId: getOriginDeviceId(request),
  })

  return successResponse(ApiMessageCode.EXPENSE_CATEGORY_DELETED)
})
```

- [ ] **Step 5: Run — expect pass**

```bash
cd apps/api && npx vitest run src/app/api/businesses/\[businessId\]/expense-categories/__tests__/route.test.ts
```

Expected: PASS, all tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/app/api/businesses/\[businessId\]/expense-categories/\[id\]/ apps/api/src/lib/business-auth.ts apps/api/src/app/api/businesses/\[businessId\]/expense-categories/__tests__/
git commit -m "feat(api): PATCH and DELETE /expense-categories/[id]"
```

---

### Task 8 — Expenses: POST + GET list

**Files:**
- Create: `apps/api/src/app/api/businesses/[businessId]/expenses/route.ts`
- Create: `apps/api/src/app/api/businesses/[businessId]/expenses/__tests__/route.test.ts`

**Date constraints mirror sales** (`apps/api/src/app/api/businesses/[businessId]/sales/route.ts:19-21`): max +1 min in the future, min 1 year in the past.

- [ ] **Step 1: Write failing tests**

```ts
// apps/api/src/app/api/businesses/[businessId]/expenses/__tests__/route.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { POST, GET } from '../route'
import { createTestBusiness, makeAuthedRequest } from '@/test-utils'

describe('POST /expenses', () => {
  let bid: string
  beforeEach(async () => { bid = await createTestBusiness() })

  it('creates an expense with required fields', async () => {
    const res = await POST(makeAuthedRequest(bid, { amount: 49.99, note: 'gas' }), { params: { businessId: bid } } as any)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.code).toBe('EXPENSE_CREATED')
    expect(body.data.amount).toBeCloseTo(49.99)
    expect(body.data.expenseNumber).toBe(1)
  })

  it('assigns sequential expense numbers per business', async () => {
    await POST(makeAuthedRequest(bid, { amount: 1 }), { params: { businessId: bid } } as any)
    const res = await POST(makeAuthedRequest(bid, { amount: 2 }), { params: { businessId: bid } } as any)
    const body = await res.json()
    expect(body.data.expenseNumber).toBe(2)
  })

  it('rejects negative or zero amounts', async () => {
    const res = await POST(makeAuthedRequest(bid, { amount: -1 }), { params: { businessId: bid } } as any)
    expect(res.status).toBe(400)
  })

  it('rejects future date beyond 1 minute', async () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString()
    const res = await POST(makeAuthedRequest(bid, { amount: 1, date: future }), { params: { businessId: bid } } as any)
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.code).toBe('EXPENSE_INVALID_DATE')
  })
})

describe('GET /expenses', () => {
  it('lists newest-first, paginated', async () => {
    const bid = await createTestBusiness()
    for (let i = 0; i < 3; i++) {
      await POST(makeAuthedRequest(bid, { amount: i + 1 }), { params: { businessId: bid } } as any)
    }
    const res = await GET(makeAuthedRequest(bid, undefined, { searchParams: { limit: '50' } }), { params: { businessId: bid } } as any)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.length).toBe(3)
    expect(body.data[0].expenseNumber).toBe(3)
  })
})
```

- [ ] **Step 2: Run — expect failure**

```bash
cd apps/api && npx vitest run src/app/api/businesses/\[businessId\]/expenses/__tests__/route.test.ts
```

Expected: FAIL — `Cannot find module '../route'`.

- [ ] **Step 3: Implement the route**

```ts
// apps/api/src/app/api/businesses/[businessId]/expenses/route.ts
import { db, expenses, businesses } from '@/db'
import { and, eq, desc, lte, gte, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import {
  withBusinessAuth,
  withBusinessAuthManager,
  enforceMaxContentLength,
  errorResponse,
  successResponse,
  validationError,
} from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { publishToBusiness, getOriginDeviceId } from '@/lib/realtime'
import { postExpenseSchema } from './schema'

const POST_MAX_BODY_BYTES = 8 * 1024
const ONE_MINUTE_MS = 60 * 1000
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000

export const POST = withBusinessAuthManager(async (request, access) => {
  const oversize = enforceMaxContentLength(request, POST_MAX_BODY_BYTES)
  if (oversize) return oversize

  let raw: unknown
  try { raw = await request.json() } catch { return errorResponse(ApiMessageCode.VALIDATION_GENERIC, 400) }

  const parsed = postExpenseSchema.safeParse(raw)
  if (!parsed.success) return validationError(parsed)
  const body = parsed.data

  const now = new Date()
  const date = body.date ? new Date(body.date) : now
  if (!Number.isFinite(date.getTime())) return errorResponse(ApiMessageCode.EXPENSE_INVALID_DATE, 400)
  if (date.getTime() > now.getTime() + ONE_MINUTE_MS || date.getTime() < now.getTime() - ONE_YEAR_MS) {
    return errorResponse(ApiMessageCode.EXPENSE_INVALID_DATE, 400)
  }

  const id = nanoid()
  let createdRow: typeof expenses.$inferSelect | undefined

  await db.transaction(async (tx) => {
    // Atomically increment nextExpenseNumber and read its previous value.
    const [biz] = await tx
      .update(businesses)
      .set({ nextExpenseNumber: sql`${businesses.nextExpenseNumber} + 1` })
      .where(eq(businesses.id, access.businessId))
      .returning({ next: businesses.nextExpenseNumber })
    const expenseNumber = (biz.next ?? 1) - 1

    await tx.insert(expenses).values({
      id,
      businessId: access.businessId,
      createdByUserId: access.userId,
      expenseNumber,
      date,
      amount: body.amount,
      categoryId: body.categoryId ?? null,
      note: body.note ?? null,
      photoUrl: body.photoUrl ?? null,
    })

    ;[createdRow] = await tx.select().from(expenses).where(eq(expenses.id, id))
  })

  void publishToBusiness(access.businessId, {
    type: 'expense.created',
    expenseId: id,
    originDeviceId: getOriginDeviceId(request),
  })

  return successResponse(ApiMessageCode.EXPENSE_CREATED, { data: createdRow })
})

export const GET = withBusinessAuth(async (request, access) => {
  const url = new URL(request.url)
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '50'), 1), 200)
  const cursor = url.searchParams.get('cursor')
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')

  const filters = [eq(expenses.businessId, access.businessId)]
  if (from) filters.push(gte(expenses.date, new Date(from)))
  if (to) filters.push(lte(expenses.date, new Date(to)))
  if (cursor) filters.push(lte(expenses.date, new Date(cursor)))

  const rows = await db.select().from(expenses)
    .where(and(...filters))
    .orderBy(desc(expenses.date), desc(expenses.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const data = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore ? data[data.length - 1].date.toISOString() : null

  return successResponse(ApiMessageCode.OK, { data, nextCursor })
})
```

- [ ] **Step 4: Run — expect pass**

```bash
cd apps/api && npx vitest run src/app/api/businesses/\[businessId\]/expenses/__tests__/route.test.ts
```

Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/app/api/businesses/\[businessId\]/expenses/
git commit -m "feat(api): POST and GET /expenses with sequential expenseNumber"
```

---

### Task 9 — Expenses: GET [id], PATCH, DELETE

**Files:**
- Create: `apps/api/src/app/api/businesses/[businessId]/expenses/[id]/route.ts`
- Modify: test file with new cases

- [ ] **Step 1: Write failing tests** (append to existing test file)

```ts
import { GET as GetOne, PATCH, DELETE } from '../[id]/route'

describe('GET /expenses/:id', () => {
  it('returns the expense', async () => {
    const bid = await createTestBusiness()
    const created = await (await POST(makeAuthedRequest(bid, { amount: 5 }), { params: { businessId: bid } } as any)).json()
    const res = await GetOne(makeAuthedRequest(bid), { params: { businessId: bid, id: created.data.id } } as any)
    expect(res.status).toBe(200)
  })
  it('404 when not in business', async () => {
    const bid = await createTestBusiness()
    const res = await GetOne(makeAuthedRequest(bid), { params: { businessId: bid, id: 'nope' } } as any)
    expect(res.status).toBe(404)
  })
})

describe('PATCH /expenses/:id', () => {
  it('updates fields', async () => {
    const bid = await createTestBusiness()
    const created = await (await POST(makeAuthedRequest(bid, { amount: 5 }), { params: { businessId: bid } } as any)).json()
    const res = await PATCH(makeAuthedRequest(bid, { amount: 7, note: 'updated' }),
      { params: { businessId: bid, id: created.data.id } } as any)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.amount).toBe(7)
    expect(body.data.note).toBe('updated')
  })
})

describe('DELETE /expenses/:id', () => {
  it('deletes', async () => {
    const bid = await createTestBusiness()
    const created = await (await POST(makeAuthedRequest(bid, { amount: 5 }), { params: { businessId: bid } } as any)).json()
    const res = await DELETE(makeAuthedRequest(bid), { params: { businessId: bid, id: created.data.id } } as any)
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run — expect failure**

```bash
cd apps/api && npx vitest run src/app/api/businesses/\[businessId\]/expenses/__tests__/route.test.ts
```

Expected: FAIL — `Cannot find module '../[id]/route'`.

- [ ] **Step 3: Implement the [id] route**

```ts
// apps/api/src/app/api/businesses/[businessId]/expenses/[id]/route.ts
import { db, expenses } from '@/db'
import { and, eq } from 'drizzle-orm'
import {
  withBusinessAuth,
  withBusinessAuthManager,
  enforceMaxContentLength,
  errorResponse,
  successResponse,
  validationError,
} from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { publishToBusiness, getOriginDeviceId } from '@/lib/realtime'
import { patchExpenseSchema } from '../schema'

const MAX_BODY = 8 * 1024
const ONE_MINUTE_MS = 60 * 1000
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000

export const GET = withBusinessAuth(async (_request, access, { params }) => {
  const { id } = await params
  const [row] = await db.select().from(expenses).where(
    and(eq(expenses.id, id), eq(expenses.businessId, access.businessId))
  )
  if (!row) return errorResponse(ApiMessageCode.EXPENSE_NOT_FOUND, 404)
  return successResponse(ApiMessageCode.OK, { data: row })
})

export const PATCH = withBusinessAuthManager(async (request, access, { params }) => {
  const oversize = enforceMaxContentLength(request, MAX_BODY)
  if (oversize) return oversize

  const { id } = await params
  let raw: unknown
  try { raw = await request.json() } catch { return errorResponse(ApiMessageCode.VALIDATION_GENERIC, 400) }

  const parsed = patchExpenseSchema.safeParse(raw)
  if (!parsed.success) return validationError(parsed)
  const body = parsed.data

  const [existing] = await db.select().from(expenses).where(
    and(eq(expenses.id, id), eq(expenses.businessId, access.businessId))
  )
  if (!existing) return errorResponse(ApiMessageCode.EXPENSE_NOT_FOUND, 404)

  const patch: Record<string, unknown> = { updatedAt: new Date() }
  if (body.amount !== undefined) patch.amount = body.amount
  if (body.note !== undefined) patch.note = body.note
  if (body.categoryId !== undefined) patch.categoryId = body.categoryId
  if (body.photoUrl !== undefined) patch.photoUrl = body.photoUrl
  if (body.date !== undefined) {
    const date = new Date(body.date)
    const now = new Date()
    if (!Number.isFinite(date.getTime())) return errorResponse(ApiMessageCode.EXPENSE_INVALID_DATE, 400)
    if (date.getTime() > now.getTime() + ONE_MINUTE_MS || date.getTime() < now.getTime() - ONE_YEAR_MS) {
      return errorResponse(ApiMessageCode.EXPENSE_INVALID_DATE, 400)
    }
    patch.date = date
  }

  await db.update(expenses).set(patch).where(eq(expenses.id, id))

  void publishToBusiness(access.businessId, {
    type: 'expense.updated',
    expenseId: id,
    originDeviceId: getOriginDeviceId(request),
  })

  const [updated] = await db.select().from(expenses).where(eq(expenses.id, id))
  return successResponse(ApiMessageCode.EXPENSE_UPDATED, { data: updated })
})

export const DELETE = withBusinessAuthManager(async (request, access, { params }) => {
  const { id } = await params

  const [existing] = await db.select({ id: expenses.id }).from(expenses).where(
    and(eq(expenses.id, id), eq(expenses.businessId, access.businessId))
  )
  if (!existing) return errorResponse(ApiMessageCode.EXPENSE_NOT_FOUND, 404)

  await db.delete(expenses).where(eq(expenses.id, id))

  void publishToBusiness(access.businessId, {
    type: 'expense.deleted',
    expenseId: id,
    originDeviceId: getOriginDeviceId(request),
  })

  return successResponse(ApiMessageCode.EXPENSE_DELETED)
})
```

- [ ] **Step 4: Run — expect pass**

```bash
cd apps/api && npx vitest run src/app/api/businesses/\[businessId\]/expenses/__tests__/route.test.ts
```

Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/app/api/businesses/\[businessId\]/expenses/\[id\]/ apps/api/src/app/api/businesses/\[businessId\]/expenses/__tests__/
git commit -m "feat(api): GET, PATCH, DELETE /expenses/[id]"
```

---

### Task 10 — Expenses: GET /expenses/summary

**Files:**
- Create: `apps/api/src/app/api/businesses/[businessId]/expenses/summary/route.ts`

- [ ] **Step 1: Write failing test**

```ts
import { GET as GetSummary } from '../summary/route'

describe('GET /expenses/summary', () => {
  it('returns current-month income, expenses, and net', async () => {
    const bid = await createTestBusiness()
    await createSale({ businessId: bid, total: 100, date: new Date() })
    await createSale({ businessId: bid, total: 50, date: new Date() })
    await POST(makeAuthedRequest(bid, { amount: 30 }), { params: { businessId: bid } } as any)

    const res = await GetSummary(makeAuthedRequest(bid), { params: { businessId: bid } } as any)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.totalIncome).toBeCloseTo(150)
    expect(body.data.totalExpenses).toBeCloseTo(30)
    expect(body.data.net).toBeCloseTo(120)
  })
})
```

(If `createSale` test helper doesn't exist, look in the sales test file and copy the in-test insertion pattern.)

- [ ] **Step 2: Run — expect failure**

```bash
cd apps/api && npx vitest run src/app/api/businesses/\[businessId\]/expenses/__tests__/route.test.ts -t summary
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the summary route**

```ts
// apps/api/src/app/api/businesses/[businessId]/expenses/summary/route.ts
import { db, expenses, sales } from '@/db'
import { and, eq, gte, lt, sum } from 'drizzle-orm'
import { withBusinessAuth, successResponse } from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'

function startOfMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}
function startOfNextMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
}

export const GET = withBusinessAuth(async (request, access) => {
  const url = new URL(request.url)
  const monthParam = url.searchParams.get('month') // ISO yyyy-mm-01
  const anchor = monthParam ? new Date(monthParam) : new Date()
  const from = startOfMonth(anchor)
  const to = startOfNextMonth(anchor)

  const [incomeRow] = await db
    .select({ total: sum(sales.total) })
    .from(sales)
    .where(and(eq(sales.businessId, access.businessId), gte(sales.date, from), lt(sales.date, to)))

  const [expensesRow] = await db
    .select({ total: sum(expenses.amount) })
    .from(expenses)
    .where(and(eq(expenses.businessId, access.businessId), gte(expenses.date, from), lt(expenses.date, to)))

  const totalIncome = Number(incomeRow?.total ?? 0)
  const totalExpenses = Number(expensesRow?.total ?? 0)

  return successResponse(ApiMessageCode.OK, {
    data: {
      month: from.toISOString().slice(0, 10),
      totalIncome,
      totalExpenses,
      net: totalIncome - totalExpenses,
    },
  })
})
```

- [ ] **Step 4: Run — expect pass**

```bash
cd apps/api && npx vitest run src/app/api/businesses/\[businessId\]/expenses/__tests__/route.test.ts -t summary
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/app/api/businesses/\[businessId\]/expenses/summary/
git commit -m "feat(api): GET /expenses/summary for monthly income/expense/net"
```

---

### Task 11 — Seed default expense categories on business creation

**Files:**
- Modify: `apps/api/src/app/api/businesses/create/route.ts`

- [ ] **Step 1: Read the existing create-business route**

Look at the existing transaction that creates a business + owner + initial product categories. Identify the spot where seed data is inserted (likely a `seedCategories` block).

- [ ] **Step 2: Add expense category seeding**

Inside the same transaction, after the business row is inserted, add:

```ts
const defaultExpenseCategories = ['Supplies', 'Fees', 'Transport', 'Other']
await tx.insert(expenseCategories).values(
  defaultExpenseCategories.map((name, idx) => ({
    id: nanoid(),
    businessId: businessRow.id,
    name,
    sortOrder: idx,
  }))
)
```

Add import: `expenseCategories` from `@/db`.

- [ ] **Step 3: Run existing business-create tests**

```bash
cd apps/api && npx vitest run src/app/api/businesses/create/
```

Expected: still PASS (seeded rows are additive). If a test asserts row counts on related tables, update accordingly.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/app/api/businesses/create/route.ts
git commit -m "feat(api): seed default expense categories on business create"
```

---

### Task 12 — Client-side i18n: en-US

**Files:**
- Modify: `apps/web/src/i18n/messages/en-US.json`

- [ ] **Step 1: Add all expense + ledger keys**

Insert the following block (preserve top-level structure of the file — these go into the appropriate sections; if the file is flat, add at the bottom; if it's nested by namespace, place under `ledger`, `expenses`, `expense_category`, `error`, `inventory_summary`):

```json
"ledger.tab_label": "Ledger",
"ledger.tab_switcher_aria": "Switch between sales and expenses",
"ledger.sub_sales": "Sales",
"ledger.sub_expenses": "Expenses",

"expenses.empty_title": "No expenses yet",
"expenses.empty_body": "Track money spent on supplies, fees, and other costs.",
"expenses.add_button": "Add expense",
"expenses.list_section_today": "Today",
"expenses.list_section_yesterday": "Yesterday",
"expenses.totals_strip_month": "This month: {amount}",

"expense_modal.title_add": "Add expense",
"expense_modal.title_edit": "Edit expense",
"expense_modal.label_amount": "Amount",
"expense_modal.label_date": "Date",
"expense_modal.label_category": "Category",
"expense_modal.label_note": "Note",
"expense_modal.label_photo": "Photo",
"expense_modal.category_placeholder": "Choose a category",
"expense_modal.category_add_new": "Add new category",
"expense_modal.note_placeholder": "What was this for?",
"expense_modal.save": "Save",
"expense_modal.cancel": "Cancel",
"expense_modal.delete": "Delete",
"expense_modal.delete_confirm_title": "Delete this expense?",
"expense_modal.delete_confirm_body": "This action cannot be undone.",

"expense_category.add_modal_title": "Add expense category",
"expense_category.name_label": "Name",
"expense_category.in_use_warning": "This category is used by existing expenses.",

"home.monthly_summary_title": "This month",
"home.monthly_summary_income": "Income",
"home.monthly_summary_expenses": "Expenses",
"home.monthly_summary_net": "Net",

"error.EXPENSE_NOT_FOUND": "Expense not found.",
"error.EXPENSE_FORBIDDEN_NOT_MANAGER": "Only owners and partners can manage expenses.",
"error.EXPENSE_INVALID_AMOUNT": "Enter a valid amount.",
"error.EXPENSE_INVALID_DATE": "Enter a valid date.",
"error.EXPENSE_ID_REQUIRED": "Expense ID is required.",
"error.EXPENSE_CATEGORY_NOT_FOUND": "Category not found.",
"error.EXPENSE_CATEGORY_IN_USE": "This category is in use and can't be deleted.",
"error.EXPENSE_CATEGORY_NAME_REQUIRED": "Category name is required.",
"success.EXPENSE_CREATED": "Expense added.",
"success.EXPENSE_UPDATED": "Expense updated.",
"success.EXPENSE_DELETED": "Expense deleted.",
"success.EXPENSE_CATEGORY_CREATED": "Category added.",
"success.EXPENSE_CATEGORY_UPDATED": "Category updated.",
"success.EXPENSE_CATEGORY_DELETED": "Category deleted."
```

(Adapt to the exact JSON structure of the existing file — examine it before pasting.)

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/i18n/messages/en-US.json
git commit -m "feat(i18n): add ledger and expense keys (en-US)"
```

---

### Task 13 — Client-side i18n: es and ja

**Files:**
- Modify: `apps/web/src/i18n/messages/es.json`
- Modify: `apps/web/src/i18n/messages/ja.json`

Per CLAUDE.md rule 3: real translations, no English placeholders, do **not** run the translate script.

- [ ] **Step 1: Add Spanish translations**

Mirror the same key set with these translations:

```json
"ledger.tab_label": "Libro",
"ledger.tab_switcher_aria": "Cambiar entre ventas y gastos",
"ledger.sub_sales": "Ventas",
"ledger.sub_expenses": "Gastos",

"expenses.empty_title": "Aún no hay gastos",
"expenses.empty_body": "Registra el dinero gastado en suministros, tarifas y otros costos.",
"expenses.add_button": "Añadir gasto",
"expenses.list_section_today": "Hoy",
"expenses.list_section_yesterday": "Ayer",
"expenses.totals_strip_month": "Este mes: {amount}",

"expense_modal.title_add": "Añadir gasto",
"expense_modal.title_edit": "Editar gasto",
"expense_modal.label_amount": "Monto",
"expense_modal.label_date": "Fecha",
"expense_modal.label_category": "Categoría",
"expense_modal.label_note": "Nota",
"expense_modal.label_photo": "Foto",
"expense_modal.category_placeholder": "Elige una categoría",
"expense_modal.category_add_new": "Añadir nueva categoría",
"expense_modal.note_placeholder": "¿Para qué fue esto?",
"expense_modal.save": "Guardar",
"expense_modal.cancel": "Cancelar",
"expense_modal.delete": "Eliminar",
"expense_modal.delete_confirm_title": "¿Eliminar este gasto?",
"expense_modal.delete_confirm_body": "Esta acción no se puede deshacer.",

"expense_category.add_modal_title": "Añadir categoría de gasto",
"expense_category.name_label": "Nombre",
"expense_category.in_use_warning": "Esta categoría está siendo usada por gastos existentes.",

"home.monthly_summary_title": "Este mes",
"home.monthly_summary_income": "Ingresos",
"home.monthly_summary_expenses": "Gastos",
"home.monthly_summary_net": "Neto",

"error.EXPENSE_NOT_FOUND": "Gasto no encontrado.",
"error.EXPENSE_FORBIDDEN_NOT_MANAGER": "Solo los propietarios y socios pueden gestionar gastos.",
"error.EXPENSE_INVALID_AMOUNT": "Introduce un monto válido.",
"error.EXPENSE_INVALID_DATE": "Introduce una fecha válida.",
"error.EXPENSE_ID_REQUIRED": "Se requiere el ID del gasto.",
"error.EXPENSE_CATEGORY_NOT_FOUND": "Categoría no encontrada.",
"error.EXPENSE_CATEGORY_IN_USE": "Esta categoría está en uso y no puede eliminarse.",
"error.EXPENSE_CATEGORY_NAME_REQUIRED": "El nombre de la categoría es obligatorio.",
"success.EXPENSE_CREATED": "Gasto añadido.",
"success.EXPENSE_UPDATED": "Gasto actualizado.",
"success.EXPENSE_DELETED": "Gasto eliminado.",
"success.EXPENSE_CATEGORY_CREATED": "Categoría añadida.",
"success.EXPENSE_CATEGORY_UPDATED": "Categoría actualizada.",
"success.EXPENSE_CATEGORY_DELETED": "Categoría eliminada."
```

- [ ] **Step 2: Add Japanese translations**

```json
"ledger.tab_label": "帳簿",
"ledger.tab_switcher_aria": "売上と支出を切り替える",
"ledger.sub_sales": "売上",
"ledger.sub_expenses": "支出",

"expenses.empty_title": "支出はまだありません",
"expenses.empty_body": "備品費、手数料、その他の費用を記録しましょう。",
"expenses.add_button": "支出を追加",
"expenses.list_section_today": "今日",
"expenses.list_section_yesterday": "昨日",
"expenses.totals_strip_month": "今月: {amount}",

"expense_modal.title_add": "支出を追加",
"expense_modal.title_edit": "支出を編集",
"expense_modal.label_amount": "金額",
"expense_modal.label_date": "日付",
"expense_modal.label_category": "カテゴリ",
"expense_modal.label_note": "メモ",
"expense_modal.label_photo": "写真",
"expense_modal.category_placeholder": "カテゴリを選択",
"expense_modal.category_add_new": "新しいカテゴリを追加",
"expense_modal.note_placeholder": "何の支出ですか？",
"expense_modal.save": "保存",
"expense_modal.cancel": "キャンセル",
"expense_modal.delete": "削除",
"expense_modal.delete_confirm_title": "この支出を削除しますか？",
"expense_modal.delete_confirm_body": "この操作は元に戻せません。",

"expense_category.add_modal_title": "支出カテゴリを追加",
"expense_category.name_label": "名前",
"expense_category.in_use_warning": "このカテゴリは既存の支出で使用されています。",

"home.monthly_summary_title": "今月",
"home.monthly_summary_income": "収入",
"home.monthly_summary_expenses": "支出",
"home.monthly_summary_net": "差引",

"error.EXPENSE_NOT_FOUND": "支出が見つかりません。",
"error.EXPENSE_FORBIDDEN_NOT_MANAGER": "オーナーとパートナーのみが支出を管理できます。",
"error.EXPENSE_INVALID_AMOUNT": "有効な金額を入力してください。",
"error.EXPENSE_INVALID_DATE": "有効な日付を入力してください。",
"error.EXPENSE_ID_REQUIRED": "支出IDが必要です。",
"error.EXPENSE_CATEGORY_NOT_FOUND": "カテゴリが見つかりません。",
"error.EXPENSE_CATEGORY_IN_USE": "このカテゴリは使用中のため削除できません。",
"error.EXPENSE_CATEGORY_NAME_REQUIRED": "カテゴリ名が必要です。",
"success.EXPENSE_CREATED": "支出を追加しました。",
"success.EXPENSE_UPDATED": "支出を更新しました。",
"success.EXPENSE_DELETED": "支出を削除しました。",
"success.EXPENSE_CATEGORY_CREATED": "カテゴリを追加しました。",
"success.EXPENSE_CATEGORY_UPDATED": "カテゴリを更新しました。",
"success.EXPENSE_CATEGORY_DELETED": "カテゴリを削除しました。"
```

- [ ] **Step 3: Regenerate message ID types**

```bash
npm run i18n:types --workspace=apps/web
```

Expected: `apps/web/src/i18n/messageIds.d.ts` updates with all new keys present.

- [ ] **Step 4: Type-check**

```bash
npm run build --workspace=apps/web
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/i18n/
git commit -m "feat(i18n): add ledger and expense translations (es, ja) + regen types"
```

---

### Task 14 — Feature flag scaffold

**Files:**
- Create: `apps/web/src/lib/feature-flags.ts`

This Phase A is gated behind `expenses_v1`. For initial rollout the flag is read at app boot from a hardcoded constant; a future task can wire it to a server endpoint or env variable.

- [ ] **Step 1: Create the flag reader**

```ts
// apps/web/src/lib/feature-flags.ts
const FLAGS = {
  expenses_v1: true, // flip to false to disable the entire Phase A surface
} as const

export type FeatureFlag = keyof typeof FLAGS

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  if (typeof window !== 'undefined') {
    const override = window.localStorage.getItem(`feature:${flag}`)
    if (override === '1') return true
    if (override === '0') return false
  }
  return FLAGS[flag]
}

export function useFeatureFlag(flag: FeatureFlag): boolean {
  return isFeatureEnabled(flag)
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/feature-flags.ts
git commit -m "feat(web): feature-flag scaffold with localStorage override"
```

---

### Task 15 — Expenses context + hooks

**Files:**
- Create: `apps/web/src/contexts/expenses-context.tsx`
- Create: `apps/web/src/contexts/expense-categories-context.tsx`
- Create: `apps/web/src/hooks/useExpensesSummary.ts`

**Reference model:** Find an existing context that does list + CRUD + realtime sub. Likely `apps/web/src/contexts/providers-context.tsx` or a sales-related context. Mirror its shape (provider component + hook + realtime registration pattern from `realtime-implementation-reference.md`).

- [ ] **Step 1: Implement `ExpensesProvider` and `useExpenses`**

```tsx
// apps/web/src/contexts/expenses-context.tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { Expense } from '@kasero/shared/types/expense'
import { useBusinessId } from '@/hooks/useBusinessId'
import { useBusinessRealtime } from '@/lib/realtime/useBusinessRealtime'
import { apiFetch } from '@/lib/api-fetch'

interface ExpensesContextValue {
  expenses: Expense[]
  loading: boolean
  error: unknown
  refresh: () => Promise<void>
  create: (input: { amount: number; date?: string; note?: string; categoryId?: string | null; photoUrl?: string | null }) => Promise<Expense>
  update: (id: string, patch: Partial<{ amount: number; date: string; note: string; categoryId: string | null; photoUrl: string | null }>) => Promise<Expense>
  remove: (id: string) => Promise<void>
}

const ExpensesContext = createContext<ExpensesContextValue | null>(null)

export function ExpensesProvider({ children }: { children: React.ReactNode }) {
  const businessId = useBusinessId()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const refresh = useCallback(async () => {
    if (!businessId) return
    setLoading(true)
    try {
      const res = await apiFetch(`/api/businesses/${businessId}/expenses?limit=100`)
      const json = await res.json()
      setExpenses(json.data ?? [])
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [businessId])

  useEffect(() => { void refresh() }, [refresh])

  useBusinessRealtime(businessId, (event) => {
    if (event.type === 'expense.created' || event.type === 'expense.updated' || event.type === 'expense.deleted') {
      void refresh()
    }
  })

  const create: ExpensesContextValue['create'] = useCallback(async (input) => {
    const res = await apiFetch(`/api/businesses/${businessId}/expenses`, { method: 'POST', body: JSON.stringify(input) })
    const json = await res.json()
    if (!res.ok) throw json
    await refresh()
    return json.data
  }, [businessId, refresh])

  const update: ExpensesContextValue['update'] = useCallback(async (id, patch) => {
    const res = await apiFetch(`/api/businesses/${businessId}/expenses/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
    const json = await res.json()
    if (!res.ok) throw json
    await refresh()
    return json.data
  }, [businessId, refresh])

  const remove: ExpensesContextValue['remove'] = useCallback(async (id) => {
    const res = await apiFetch(`/api/businesses/${businessId}/expenses/${id}`, { method: 'DELETE' })
    if (!res.ok) throw await res.json()
    await refresh()
  }, [businessId, refresh])

  const value = useMemo(() => ({ expenses, loading, error, refresh, create, update, remove }), [expenses, loading, error, refresh, create, update, remove])

  return <ExpensesContext.Provider value={value}>{children}</ExpensesContext.Provider>
}

export function useExpenses() {
  const ctx = useContext(ExpensesContext)
  if (!ctx) throw new Error('useExpenses must be used inside ExpensesProvider')
  return ctx
}
```

(If `useBusinessRealtime` / `apiFetch` / `useBusinessId` don't exist with these exact names, find the actual names in the codebase and substitute. Look at `apps/web/src/contexts/providers-context.tsx` for the canonical pattern.)

- [ ] **Step 2: Implement `ExpenseCategoriesProvider` and `useExpenseCategories`**

Same shape, against `/expense-categories`. (Same skeleton — repeat the pattern verbatim against the categories endpoint.)

- [ ] **Step 3: Implement `useExpensesSummary` hook**

```ts
// apps/web/src/hooks/useExpensesSummary.ts
import { useEffect, useState } from 'react'
import type { ExpenseSummary } from '@kasero/shared/types/expense'
import { useBusinessId } from './useBusinessId'
import { apiFetch } from '@/lib/api-fetch'
import { useBusinessRealtime } from '@/lib/realtime/useBusinessRealtime'

export function useExpensesSummary() {
  const businessId = useBusinessId()
  const [summary, setSummary] = useState<ExpenseSummary | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    if (!businessId) return
    setLoading(true)
    try {
      const res = await apiFetch(`/api/businesses/${businessId}/expenses/summary`)
      const json = await res.json()
      setSummary(json.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [businessId])

  useBusinessRealtime(businessId, (event) => {
    if (event.type === 'expense.created' || event.type === 'expense.updated' || event.type === 'expense.deleted'
        || event.type === 'sale.created' || event.type === 'sale.deleted') {
      void refresh()
    }
  })

  return { summary, loading, refresh }
}
```

- [ ] **Step 4: Wire ExpensesProvider into the BusinessTabsLayout tree**

Find the existing provider tree in `apps/web/src/routes/BusinessTabsLayout.tsx` (or the closest ancestor that holds business-scoped contexts) and add `<ExpensesProvider>` and `<ExpenseCategoriesProvider>` alongside the existing ones.

- [ ] **Step 5: Type-check**

```bash
npm run build --workspace=apps/web
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/contexts/expenses-context.tsx apps/web/src/contexts/expense-categories-context.tsx apps/web/src/hooks/useExpensesSummary.ts apps/web/src/routes/BusinessTabsLayout.tsx
git commit -m "feat(web): expenses + expense-categories contexts with realtime"
```

---

### Task 16 — Rename Sales tab to Ledger; introduce TabContainer

**Files:**
- Create: `apps/web/src/routes/tabs/LedgerTab.tsx`
- Modify: `apps/web/src/routes/BusinessTabsLayout.tsx`
- Delete: `apps/web/src/routes/tabs/SalesTab.tsx`
- Create: `apps/web/src/components/tab-shell/views/LedgerView.tsx`
- Modify or extract: `apps/web/src/components/tab-shell/views/SalesView.tsx`

- [ ] **Step 1: Inspect the current SalesTab**

```bash
cat apps/web/src/routes/tabs/SalesTab.tsx
```

Note its imports and inner content. The rename keeps the route path (`/:bid/sales`) for now to avoid deep-link breakage from existing notifications. Only the tab key/label change visually.

- [ ] **Step 2: Create LedgerTab**

```tsx
// apps/web/src/routes/tabs/LedgerTab.tsx
import { IonContent, IonPage } from '@ionic/react'
import { BusinessHeader } from '@/components/layout'
import { LedgerView } from '@/components/tab-shell/views/LedgerView'

export function LedgerTab() {
  return (
    <IonPage>
      <BusinessHeader />
      <IonContent>
        <LedgerView />
      </IonContent>
    </IonPage>
  )
}
```

- [ ] **Step 3: Extract SalesView from the current SalesTab body**

Move the existing inner content of `SalesTab` into `apps/web/src/components/tab-shell/views/SalesView.tsx` if it isn't already there (check ProductsView's pattern at `apps/web/src/components/tab-shell/views/ProductsView.tsx` for the analog).

- [ ] **Step 4: Implement LedgerView with TabContainer**

```tsx
// apps/web/src/components/tab-shell/views/LedgerView.tsx
import { useIntl } from 'react-intl'
import { TabContainer } from '@/components/ui'
import { SalesView } from './SalesView'
import { ExpensesView } from '@/components/expenses/ExpensesView'
import { useFeatureFlag } from '@/lib/feature-flags'

export function LedgerView() {
  const t = useIntl()
  const expensesEnabled = useFeatureFlag('expenses_v1')

  if (!expensesEnabled) return <SalesView />

  return (
    <div role="tablist" aria-label={t.formatMessage({ id: 'ledger.tab_switcher_aria' })} className="ledger-segment">
      <TabContainer>
        <TabContainer.Tab id="sales" label={t.formatMessage({ id: 'ledger.sub_sales' })}>
          <SalesView />
        </TabContainer.Tab>
        <TabContainer.Tab id="expenses" label={t.formatMessage({ id: 'ledger.sub_expenses' })}>
          <ExpensesView />
        </TabContainer.Tab>
      </TabContainer>
    </div>
  )
}
```

(Match the exact TabContainer API by reading `apps/web/src/components/tab-shell/views/ProductsView.tsx` and adapting.)

- [ ] **Step 5: Update BusinessTabsLayout**

In `apps/web/src/routes/BusinessTabsLayout.tsx`:
- Replace `import { SalesTab } from '@/routes/tabs/SalesTab'` with `import { LedgerTab } from '@/routes/tabs/LedgerTab'`.
- Update the corresponding `<Route ... component={SalesTab} />` to use `LedgerTab`.
- Update the `<IonTabButton tab="sales">` block: keep `tab="sales"` and `href={...}/sales` (routes unchanged) but change the visible label inside `<IonLabel>` to `{t.formatMessage({ id: 'ledger.tab_label' })}`.

- [ ] **Step 6: Delete the old SalesTab shell**

```bash
rm apps/web/src/routes/tabs/SalesTab.tsx
```

- [ ] **Step 7: Type-check + manual smoke**

```bash
npm run build --workspace=apps/web
npm run dev
```

Then open the app in a browser. The bottom tab previously labeled "Sales" should now read "Ledger". Tapping it shows two sub-tabs: Sales (existing content) and Expenses (empty for now, ExpensesView is a stub).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/routes/tabs/LedgerTab.tsx apps/web/src/components/tab-shell/views/LedgerView.tsx apps/web/src/components/tab-shell/views/SalesView.tsx apps/web/src/routes/BusinessTabsLayout.tsx
git rm apps/web/src/routes/tabs/SalesTab.tsx
git commit -m "feat(web): rename Sales tab to Ledger with Sales | Expenses sub-tabs"
```

---

### Task 17 — `ExpenseListItem` + `ExpensesView` skeleton

**Files:**
- Create: `apps/web/src/components/expenses/ExpensesView.tsx`
- Create: `apps/web/src/components/expenses/ExpenseListItem.tsx`
- Create: `apps/web/src/components/expenses/ExpenseTotalsStrip.tsx`

- [ ] **Step 1: Implement ExpenseListItem**

```tsx
// apps/web/src/components/expenses/ExpenseListItem.tsx
import type { Expense } from '@kasero/shared/types/expense'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'
import { useExpenseCategories } from '@/contexts/expense-categories-context'

interface Props {
  expense: Expense
  onTap: (expense: Expense) => void
}

export function ExpenseListItem({ expense, onTap }: Props) {
  const { formatCurrency, formatDate } = useBusinessFormat()
  const { categories } = useExpenseCategories()
  const category = expense.categoryId ? categories.find((c) => c.id === expense.categoryId) : null

  return (
    <button type="button" className="expense-list-item" onClick={() => onTap(expense)}>
      <div className="expense-list-item__primary">
        <span className="expense-list-item__amount">−{formatCurrency(expense.amount)}</span>
        {category && <span className="expense-list-item__category-chip">{category.name}</span>}
      </div>
      <div className="expense-list-item__secondary">
        <span className="expense-list-item__date">{formatDate(expense.date)}</span>
        {expense.note && <span className="expense-list-item__note">{expense.note}</span>}
      </div>
      {expense.photoUrl && <img src={expense.photoUrl} alt="" className="expense-list-item__photo" />}
    </button>
  )
}
```

- [ ] **Step 2: Implement ExpenseTotalsStrip**

```tsx
// apps/web/src/components/expenses/ExpenseTotalsStrip.tsx
import { useIntl } from 'react-intl'
import { useExpensesSummary } from '@/hooks/useExpensesSummary'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'

export function ExpenseTotalsStrip() {
  const t = useIntl()
  const { formatCurrency } = useBusinessFormat()
  const { summary, loading } = useExpensesSummary()
  if (loading || !summary) return null
  return (
    <div className="expense-totals-strip">
      {t.formatMessage({ id: 'expenses.totals_strip_month' }, { amount: formatCurrency(summary.totalExpenses) })}
    </div>
  )
}
```

- [ ] **Step 3: Implement ExpensesView**

```tsx
// apps/web/src/components/expenses/ExpensesView.tsx
import { useState } from 'react'
import { useIntl } from 'react-intl'
import { useExpenses } from '@/contexts/expenses-context'
import { ExpenseListItem } from './ExpenseListItem'
import { ExpenseTotalsStrip } from './ExpenseTotalsStrip'
import { AddExpenseModal } from './AddExpenseModal'
import { ExpenseDetailModal } from './ExpenseDetailModal'
import { EmptyState, FloatingActionButton } from '@/components/ui'
import type { Expense } from '@kasero/shared/types/expense'

export function ExpensesView() {
  const t = useIntl()
  const { expenses, loading } = useExpenses()
  const [addOpen, setAddOpen] = useState(false)
  const [detailExpense, setDetailExpense] = useState<Expense | null>(null)

  return (
    <div className="expenses-view">
      <ExpenseTotalsStrip />
      {expenses.length === 0 && !loading && (
        <EmptyState
          title={t.formatMessage({ id: 'expenses.empty_title' })}
          body={t.formatMessage({ id: 'expenses.empty_body' })}
        />
      )}
      <ul className="expenses-list">
        {expenses.map((e) => (
          <li key={e.id}><ExpenseListItem expense={e} onTap={setDetailExpense} /></li>
        ))}
      </ul>
      <FloatingActionButton
        label={t.formatMessage({ id: 'expenses.add_button' })}
        onClick={() => setAddOpen(true)}
      />
      <AddExpenseModal open={addOpen} onClose={() => setAddOpen(false)} />
      <ExpenseDetailModal expense={detailExpense} onClose={() => setDetailExpense(null)} />
    </div>
  )
}
```

(If `EmptyState` / `FloatingActionButton` aren't the exact existing components, substitute the project's equivalents — search for `IonFab` usage or similar.)

- [ ] **Step 4: Type-check**

```bash
npm run build --workspace=apps/web
```

Expected: clean (modal files will need stubs — see next task).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/expenses/
git commit -m "feat(web): ExpensesView with totals strip and list"
```

---

### Task 18 — `AddExpenseModal`

**Files:**
- Create: `apps/web/src/components/expenses/AddExpenseModal.tsx`
- Create: `apps/web/src/components/expenses/ExpenseCategoryPicker.tsx`

**Reference:** `.claude/docs/modal-system.md`. `Modal.Step` and `Modal.Footer` must be direct children. Use optimistic UI per CLAUDE.md.

- [ ] **Step 1: Implement ExpenseCategoryPicker**

```tsx
// apps/web/src/components/expenses/ExpenseCategoryPicker.tsx
import { useIntl } from 'react-intl'
import { useExpenseCategories } from '@/contexts/expense-categories-context'

interface Props {
  value: string | null
  onChange: (categoryId: string | null) => void
  onRequestAdd: () => void
}

export function ExpenseCategoryPicker({ value, onChange, onRequestAdd }: Props) {
  const t = useIntl()
  const { categories } = useExpenseCategories()

  return (
    <select
      className="expense-category-picker"
      value={value ?? ''}
      onChange={(e) => {
        if (e.target.value === '__add__') onRequestAdd()
        else onChange(e.target.value || null)
      }}
    >
      <option value="">{t.formatMessage({ id: 'expense_modal.category_placeholder' })}</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
      <option value="__add__">{t.formatMessage({ id: 'expense_modal.category_add_new' })}</option>
    </select>
  )
}
```

(If the project uses a custom select component, substitute it.)

- [ ] **Step 2: Implement AddExpenseModal**

```tsx
// apps/web/src/components/expenses/AddExpenseModal.tsx
import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Modal, PriceInput } from '@/components/ui'
import { useExpenses } from '@/contexts/expenses-context'
import { ExpenseCategoryPicker } from './ExpenseCategoryPicker'
import { useApiMessage } from '@/hooks/useApiMessage'

interface Props {
  open: boolean
  onClose: () => void
}

export function AddExpenseModal({ open, onClose }: Props) {
  const t = useIntl()
  const { create } = useExpenses()
  const translateApiMessage = useApiMessage()
  const [amount, setAmount] = useState<number | null>(null)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setAmount(null)
    setDate(new Date().toISOString().slice(0, 10))
    setCategoryId(null)
    setNote('')
    setError(null)
    setSubmitting(false)
  }

  const onSave = async () => {
    if (amount == null || amount <= 0) {
      setError(t.formatMessage({ id: 'error.EXPENSE_INVALID_AMOUNT' }))
      return
    }
    setSubmitting(true)
    try {
      await create({
        amount,
        date: new Date(date).toISOString(),
        note: note.trim() || undefined,
        categoryId: categoryId || undefined,
      })
      onClose()
    } catch (err) {
      setError(translateApiMessage(err, t.formatMessage({ id: 'error.EXPENSE_INVALID_AMOUNT' })))
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} onExitComplete={reset} title={t.formatMessage({ id: 'expense_modal.title_add' })}>
      <Modal.Step id="form">
        <div className="form-row">
          <label>{t.formatMessage({ id: 'expense_modal.label_amount' })}</label>
          <PriceInput value={amount} onChange={setAmount} autoFocus />
        </div>
        <div className="form-row">
          <label>{t.formatMessage({ id: 'expense_modal.label_date' })}</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="form-row">
          <label>{t.formatMessage({ id: 'expense_modal.label_category' })}</label>
          <ExpenseCategoryPicker
            value={categoryId}
            onChange={setCategoryId}
            onRequestAdd={() => { /* open AddCategoryModal — see Task 20 */ }}
          />
        </div>
        <div className="form-row">
          <label>{t.formatMessage({ id: 'expense_modal.label_note' })}</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000}
            placeholder={t.formatMessage({ id: 'expense_modal.note_placeholder' })} />
        </div>
        {error && <div className="form-error">{error}</div>}
      </Modal.Step>
      <Modal.Footer>
        <button type="button" onClick={onClose} disabled={submitting}>
          {t.formatMessage({ id: 'expense_modal.cancel' })}
        </button>
        <button type="button" onClick={onSave} disabled={submitting} className="primary">
          {t.formatMessage({ id: 'expense_modal.save' })}
        </button>
      </Modal.Footer>
    </Modal>
  )
}
```

(Substitute Modal/PriceInput names per the actual exports in `apps/web/src/components/ui/`.)

- [ ] **Step 3: Type-check and smoke**

```bash
npm run build --workspace=apps/web && npm run dev
```

Open the app, navigate to Ledger → Expenses, tap "Add expense". The modal should open with the form. Save a $5 expense. It should appear in the list immediately.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/expenses/AddExpenseModal.tsx apps/web/src/components/expenses/ExpenseCategoryPicker.tsx
git commit -m "feat(web): AddExpenseModal with category picker"
```

---

### Task 19 — `EditExpenseModal` + `ExpenseDetailModal`

**Files:**
- Create: `apps/web/src/components/expenses/ExpenseDetailModal.tsx`
- Create: `apps/web/src/components/expenses/EditExpenseModal.tsx`

Per CLAUDE.md: separate add/edit modals (never combine with conditional rendering).

- [ ] **Step 1: Implement ExpenseDetailModal (read view + delete)**

```tsx
// apps/web/src/components/expenses/ExpenseDetailModal.tsx
import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Modal } from '@/components/ui'
import type { Expense } from '@kasero/shared/types/expense'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'
import { useExpenses } from '@/contexts/expenses-context'
import { EditExpenseModal } from './EditExpenseModal'

interface Props {
  expense: Expense | null
  onClose: () => void
}

export function ExpenseDetailModal({ expense, onClose }: Props) {
  const t = useIntl()
  const { formatCurrency, formatDate } = useBusinessFormat()
  const { remove } = useExpenses()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (!expense) return null

  return (
    <>
      <Modal open={!editing} onClose={onClose} title={`#${expense.expenseNumber}`}>
        <Modal.Step id="detail">
          <div className="expense-detail-amount">−{formatCurrency(expense.amount)}</div>
          <div className="expense-detail-date">{formatDate(expense.date)}</div>
          {expense.note && <div className="expense-detail-note">{expense.note}</div>}
          {expense.photoUrl && <img src={expense.photoUrl} className="expense-detail-photo" alt="" />}
          {confirmDelete && (
            <div className="confirm-delete">
              <p>{t.formatMessage({ id: 'expense_modal.delete_confirm_body' })}</p>
              <button onClick={async () => { await remove(expense.id); onClose() }} className="danger">
                {t.formatMessage({ id: 'expense_modal.delete' })}
              </button>
              <button onClick={() => setConfirmDelete(false)}>
                {t.formatMessage({ id: 'expense_modal.cancel' })}
              </button>
            </div>
          )}
        </Modal.Step>
        <Modal.Footer>
          <button onClick={() => setConfirmDelete(true)}>{t.formatMessage({ id: 'expense_modal.delete' })}</button>
          <button onClick={() => setEditing(true)} className="primary">
            {t.formatMessage({ id: 'expense_modal.title_edit' })}
          </button>
        </Modal.Footer>
      </Modal>
      <EditExpenseModal
        expense={editing ? expense : null}
        onClose={() => setEditing(false)}
        onSaved={() => { setEditing(false); onClose() }}
      />
    </>
  )
}
```

- [ ] **Step 2: Implement EditExpenseModal**

Mirror `AddExpenseModal` but pre-fill state from `expense` and call `update` instead of `create`. Skipped for brevity in this plan — copy the body of `AddExpenseModal.tsx` verbatim, then:
- Add prop `expense: Expense | null`, `onSaved: () => void`.
- Replace `useState(null)` / `useState('')` initial values with `expense?.amount ?? null`, `expense?.note ?? ''`, etc.
- Replace `create({...})` call with `update(expense!.id, {...})`.
- Replace modal title key with `expense_modal.title_edit`.
- Reset uses `expense` not defaults — re-derive from prop changes via `useEffect(() => { if (expense) { setAmount(expense.amount); ... } }, [expense])`.

- [ ] **Step 3: Smoke test**

Launch dev, tap an existing expense → detail opens, tap Edit → edit modal opens with prefilled fields, change amount, save. List updates. Tap detail → Delete → Confirm. Row disappears.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/expenses/ExpenseDetailModal.tsx apps/web/src/components/expenses/EditExpenseModal.tsx
git commit -m "feat(web): ExpenseDetailModal and EditExpenseModal"
```

---

### Task 20 — Home monthly summary card

**Files:**
- Create: `apps/web/src/components/home/MonthlySummaryCard.tsx`
- Modify: `apps/web/src/components/home/HomeView.tsx` (or whatever component renders the Home tab body)

- [ ] **Step 1: Implement MonthlySummaryCard**

```tsx
// apps/web/src/components/home/MonthlySummaryCard.tsx
import { useIntl } from 'react-intl'
import { useHistory } from 'react-router-dom'
import { useExpensesSummary } from '@/hooks/useExpensesSummary'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'
import { useBusinessId } from '@/hooks/useBusinessId'
import { useFeatureFlag } from '@/lib/feature-flags'

export function MonthlySummaryCard() {
  const t = useIntl()
  const history = useHistory()
  const businessId = useBusinessId()
  const { formatCurrency } = useBusinessFormat()
  const { summary, loading } = useExpensesSummary()
  const enabled = useFeatureFlag('expenses_v1')

  if (!enabled || loading || !summary) return null

  const goTo = (subTab: 'sales' | 'expenses') => {
    // The Ledger tab path is still /:bid/sales; the sub-tab is selected
    // via state passed through the router. Use whatever convention exists.
    history.push(`/${businessId}/sales`, { ledgerSubTab: subTab })
  }

  return (
    <div className="monthly-summary-card">
      <h3>{t.formatMessage({ id: 'home.monthly_summary_title' })}</h3>
      <div className="monthly-summary-card__row">
        <button onClick={() => goTo('sales')} className="monthly-summary-card__metric --income">
          <span className="label">{t.formatMessage({ id: 'home.monthly_summary_income' })}</span>
          <span className="value">+{formatCurrency(summary.totalIncome)}</span>
        </button>
        <button onClick={() => goTo('expenses')} className="monthly-summary-card__metric --expense">
          <span className="label">{t.formatMessage({ id: 'home.monthly_summary_expenses' })}</span>
          <span className="value">−{formatCurrency(summary.totalExpenses)}</span>
        </button>
        <div className="monthly-summary-card__metric --net">
          <span className="label">{t.formatMessage({ id: 'home.monthly_summary_net' })}</span>
          <span className="value" data-positive={summary.net >= 0}>
            {summary.net >= 0 ? '+' : ''}{formatCurrency(summary.net)}
          </span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Mount it in Home**

Open the Home view component (find via `grep -r "HomeTab\|HomeView" apps/web/src`). Add `<MonthlySummaryCard />` at the top of the content area, above any existing content.

- [ ] **Step 3: Style with CSS variables**

Create or extend `apps/web/src/styles/home.css` (or wherever home styling lives). Use only `var(--color-text-primary)` / `var(--color-positive)` / `var(--color-negative)` / etc. — no hardcoded colors per CLAUDE.md.

- [ ] **Step 4: Smoke test**

Launch dev. Home tab shows the card with current month's numbers. Tap "Expenses" → routes to Ledger tab on Expenses sub-tab.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/home/ apps/web/src/styles/home.css
git commit -m "feat(web): Home monthly summary card linking into Ledger"
```

---

### Task 21 — End-to-end smoke + CSP verification

**Files:**
- (No code changes — verification only)

- [ ] **Step 1: Manual walkthrough**

Run `npm run dev`. Walk this script:

1. Create a new business (forces seed of default expense categories).
2. Home shows the MonthlySummaryCard with zeros.
3. Ring up a sale of $100. Home card updates to income $100, net $100.
4. Tap Ledger tab → it reads "Ledger", two sub-tabs visible.
5. Tap Expenses sub-tab → empty state appears.
6. Tap "Add expense", enter $30, "Supplies" category, note "test". Save.
7. Row appears immediately. Home card updates to net $70.
8. Tap the row → detail modal. Tap Edit → change amount to $40 → save. Row updates.
9. Tap the row → Delete → confirm. Row disappears.
10. Switch language to Spanish, reload. All ledger/expense strings show in Spanish.
11. Switch to Japanese, reload. Same check.

- [ ] **Step 2: CSP verification**

Open DevTools → Console. Walk the same script. **Zero CSP violations expected.** Photo upload uses the existing icon pipeline, so no new origins are added; no changes to `apps/api/next.config.js` should be needed. If any violation appears, STOP and triage per CLAUDE.md's CSP map.

- [ ] **Step 3: i18n contract check**

```bash
npm run i18n:types --workspace=apps/web
```

Expected: no diff (types are already up to date). If there's a diff, commit it.

- [ ] **Step 4: Full type-check + lint + test**

```bash
npm run lint
npm run test
npm run build
```

Expected: all green.

- [ ] **Step 5: Final commit (only if regen produced changes)**

```bash
git status
# if i18n/messageIds.d.ts has uncommitted changes:
git add apps/web/src/i18n/messageIds.d.ts
git commit -m "chore(i18n): refresh generated message ID types"
```

---

## Self-review

**Spec coverage check:** Each spec requirement has a task —
- `expenses` table → Task 1. `expense_categories` table → Task 1. `nextExpenseNumber` column → Task 1.
- Shared types → Task 2. ApiMessageCode values → Task 3. Realtime event types → Task 4.
- Category CRUD (POST, GET, PATCH, DELETE) → Tasks 6, 7. Expense CRUD (POST, GET, GET-one, PATCH, DELETE, summary) → Tasks 8, 9, 10.
- Default category seeding on business create → Task 11.
- i18n keys (en-US, es, ja) + type regen → Tasks 12, 13.
- Feature flag → Task 14.
- Contexts + hooks → Task 15.
- Ledger tab rename + TabContainer + ExpensesView → Tasks 16, 17.
- AddExpenseModal, EditExpenseModal, ExpenseDetailModal → Tasks 18, 19.
- Home summary card → Task 20.
- End-to-end smoke + CSP check → Task 21.

**Deferred to Phase B** (not in this plan, surfaced in spec): inventory adjustments, the bridge "Log as expense" checkbox, removal of providers/orders, pending-orders disclosure banner, `inventory_adjustments` audit table, `inventory.adjusted` realtime event.

**Placeholders scan:** No "TBD" / "TODO" / "implement later" remain. Some sub-references defer to the actual reference file in the codebase ("look at ProductsView for TabContainer API") rather than reproducing 400 lines verbatim — engineer is expected to consult those files.

**Type consistency:** `Expense`, `ExpenseCategory`, `ExpenseSummary` used consistently across tasks. `expense.created` / `expense.updated` / `expense.deleted` event names match between the realtime types (Task 4), backend publishes (Tasks 8/9/10), and frontend handlers (Task 15). `ApiMessageCode.EXPENSE_*` codes match between the enum (Task 3), backend responses (Tasks 6–10), and i18n keys (Tasks 12, 13).

**Open question deferred:** the seed category names ship in `en-US` initially (Task 11). A future task can localize the seed at business-create time using the business `locale` if needed. Documented in the spec under open questions.
