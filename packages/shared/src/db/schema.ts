import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { relations, sql } from 'drizzle-orm'

// ===========================================
// BUSINESSES (Multi-tenant support)
// ===========================================
export const businesses = sqliteTable('businesses', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  icon: text('icon'), // Emoji or base64 image
  // Localization
  locale: text('locale').default('en-US'), // e.g., 'en-US', 'es-MX', 'fr-FR'
  currency: text('currency').default('USD'), // ISO 4217 code
  // Product settings (inline - no separate table needed)
  defaultCategoryId: text('default_category_id'),
  sortPreference: text('sort_preference').default('name_asc'),
  // Monotonic counter for orders.order_number. Incremented atomically
  // on each order insert so references are stable even after deletes.
  nextOrderNumber: integer('next_order_number').default(1).notNull(),
  // Monotonic counter for sales.sale_number. Incremented atomically on each
  // sale insert so references are stable even after deletes.
  nextSaleNumber: integer('next_sale_number').default(1).notNull(),
  // Monotonic counter for products.product_number. Incremented atomically
  // on each product insert so the success-step stamp ("PRODUCT 0042 ·
  // CREATED") and any audit references stay stable across deletes.
  nextProductNumber: integer('next_product_number').default(1).notNull(),
})

// ===========================================
// USERS
// ===========================================
// Authenticated via better-auth in passwordless mode (email OTP only). No
// password material is stored anywhere; the legacy users.password /
// password_changed_at / tokens_invalid_before columns and the account.password
// column were dropped in 2026-05-14-01-passwordless-cleanup.sql.
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').unique().notNull(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).default(false).notNull(),
  emailVerifiedAt: integer('email_verified_at', { mode: 'timestamp' }),
  // better-auth's default field name is `image`; the column on disk stays `avatar`
  // for zero-downtime migration. Aliased via field mapping in apps/api/src/lib/auth.ts.
  avatar: text('avatar'),
  language: text('language').default('en-US').notNull(),
  phoneNumber: text('phone_number'),
  phoneNumberVerified: integer('phone_number_verified', { mode: 'boolean' }).default(false).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  // Expression index for case-insensitive email lookup (invite-validate,
  // transfer-initiate). The built-in unique index on `email` is case-
  // sensitive and is bypassed when queries wrap the column in LOWER().
  index('idx_users_email_lower').on(sql`lower(${table.email})`),
])

// ===========================================
// AUTH SURFACE (better-auth managed tables)
// ===========================================
// These tables are owned by better-auth. better-auth opens/closes its own
// transactions when reading/writing them; do not hand-write rows into these
// tables outside of explicit data migrations.

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('idx_session_user_id').on(table.userId),
  index('idx_session_expires_at').on(table.expiresAt),
])

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('idx_account_user_id').on(table.userId),
  index('idx_account_provider').on(table.providerId, table.accountId),
])

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('idx_verification_identifier').on(table.identifier),
  index('idx_verification_expires_at').on(table.expiresAt),
])

// Note: better-auth's rate-limit counters were moved to Upstash Redis
// (secondary-storage) in migration 2026-05-15-01-drop-rate-limit-table.sql.
// The `rate_limit` table was dropped; TTL-based expiry in Redis replaces
// the unbounded accumulation we had with the SQL backend. See
// apps/api/src/lib/auth.ts (`secondaryStorage` + `rateLimit.storage`).

// ===========================================
// BUSINESS USERS (Multi-business membership)
// ===========================================
// Join table enabling users to belong to multiple businesses
export const businessUsers = sqliteTable('business_users', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  businessId: text('business_id').references(() => businesses.id, { onDelete: 'cascade' }).notNull(),
  role: text('role', { enum: ['owner', 'partner', 'employee'] }).notNull(),
  status: text('status', { enum: ['active', 'pending', 'disabled'] }).default('active').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('idx_business_users_user_id').on(table.userId),
  index('idx_business_users_business_id').on(table.businessId),
  index('idx_business_users_status').on(table.status),
  // Composite index for the hottest query in the app: requireBusinessAccess,
  // role/status mutations, leave, accept-transfer, invite-join — every
  // business-scoped request runs `WHERE userId = ? AND businessId = ?`.
  // Non-unique today: the one-row-per-(user, business) constraint is the
  // right invariant, but enforcing it atomically would fail a prod push if
  // any duplicate rows exist. Keeping this as a performance index only.
  index('idx_business_users_user_business').on(table.userId, table.businessId),
  // Single-active-owner invariant. The transfer/accept demote-and-promote
  // sequence relies on there being exactly one row with role='owner' AND
  // status='active' per business; without this, a manual DB write or a
  // future race could land two owners and either one could re-transfer
  // or delete the business. PROD PUSH NOTE: this push will FAIL if any
  // existing business has more than one active-owner row. Run a
  // pre-flight `SELECT businessId, COUNT(*) FROM business_users WHERE
  // role='owner' AND status='active' GROUP BY businessId HAVING COUNT(*)>1`
  // and reconcile before pushing to Turso.
  uniqueIndex('idx_unique_business_users_owner_per_business')
    .on(table.businessId)
    .where(sql`${table.role} = 'owner' AND ${table.status} = 'active'`),
])

