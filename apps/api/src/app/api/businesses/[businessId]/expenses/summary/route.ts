import { db, expenses, sales } from '@/db'
import { and, eq, gte, lt, sum } from 'drizzle-orm'
import { withBusinessAuth, successResponse } from '@/lib/api-middleware'

/*
 * Voided sales are excluded from income (a void is a reversal, not
 * revenue). The status predicate is a residual filter on rows already
 * narrowed by idx_sales_business_date — no new index needed.
 */

function startOfMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

function startOfNextMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
}

/**
 * GET /api/businesses/[businessId]/expenses/summary
 *
 * Returns the current-month income (sum of sales.total), expenses (sum of
 * expenses.amount), and net for the requesting business.
 *
 * Optional query param: ?month=YYYY-MM-DD — uses that date's calendar month
 * (UTC) for historical lookback. Defaults to the current month.
 */
export const GET = withBusinessAuth(async (request, access) => {
  const url = new URL(request.url)
  const monthParam = url.searchParams.get('month')
  const anchor = monthParam ? new Date(monthParam) : new Date()
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
          eq(sales.businessId, access.businessId),
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
          eq(expenses.businessId, access.businessId),
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

  return successResponse({
    data: {
      month: from.toISOString().slice(0, 7),
      totalIncome,
      totalExpenses,
      net: totalIncome - totalExpenses,
      taxCollected,
    },
  })
})
