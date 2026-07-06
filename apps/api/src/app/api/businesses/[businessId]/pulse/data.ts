import { db, products, users } from '@/db'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { BusinessAccess } from '@/lib/business-auth'
import { startOfUtcDay } from '@kasero/shared/sales-helpers'
import { computeStats } from '../sales/stats'
import {
  queryDailyRevenue,
  queryTopProducts,
  queryPaymentSplit,
  queryPreviousWeekRevenue,
} from '../sales/aggregate/queries'
import { queryMonthlySummary } from '../expenses/summary/summary-query'

/**
 * Data gathering + server-side formatting for the Kasero Pulse digest.
 *
 * Every monetary amount is formatted HERE with Intl.NumberFormat using
 * the business locale/currency before it reaches the model — the model
 * must never do arithmetic or number formatting. All queries are reused
 * from the existing sales/expenses aggregate modules; only the low-stock
 * pick is new (no other surface needs "top 5 by deficit" server-side).
 */

export interface PulseSummaryData {
  business: { name: string }
  generatedAtUtc: string
  today: {
    revenue: string
    salesCount: number
    avgTicket: string | null
    vsYesterdayPct: number | null
  }
  last7Days: {
    total: string
    previousWeekTotal: string
    dailyRevenue: { day: string; revenue: string }[]
    paymentSplit: { method: string; total: string }[]
  }
  thisMonth: {
    month: string
    income: string
    expenses: string
    net: string
  }
  topProductsLast30Days: { name: string; unitsSold: number; revenue: string }[]
  lowStockProducts: { name: string; stock: number; threshold: number }[]
}

interface LowStockRow {
  name: string
  stock: number
  threshold: number
}

/**
 * Products at or under their low-stock threshold, worst deficit first,
 * capped at 5. Matches the client-side low-stock rule in
 * useProductFilters.ts: per-product threshold defaulting to 10, null
 * stock treated as 0. Inactive products are excluded — a discontinued
 * item at zero stock is not a restock watchout.
 */
export async function queryLowStockProducts(
  businessId: string,
): Promise<LowStockRow[]> {
  const stockExpr = sql<number>`COALESCE(${products.stock}, 0)`
  const thresholdExpr = sql<number>`COALESCE(${products.lowStockThreshold}, 10)`
  const deficitExpr = sql<number>`${thresholdExpr} - ${stockExpr}`
  return db
    .select({
      name: products.name,
      stock: stockExpr,
      threshold: thresholdExpr,
    })
    .from(products)
    .where(
      and(
        eq(products.businessId, businessId),
        eq(products.active, true),
        sql`${stockExpr} <= ${thresholdExpr}`,
      ),
    )
    .orderBy(desc(deficitExpr))
    .limit(5)
    .all()
}

/**
 * The digest is written in the requesting USER's UI language (not the
 * business locale — language is a user preference, formatting is a
 * business property). Falls back to en-US when the row is missing.
 */
export async function fetchUserLanguage(userId: string): Promise<string> {
  const row = await db
    .select({ language: users.language })
    .from(users)
    .where(eq(users.id, userId))
    .get()
  return row?.language || 'en-US'
}

function buildCurrencyFormatter(
  locale: string,
  currency: string,
): (value: number) => string {
  try {
    const fmt = new Intl.NumberFormat(locale, { style: 'currency', currency })
    return (value) => fmt.format(value)
  } catch {
    // Corrupt locale/currency on the row must not take the digest down —
    // fall back to the app defaults.
    const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
    return (value) => fmt.format(value)
  }
}

export async function gatherPulseData(
  access: BusinessAccess,
): Promise<PulseSummaryData> {
  const formatCurrency = buildCurrencyFormatter(
    access.businessLocale,
    access.businessCurrency,
  )

  const now = new Date()
  const today = startOfUtcDay(now)
  // Same window arithmetic as sales/aggregate/route.ts: current window is
  // the last 7 calendar days inclusive of today; previous window is the 7
  // days immediately before it (no overlap).
  const sevenDaysAgo = new Date(today)
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 6)
  const fourteenDaysAgo = new Date(today)
  fourteenDaysAgo.setUTCDate(fourteenDaysAgo.getUTCDate() - 13)
  const thirtyDaysAgo = new Date(today)
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 29)

  const businessId = access.businessId

  const [
    stats,
    dailyRows,
    topProductRows,
    splitRows,
    previousWeekTotal,
    monthlySummary,
    lowStockRows,
  ] = await Promise.all([
    computeStats(businessId),
    queryDailyRevenue(businessId, sevenDaysAgo),
    queryTopProducts(businessId, thirtyDaysAgo),
    queryPaymentSplit(businessId, sevenDaysAgo),
    queryPreviousWeekRevenue(businessId, fourteenDaysAgo, sevenDaysAgo),
    queryMonthlySummary(businessId, now),
    queryLowStockProducts(businessId),
  ])

  const weekTotal = dailyRows.reduce((sum, r) => sum + Number(r.total), 0)

  return {
    business: { name: access.businessName },
    generatedAtUtc: now.toISOString(),
    today: {
      revenue: formatCurrency(stats.todayRevenue),
      salesCount: stats.todayCount,
      avgTicket:
        stats.todayAvgTicket !== null ? formatCurrency(stats.todayAvgTicket) : null,
      vsYesterdayPct:
        stats.vsYesterdayPct !== null ? Math.round(stats.vsYesterdayPct) : null,
    },
    last7Days: {
      total: formatCurrency(weekTotal),
      previousWeekTotal: formatCurrency(previousWeekTotal),
      dailyRevenue: dailyRows.map((r) => ({
        day: r.day,
        revenue: formatCurrency(Number(r.total)),
      })),
      paymentSplit: splitRows.map((r) => ({
        method: r.paymentMethod,
        total: formatCurrency(Number(r.total)),
      })),
    },
    thisMonth: {
      month: monthlySummary.month,
      income: formatCurrency(monthlySummary.totalIncome),
      expenses: formatCurrency(monthlySummary.totalExpenses),
      net: formatCurrency(monthlySummary.net),
    },
    topProductsLast30Days: topProductRows.map((r) => ({
      name: r.productName,
      unitsSold: Number(r.quantity),
      revenue: formatCurrency(Number(r.revenue)),
    })),
    lowStockProducts: lowStockRows.map((r) => ({
      name: r.name,
      stock: Number(r.stock),
      threshold: Number(r.threshold),
    })),
  }
}