// ===========================================
// PRODUCT CATEGORIES
// ===========================================
export const productCategories = sqliteTable('product_categories', {
  id: text('id').primaryKey(),
  businessId: text('business_id').references(() => businesses.id).notNull(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
}, (table) => [
  index('idx_product_categories_business_id').on(table.businessId),
])

// ===========================================
// PRODUCTS
// ===========================================
export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  businessId: text('business_id').references(() => businesses.id).notNull(),
  // Per-business sequential counter set on insert from
  // businesses.next_product_number. Stable across deletes — the
  // success-step stamp ("PRODUCT 0042") and any external reference
  // can rely on it. Nullable for migration safety on rows that
  // predated the column; backfilled at read time when null.
  productNumber: integer('product_number'),
  name: text('name').notNull(),
  price: real('price').notNull(),
  costPrice: real('cost_price'),
  categoryId: text('category_id').references(() => productCategories.id, { onDelete: 'set null' }),
  stock: integer('stock').default(0),
  lowStockThreshold: integer('low_stock_threshold').default(10),
  icon: text('icon'), // Base64-encoded image data
  barcode: text('barcode'), // Physical barcode/QR code value (as shown on the label)
  barcodeFormat: text('barcode_format', {
    enum: ['CODABAR', 'CODE_39', 'CODE_93', 'CODE_128', 'ITF', 'EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'UPC_EAN_EXTENSION']
  }),
  barcodeSource: text('barcode_source', {
    enum: ['scanned', 'generated', 'manual']
  }),
  // Canonical 14-digit GTIN for retail barcodes (EAN-13, UPC-A, EAN-8, UPC-E).
  // Computed automatically on write. Null for non-retail formats. This is the
  // stable external identity used by supplier / POS / e-commerce integrations.
  barcodeGtin: text('barcode_gtin'),
  active: integer('active', { mode: 'boolean' }).default(true).notNull(),
  // Audit timestamps — surfaced in ProductInfoDrawer's "Last updated"
  // line and useful for debugging stock-discrepancy investigations.
  // SQL-level default (sqlite's `unixepoch()` returns seconds since
  // epoch) so ALTER TABLE ADD COLUMN can backfill existing rows
  // safely. Drizzle reads the integer back as a Date because of the
  // `mode: 'timestamp'` adapter. updatedAt is bumped explicitly on
  // every PATCH that mutates a product row.
  createdAt: integer('created_at', { mode: 'timestamp' })
    .default(sql`(unixepoch())`)
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .default(sql`(unixepoch())`)
    .notNull(),
}, (table) => [
  index('idx_products_business_id').on(table.businessId),
  index('idx_products_category_id').on(table.categoryId),
  index('idx_products_business_active').on(table.businessId, table.active),
  index('idx_products_barcode_gtin').on(table.barcodeGtin),
  // Partial unique index on (businessId, barcode). Archived products no longer
  // exist (hard-delete), so we only need to exclude NULL barcodes. SQLite
  // treats NULLs as distinct in unique indexes, so the IS NOT NULL clause is
  // technically redundant but documents intent.
  uniqueIndex('idx_unique_products_business_barcode')
    .on(table.businessId, table.barcode)
    .where(sql`${table.barcode} IS NOT NULL`),
])

