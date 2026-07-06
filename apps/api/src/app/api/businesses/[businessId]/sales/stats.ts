import { db, sales } from '@/db'
import { and, eq, gte, lt, sql } from 'drizzle-orm'
import { startOfUtcDay, startOfPrevUtcDay } from '@kasero/shared/sales-helpers'

/**
 * Today-vs-yesterday sales stats. Extracted from the sales list route so
 * the Pulse digest route can reuse the exact same aggregate instead of
 * duplicating the SQL. Route files must only export HTTP handlers, so
 * shared helpers live in this sibling module.
 */

export interface StatsResult {
  todayRevenue: number
  todayCount: number
  todayAvgTicket: number | null
  yesterdayRevenue: number
  vsYesterdayPct: number | null
}

export async function computeStats(businessId: string): Promise<StatsResult> {
  const now = new Date()
  const todayStart = startOfUtcDay(now)
  const yesterdayStart = startOfPrevUtcDay(now)

  // One conditional-aggregate query replaces the two row-pulling selects
  // + JS reduce (same pattern as sales-sessions/close). The outer WHERE
  // narrows to rows since yesterdayStart; the CASEs bucket them into
  // today vs yesterday. Voided sales are excluded — a void is a reversal,
  // not revenue.
  const row = await db
    .select({
      todayRevenue: sql<number>`COALESCE(SUM(CASE WHEN ${gte(sales.date, todayStart)} THEN ${sales.total} END), 0)`,
      todayCount: sql<number>`COUNT(CASE WHEN ${gte(sales.date, todayStart)} THEN 1 END)`,
      yesterdayRevenue: sql<number>`COALESCE(SUM(CASE WHEN ${lt(sales.date, todayStart)} THEN ${sales.total} END), 0)`,
    })
    .from(sales)
    .where(
      and(
        eq(sales.businessId, businessId),
        gte(sales.date, yesterdayStart),
        eq(sales.status, 'completed'),
      ),
    )
    .get()

  const todayRevenue = Number(row?.todayRevenue ?? 0)
  const todayCount = Number(row?.todayCount ?? 0)
  const yesterdayRevenue = Number(row?.yesterdayRevenue ?? 0)
  const todayAvgTicket = todayCount > 0 ? todayRevenue / todayCount : null
  const vsYesterdayPct =
    yesterdayRevenue > 0
      ? ((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100
      : null

  return {
    todayRevenue,
    todayCount,
    todayAvgTicket,
    yesterdayRevenue,
    vsYesterdayPct,
  }
}
