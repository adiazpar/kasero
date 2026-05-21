'use client'

import { useIntl } from 'react-intl'

import { useExpensesSummary } from '@/hooks/useExpensesSummary'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'

interface ExpenseTotalsStripProps {
  businessId: string
}

// Displays "This month: $X" from the expenses summary. Returns null
// while loading or when the summary has not yet resolved.
export function ExpenseTotalsStrip({ businessId }: ExpenseTotalsStripProps) {
  const t = useIntl()
  const { summary, loading } = useExpensesSummary(businessId)
  const { formatCurrency } = useBusinessFormat()

  if (loading || summary === null) return null

  return (
    <div className="expenses-totals-strip">
      {t.formatMessage(
        { id: 'expenses.totals_strip_month' },
        { amount: formatCurrency(summary.totalExpenses) }
      )}
    </div>
  )
}