// ===========================================
// PROVIDERS (Suppliers)
// ===========================================
export const providers = sqliteTable('providers', {
  id: text('id').primaryKey(),
  businessId: text('business_id').references(() => businesses.id).notNull(),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  active: integer('active', { mode: 'boolean' }).default(true),
  // Functional timestamp: displayed on the provider detail page ("Since Oct 2025").
  // Nullable so pre-existing rows without a stamp gracefully omit the line.
  createdAt: integer('created_at', { mode: 'timestamp' }),
}, (table) => [
  index('idx_providers_business_id').on(table.businessId),
])

// ===========================================
// PROVIDER NOTES
// ===========================================
// Up to MAX_PROVIDER_NOTES (5) per provider. Cap is enforced in the
// POST /providers/[id]/notes route.
export const providerNotes = sqliteTable('provider_notes', {
  id: text('id').primaryKey(),
  providerId: text('provider_id').references(() => providers.id, { onDelete: 'cascade' }).notNull(),
  // Denormalized for multi-tenant scoping without a join.
  businessId: text('business_id').references(() => businesses.id, { onDelete: 'cascade' }).notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('idx_provider_notes_provider_id').on(table.providerId),
  index('idx_provider_notes_business_provider').on(table.businessId, table.providerId),
])

// ===========================================
// ORDERS (Purchase orders from suppliers)
// ===========================================
export const orders = sqliteTable('orders', {
  id: text('id').primaryKey(),
  businessId: text('business_id').references(() => businesses.id).notNull(),
  providerId: text('provider_id').references(() => providers.id),
  // User who created the order. Nullable so legacy rows from before this
  // column existed stay valid; new inserts always set it.
  createdByUserId: text('created_by_user_id').references(() => users.id),
  // User who received the order. Null until status transitions to
  // 'received'; stamped with the acting user at receive time.
  receivedByUserId: text('received_by_user_id').references(() => users.id),
  // Human-readable reference, auto-numbered per business ("#47"). Nullable
  // so existing rows can be backfilled post-migration; new inserts always
  // compute it in the create route.
  orderNumber: integer('order_number'),
  date: integer('date', { mode: 'timestamp' }).notNull(),
  receivedDate: integer('received_date', { mode: 'timestamp' }),
  total: real('total').notNull(),
  status: text('status', { enum: ['pending', 'received'] }).default('pending').notNull(),
  estimatedArrival: integer('estimated_arrival', { mode: 'timestamp' }),
}, (table) => [
  index('idx_orders_business_id').on(table.businessId),
  index('idx_orders_provider_id').on(table.providerId),
  index('idx_orders_date').on(table.date),
])

// ===========================================
// ORDER ITEMS
// ===========================================
export const orderItems = sqliteTable('order_items', {
  id: text('id').primaryKey(),
  orderId: text('order_id').references(() => orders.id, { onDelete: 'cascade' }).notNull(),
  productId: text('product_id').references(() => products.id, { onDelete: 'set null' }),
  productName: text('product_name').notNull(), // Snapshot at order time
  quantity: integer('quantity').notNull(),
  unitCost: real('unit_cost'),
  subtotal: real('subtotal'),
  receivedQuantity: integer('received_quantity'),
}, (table) => [
  index('idx_order_items_order_id').on(table.orderId),
  // Used by the product-delete blocking-order check (join on productId to
  // find pending orders referencing this product). Without this index that
  // query scans order_items.
  index('idx_order_items_product_id').on(table.productId),
])

// ===========================================
// SALES (Customer transactions)
// ===========================================
export const sales = sqliteTable('sales', {
  id: text('id').primaryKey(),
  businessId: text('business_id').references(() => businesses.id).notNull(),
  // Sequential per-business reference ("#101"). Pulled from
  // businesses.next_sale_number via atomic UPDATE ... RETURNING. Gaps are
  // accepted (failed validations don't burn numbers because reservation
  // happens AFTER validation; a failed batch can still leave a gap).
  saleNumber: integer('sale_number').notNull(),
  createdByUserId: text('created_by_user_id').references(() => users.id).notNull(),
  // Sale date — can be backdated up to 1 year, can be at most 1 minute in
  // the future for clock skew. Used for history sort and stats bucketing.
  date: integer('date', { mode: 'timestamp' }).notNull(),
  total: real('total').notNull(),
  paymentMethod: text('payment_method', { enum: ['cash', 'card', 'other'] }).notNull(),
  notes: text('notes'),
  // Actual record creation time. Distinct from `date` for backdated entries.
  // Not used for stats bucketing — see design spec section 4.
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  // Cash-drawer session this sale belongs to. Always set at insert time
  // by the POST /sales handler. The DB-level NOT NULL is enforced by
  // wiping pre-session sales rows before this push (local) and assuming
  // prod has zero sales rows yet.
  sessionId: text('session_id')
    .references(() => salesSessions.id, { onDelete: 'restrict' })
    .notNull(),
}, (table) => [
  // Drives both the history list query and the today/yesterday stats
  // aggregation. DESC because most queries scan from newest first.
  index('idx_sales_business_date').on(table.businessId, table.date),
  index('idx_sales_session_id').on(table.sessionId),
])

