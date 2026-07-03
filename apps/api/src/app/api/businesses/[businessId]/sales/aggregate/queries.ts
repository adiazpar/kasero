import { db, sales, saleItems } from '@/db'
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm'
import type { PaymentMethod } from '@kasero/shared/types/sale'

/**
 * All four queries window on `sales.date` (the user-facing back-dateable
 * date), matching the existing `computeStats` precedent in
 * `src/app/api/businesses/[businessId]/sales/route.ts`. Uses the existing
 * `idx_sales_business_date` composite index on (business_id, date) — the
 * extra `status = 'completed'` predicate is a cheap residual filter on the
 * rows the index already narrowed, so no new index is needed.
 *
 * Voided sales are excluded from every aggregate here: a void is a
 * reversal, not revenue.
 *
 * Hour buckets are UTC. Documented limitation — see startOfUtcDay in
 * `src/lib/sales-helpers.ts` for the v1.1 locale-aware-buckets todo.
 */

export interface DailyRevenueRow {
  day: string
  total: number
}

export interface TopProductRow {
  productId: string | null
  productName: string
  quantity: number
  revenue: number
}

export interface PaymentSplitRow {
  paymentMethod: PaymentMethod
  total: number
}

export interface HourlyRow {
  hour: number
  total: number
}

export async function queryDailyRevenue(
  businessId: string,
  since: Date,
): Promise<DailyRevenueRow[]> {
  const dayExpr = sql<string>`date(${sales.date}, 'unixepoch')`
  return db
    .select({
      day: dayExpr,
      total: sql<number>`SUM(${sales.total})`,
    })
    .from(sales)
    .where(
      and(
        eq(sales.businessId, businessId),
        gte(sales.date, since),
        eq(sales.status, 'completed'),
      ),
    )
    .groupBy(dayExpr)
    .orderBy(dayExpr)
    .all()
}

export async function queryTopProducts(
  businessId: string,
  since: Date,
): Promise<TopProductRow[]> {
  const revenueExpr = sql<number>`SUM(${saleItems.quantity} * ${saleItems.unitPrice})`
  return db
    .select({
      productId: saleItems.productId,
      productName: saleItems.productName,
      quantity: sql<number>`SUM(${saleItems.quantity})`,
      revenue: revenueExpr,
    })
    .from(saleItems)
    .innerJoin(sales, eq(saleItems.saleId, sales.id))
    .where(
      and(
        eq(sales.businessId, businessId),
        gte(sales.date, since),
        eq(sales.status, 'completed'),
      ),
    )
    .groupBy(saleItems.productId, saleItems.productName)
    .orderBy(desc(revenueExpr))
    .limit(10)
    .all()
}

export async function queryPaymentSplit(
  businessId: string,
  since: Date,
): Promise<PaymentSplitRow[]> {
  return db
    .select({
      paymentMethod: sales.paymentMethod,
      total: sql<number>`SUM(${sales.total})`,
    })
    .from(sales)
    .where(
      and(
        eq(sales.businessId, businessId),
        gte(sales.date, since),
        eq(sales.status, 'completed'),
      ),
    )
    .groupBy(sales.paymentMethod)
    .all()
}

/**
 * Sum of `sales.total` across the previous 7-day window, used by the
 * Home "This week" trend card's vs-last-week delta. `since` is the
 * inclusive lower bound (today − 13 days UTC); `until` is the exclusive
 * upper bound (today − 6 days UTC, i.e. one day past the previous
 * window's last day). Returns 0 when there were no sales in the
 * window. Uses the same `idx_sales_business_date` composite index the
 * other queries use.
 */
export async function queryPreviousWeekRevenue(
  businessId: string,
  since: Date,
  until: Date,
): Promise<number> {
  const row = await db
    .select({
      total: sql<number | null>`SUM(${sales.total})`,
    })
    .from(sales)
    .where(
      and(
        eq(sales.businessId, businessId),
        gte(sales.date, since),
        lt(sales.date, until),
        eq(sales.status, 'completed'),
      ),
    )
    .get()
  return row?.total ?? 0
}

export async function queryHourly(
  businessId: string,
  since: Date,
): Promise<HourlyRow[]> {
  const hourExpr = sql<number>`CAST(strftime('%H', ${sales.date}, 'unixepoch') AS INTEGER)`
  return db
    .select({
      hour: hourExpr,
      total: sql<number>`SUM(${sales.total})`,
    })
    .from(sales)
    .where(
      and(
        eq(sales.businessId, businessId),
        gte(sales.date, since),
        eq(sales.status, 'completed'),
      ),
    )
    .groupBy(hourExpr)
    .orderBy(hourExpr)
    .all()
}
