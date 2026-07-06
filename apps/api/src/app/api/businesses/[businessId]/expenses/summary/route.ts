import { withBusinessAuth, successResponse } from '@/lib/api-middleware'
import { queryMonthlySummary } from './summary-query'

/**
 * GET /api/businesses/[businessId]/expenses/summary
 *
 * Returns the current-month income (sum of sales.total), expenses (sum of
 * expenses.amount), and net for the requesting business.
 *
 * Optional query param: ?month=YYYY-MM-DD — uses that date's calendar month
 * (UTC) for historical lookback. Defaults to the current month.
 *
 * The aggregate itself lives in ./summary-query.ts so the Pulse digest
 * route can reuse it.
 */
export const GET = withBusinessAuth(async (request, access) => {
  const url = new URL(request.url)
  const monthParam = url.searchParams.get('month')
  const anchor = monthParam ? new Date(monthParam) : new Date()

  const data = await queryMonthlySummary(access.businessId, anchor)

  return successResponse({ data })
})