// ===========================================
// SALE ITEMS (Line items per sale)
// ===========================================
export const saleItems = sqliteTable('sale_items', {
  id: text('id').primaryKey(),
  saleId: text('sale_id').references(() => sales.id, { onDelete: 'cascade' }).notNull(),
  // Nullable + ON DELETE SET NULL so deleting a product doesn't block; the
  // productName snapshot survives in history. Note: `subtotal` is NOT stored
  // (computed at read time as quantity * unitPrice) — see design spec.
  productId: text('product_id').references(() => products.id, { onDelete: 'set null' }),
  productName: text('product_name').notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: real('unit_price').notNull(),
}, (table) => [
  index('idx_sale_items_sale_id').on(table.saleId),
  // REQUIRED for ON DELETE SET NULL FK enforcement — without this, every
  // product DELETE full-scans sale_items to null rows. NOT a block-on-delete
  // index (different from order_items.productId, which IS a block index).
  index('idx_sale_items_product_id').on(table.productId),
])

// ===========================================
// SALES SESSIONS (Cash-drawer reconciliation)
// ===========================================
export const salesSessions = sqliteTable('sales_sessions', {
  id: text('id').primaryKey(),
  businessId: text('business_id').references(() => businesses.id).notNull(),

  // Open phase
  openedAt: integer('opened_at', { mode: 'timestamp' }).notNull(),
  openedByUserId: text('opened_by_user_id').references(() => users.id).notNull(),
  startingCash: real('starting_cash').notNull(),

  // Close phase — null while open
  closedAt: integer('closed_at', { mode: 'timestamp' }),
  closedByUserId: text('closed_by_user_id').references(() => users.id),
  countedCash: real('counted_cash'),

  // Denormalized close-time stats — stamped during the close transaction.
  // Avoids re-aggregating the sales table on every history list render.
  salesCount: integer('sales_count'),
  salesTotal: real('sales_total'),
  cashSalesTotal: real('cash_sales_total'),
  expectedCash: real('expected_cash'),
  variance: real('variance'),

  notes: text('notes'),
}, (table) => [
  // Drives history list query: WHERE businessId = ? ORDER BY closedAt DESC.
  index('idx_sales_sessions_business_closed')
    .on(table.businessId, table.closedAt),

  // "At most one open session per business" — DB-enforced.
  uniqueIndex('idx_unique_sales_sessions_open_per_business')
    .on(table.businessId)
    .where(sql`${table.closedAt} IS NULL`),
])

// ===========================================
// INVITE CODES
// ===========================================
export const inviteCodes = sqliteTable('invite_codes', {
  id: text('id').primaryKey(),
  businessId: text('business_id').references(() => businesses.id).notNull(),
  code: text('code').unique().notNull(), // 6 uppercase alphanumeric
  role: text('role', { enum: ['partner', 'employee'] }).notNull(),
  usedBy: text('used_by').references(() => users.id),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('idx_invite_codes_business_id').on(table.businessId),
  index('idx_invite_codes_used_expires').on(table.usedBy, table.expiresAt),
])

// ===========================================
// OWNERSHIP TRANSFERS
// ===========================================
export const ownershipTransfers = sqliteTable('ownership_transfers', {
  id: text('id').primaryKey(),
  businessId: text('business_id').references(() => businesses.id).notNull(),
  code: text('code').unique().notNull(), // 6 uppercase alphanumeric
  fromUser: text('from_user').references(() => users.id).notNull(),
  toEmail: text('to_email').notNull(), // Email instead of phone
  toUser: text('to_user').references(() => users.id),
  status: text('status', {
    enum: ['pending', 'accepted', 'completed', 'expired', 'cancelled']
  }).default('pending').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('idx_ownership_transfers_business_id').on(table.businessId),
  index('idx_ownership_transfers_status').on(table.status),
])

