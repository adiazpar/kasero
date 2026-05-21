#!/usr/bin/env node
/**
 * One-shot Ledger Phase A+B prod migration, applied directly via libsql.
 * Bypasses drizzle-kit's interactive rename resolver. Idempotent: safe to
 * re-run; uses IF EXISTS / IF NOT EXISTS where SQLite allows.
 *
 * Run with: node apps/api/scripts/prod-migrate-ledger.mjs
 * Requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in apps/api/.env.local.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
import { createClient } from '@libsql/client'

config({ path: resolve(process.cwd(), 'apps/api/.env.local') })

const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN
if (!url || !authToken) {
  console.error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN required')
  process.exit(1)
}

console.log(`Connecting to ${url}`)
const client = createClient({ url, authToken })

async function listTables() {
  const r = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%' AND name NOT LIKE '_litestream%' ORDER BY name"
  )
  return r.rows.map((row) => row.name)
}

async function hasColumn(table, column) {
  const r = await client.execute(`PRAGMA table_info(${table})`)
  return r.rows.some((row) => row.name === column)
}

const tablesBefore = await listTables()
console.log('Tables before:', tablesBefore.join(', '))

const hadNextOrderNumber = await hasColumn('businesses', 'next_order_number')
const hadNextExpenseNumber = await hasColumn('businesses', 'next_expense_number')
console.log(`businesses.next_order_number present: ${hadNextOrderNumber}`)
console.log(`businesses.next_expense_number present: ${hadNextExpenseNumber}`)

// ============================================================
// Statements run in order. Each is wrapped in try/catch so a
// "table already dropped" or "column already added" doesn't halt.
// ============================================================

const ADDITIVE = [
  // expense_categories
  `CREATE TABLE IF NOT EXISTS expense_categories (
    id TEXT PRIMARY KEY NOT NULL,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  `CREATE INDEX IF NOT EXISTS idx_expense_categories_business_id ON expense_categories(business_id)`,

  // expenses
  `CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY NOT NULL,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    created_by_user_id TEXT NOT NULL REFERENCES users(id),
    expense_number INTEGER,
    date INTEGER NOT NULL,
    amount REAL NOT NULL,
    category_id TEXT REFERENCES expense_categories(id) ON DELETE SET NULL,
    note TEXT,
    photo_url TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  `CREATE INDEX IF NOT EXISTS idx_expenses_business_id ON expenses(business_id)`,
  `CREATE INDEX IF NOT EXISTS idx_expenses_business_date ON expenses(business_id, date)`,

  // inventory_adjustments
  `CREATE TABLE IF NOT EXISTS inventory_adjustments (
    id TEXT PRIMARY KEY NOT NULL,
    business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_by_user_id TEXT NOT NULL REFERENCES users(id),
    delta INTEGER NOT NULL,
    reason TEXT,
    related_expense_id TEXT REFERENCES expenses(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
  `CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_business_id ON inventory_adjustments(business_id)`,
  `CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_product_id ON inventory_adjustments(product_id)`,
  `CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_business_created ON inventory_adjustments(business_id, created_at)`,
]

const DESTRUCTIVE = [
  `DROP TABLE IF EXISTS order_items`,
  `DROP TABLE IF EXISTS orders`,
  `DROP TABLE IF EXISTS provider_notes`,
  `DROP TABLE IF EXISTS providers`,
]

console.log('\n=== Applying additive changes ===')
for (const sql of ADDITIVE) {
  try {
    await client.execute(sql)
    console.log('  OK:', sql.split('\n')[0].slice(0, 80))
  } catch (err) {
    console.log('  FAIL:', sql.split('\n')[0].slice(0, 80), '—', err.message)
    throw err
  }
}

if (!hadNextExpenseNumber) {
  try {
    await client.execute(`ALTER TABLE businesses ADD COLUMN next_expense_number INTEGER NOT NULL DEFAULT 1`)
    console.log('  OK: ALTER TABLE businesses ADD COLUMN next_expense_number')
  } catch (err) {
    console.log('  FAIL: ADD next_expense_number —', err.message)
    throw err
  }
} else {
  console.log('  SKIP: next_expense_number already exists')
}

console.log('\n=== Applying destructive changes ===')
for (const sql of DESTRUCTIVE) {
  try {
    await client.execute(sql)
    console.log('  OK:', sql)
  } catch (err) {
    console.log('  FAIL:', sql, '—', err.message)
    throw err
  }
}

if (hadNextOrderNumber) {
  try {
    await client.execute(`ALTER TABLE businesses DROP COLUMN next_order_number`)
    console.log('  OK: ALTER TABLE businesses DROP COLUMN next_order_number')
  } catch (err) {
    console.log('  FAIL: DROP next_order_number —', err.message)
    throw err
  }
} else {
  console.log('  SKIP: next_order_number already absent')
}

console.log('\n=== Final state ===')
const tablesAfter = await listTables()
console.log('Tables after:', tablesAfter.join(', '))
console.log(`next_expense_number present: ${await hasColumn('businesses', 'next_expense_number')}`)
console.log(`next_order_number present: ${await hasColumn('businesses', 'next_order_number')}`)

await client.close()
console.log('\nDone.')
