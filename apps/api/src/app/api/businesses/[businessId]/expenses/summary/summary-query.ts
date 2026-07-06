import { db, expenses, sales } from '@/db'
import { and, eq, gte, lt, sum } from 'drizzle-orm'

/*
 * Calendar-month income / expenses / net aggregate. Extracted from the
 * summary route so the Pulse digest route can reuse the exact same
 * queries instead of duplicating the SQL. Route files must only export
 * HTTP handlers, so the shared helper lives in this sibling module.
 *
 * Voided sales are excluded from income (a void is a reversal, not
 * revenue). The status predicate is a residual filter on rows already
 * narrowed by idx_sales_business_date — no new index needed.
 */

export interface MonthlySummary {
  /** "YYYY-MM" of the aggregated calendar month (UTC). */
  month: string
  totalIncome: number
  totalExpenses: number
  net: number
  taxCollected: number
}

function startOfMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

function startOfNextMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
}

/**
 * Income / expenses / net for the calendar month (UTC) containing
 * `anchor`. Defaults to the current month.
 */
export async function queryMonthlySummary(
  businessId: string,
  anchor: Date = new Date(),
): Promise<MonthlySummary> {
  const from = startOfMonth(anchor)
  const to = startOfNextMonth(anchor)

  // The two aggregates are independent — run them concurrently instead of
  // paying two sequential libSQL round trips.
  const [[incomeRow], [expensesRow]] = await Promise.all([
    db
      .select({ total: sum(sales.total), taxCollected: sum(sales.taxAmount) })
      .from(sales)
      .where(
        and(
          eq(sales.businessId, businessId),
          gte(sales.date, from),
          lt(sales.date, to),
          eq(sales.status, 'completed'),
        ),
      ),
    db
      .select({ total: sum(expenses.amount) })
      .from(expenses)
      .where(
        and(
          eq(expenses.businessId, businessId),
          gte(expenses.date, from),
          lt(expenses.date, to),
        ),
      ),
  ])

  const totalIncome = Number(incomeRow?.total ?? 0)
  const totalExpenses = Number(expensesRow?.total ?? 0)
  // Tax portion of the month's income — rides the same aggregate, so it
  // costs no extra round trip.
  const taxCollected = Number(incomeRow?.taxCollected ?? 0)

  return {
    month: from.toISOString().slice(0, 7),
    totalIncome,
    totalExpenses,
    net: totalIncome - totalExpenses,
    taxCollected,
  }
}