// ===========================================
// RELATIONS
// ===========================================

export const businessesRelations = relations(businesses, ({ many }) => ({
  businessUsers: many(businessUsers),
  products: many(products),
  productCategories: many(productCategories),
  providers: many(providers),
  orders: many(orders),
  sales: many(sales),
  inviteCodes: many(inviteCodes),
  ownershipTransfers: many(ownershipTransfers),
}))

export const usersRelations = relations(users, ({ many }) => ({
  businessMemberships: many(businessUsers),
}))

export const businessUsersRelations = relations(businessUsers, ({ one }) => ({
  user: one(users, {
    fields: [businessUsers.userId],
    references: [users.id],
  }),
  business: one(businesses, {
    fields: [businessUsers.businessId],
    references: [businesses.id],
  }),
}))

export const productsRelations = relations(products, ({ one, many }) => ({
  business: one(businesses, {
    fields: [products.businessId],
    references: [businesses.id],
  }),
  productCategory: one(productCategories, {
    fields: [products.categoryId],
    references: [productCategories.id],
  }),
  orderItems: many(orderItems),
  saleItems: many(saleItems),
}))

export const productCategoriesRelations = relations(productCategories, ({ one, many }) => ({
  business: one(businesses, {
    fields: [productCategories.businessId],
    references: [businesses.id],
  }),
  products: many(products),
}))

export const providersRelations = relations(providers, ({ one, many }) => ({
  business: one(businesses, {
    fields: [providers.businessId],
    references: [businesses.id],
  }),
  orders: many(orders),
  notes: many(providerNotes),
}))

export const providerNotesRelations = relations(providerNotes, ({ one }) => ({
  provider: one(providers, {
    fields: [providerNotes.providerId],
    references: [providers.id],
  }),
  business: one(businesses, {
    fields: [providerNotes.businessId],
    references: [businesses.id],
  }),
}))

export const ordersRelations = relations(orders, ({ one, many }) => ({
  business: one(businesses, {
    fields: [orders.businessId],
    references: [businesses.id],
  }),
  provider: one(providers, {
    fields: [orders.providerId],
    references: [providers.id],
  }),
  items: many(orderItems),
}))

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.id],
  }),
}))

export const salesRelations = relations(sales, ({ one, many }) => ({
  business: one(businesses, {
    fields: [sales.businessId],
    references: [businesses.id],
  }),
  createdByUser: one(users, {
    fields: [sales.createdByUserId],
    references: [users.id],
  }),
  session: one(salesSessions, {
    fields: [sales.sessionId],
    references: [salesSessions.id],
  }),
  items: many(saleItems),
}))

export const saleItemsRelations = relations(saleItems, ({ one }) => ({
  sale: one(sales, {
    fields: [saleItems.saleId],
    references: [sales.id],
  }),
  product: one(products, {
    fields: [saleItems.productId],
    references: [products.id],
  }),
}))

export const salesSessionsRelations = relations(salesSessions, ({ one, many }) => ({
  business: one(businesses, {
    fields: [salesSessions.businessId],
    references: [businesses.id],
  }),
  openedByUser: one(users, {
    fields: [salesSessions.openedByUserId],
    references: [users.id],
    relationName: 'sessionOpenedBy',
  }),
  closedByUser: one(users, {
    fields: [salesSessions.closedByUserId],
    references: [users.id],
    relationName: 'sessionClosedBy',
  }),
  sales: many(sales),
}))

export const inviteCodesRelations = relations(inviteCodes, ({ one }) => ({
  business: one(businesses, {
    fields: [inviteCodes.businessId],
    references: [businesses.id],
  }),
  usedByUser: one(users, {
    fields: [inviteCodes.usedBy],
    references: [users.id],
  }),
}))

export const ownershipTransfersRelations = relations(ownershipTransfers, ({ one }) => ({
  business: one(businesses, {
    fields: [ownershipTransfers.businessId],
    references: [businesses.id],
  }),
  fromUserRelation: one(users, {
    fields: [ownershipTransfers.fromUser],
    references: [users.id],
  }),
  toUserRelation: one(users, {
    fields: [ownershipTransfers.toUser],
    references: [users.id],
  }),
}))

