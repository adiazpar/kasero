'use client'

import { useIntl } from 'react-intl'
import { useIonRouter } from '@ionic/react'
import { useBusiness } from '@/contexts/business-context'
import { useExpensesSummary } from '@/hooks/useExpensesSummary'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'
import { useFeatureFlag } from '@/lib/feature-flags'

/**
 * Displays a "This month" summary: income, expenses, and net.
 * Income and expenses are tappable and deep-link to the Ledger tab
 * on the corresponding sub-tab via `?tab=sales` / `?tab=expenses`.
 * Net is informational only.
 *
 * Hidden entirely when the `expenses_v1` feature flag is off, or while
 * the summary is loading / null (no zero flash).
 */
export function MonthlySummaryCard() {
  const intl = useIntl()
  const { businessId } = useBusiness()
  const expensesEnabled = useFeatureFlag('expenses_v1')
  const { summary } = useExpensesSummary(businessId ?? '')
  const { formatCurrency } = useBusinessFormat()
  const ionRouter = useIonRouter()

  if (!expensesEnabled || !summary || !businessId) return null

  const net = summary.net
  const netIsPositive = net >= 0

  const pushLedger = (tab: 'sales' | 'expenses') => {
    ionRouter.push(`/${businessId}/sales?tab=${tab}`, 'none', 'replace')
  }

  return (
    <div className="home-monthly">
      <p className="home-monthly__title">
        {intl.formatMessage({ id: 'home.monthly_summary_title' })}
      </p>
      <div className="home-monthly__columns">
        <button
          type="button"
          className="home-monthly__col home-monthly__col--tappable"
          onClick={() => pushLedger('sales')}
        >
          <span className="home-monthly__col-label">
            {intl.formatMessage({ id: 'home.monthly_summary_income' })}
          </span>
          <span className="home-monthly__col-value home-monthly__col-value--income">
            {formatCurrency(summary.totalIncome)}
          </span>
        </button>

        <button
          type="button"
          className="home-monthly__col home-monthly__col--tappable"
          onClick={() => pushLedger('expenses')}
        >
          <span className="home-monthly__col-label">
            {intl.formatMessage({ id: 'home.monthly_summary_expenses' })}
          </span>
          <span className="home-monthly__col-value home-monthly__col-value--expenses">
            {formatCurrency(summary.totalExpenses)}
          </span>
        </button>

        <div className="home-monthly__col">
          <span className="home-monthly__col-label">
            {intl.formatMessage({ id: 'home.monthly_summary_net' })}
          </span>
          <span
            className={`home-monthly__col-value home-monthly__col-value--net${
              netIsPositive
                ? ' home-monthly__col-value--positive'
                : ' home-monthly__col-value--negative'
            }`}
          >
            {formatCurrency(net)}
          </span>
        </div>
      </div>
    </div>
  )
}
