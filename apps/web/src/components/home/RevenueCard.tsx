'use client'

import { useIntl } from 'react-intl'
import { useMemo } from 'react'
import { useBusiness } from '@/contexts/business-context'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'
import { useCountUp } from '@/hooks/useCountUp'

interface RevenueCardProps {
  isLoading: boolean
  amount: number | null
  vsYesterdayPct: number | null
}

export function RevenueCard({ isLoading, amount, vsYesterdayPct }: RevenueCardProps) {
  const intl = useIntl()
  const { business } = useBusiness()
  const { formatCurrency } = useBusinessFormat()

  // Count-up on the hero number: first load rises from zero, later
  // updates (refresh, realtime) tick from the displayed value. Null
  // while loading so the skeleton owns the empty state.
  const animatedAmount = useCountUp(isLoading ? null : amount)

  // Mono date stamp in the eyebrow row — mirrors the Sales stats card
  // ("TODAY · MAY 12"). Uses the business locale so the calendar
  // convention matches the currency below.
  const dateStamp = useMemo(() => {
    try {
      const fmt = new Intl.DateTimeFormat(business?.locale ?? 'en-US', {
        month: 'short',
        day: 'numeric',
      })
      return fmt.format(new Date()).toUpperCase()
    } catch {
      return ''
    }
  }, [business?.locale])

  return (
    <div className="home-revenue">
      <div className="home-revenue__eyebrow-row">
        <span className="home-revenue__eyebrow">
          {intl.formatMessage({ id: 'home.revenue_label' })}
          {dateStamp ? ` · ${dateStamp}` : ''}
        </span>
        {!isLoading && amount !== null && vsYesterdayPct !== null ? (
          <DeltaChip percent={vsYesterdayPct} />
        ) : null}
      </div>
      {isLoading || animatedAmount === null ? (
        <div className="home-revenue__skeleton" aria-hidden="true" />
      ) : (
        <p className="home-revenue__amount">{formatCurrency(animatedAmount)}</p>
      )}
    </div>
  )
}

function DeltaChip({ percent }: { percent: number }) {
  const intl = useIntl()
  const isUp = percent >= 0
  const display = Math.round(percent).toString()
  return (
    <span className={`home-revenue__delta home-revenue__delta--${isUp ? 'up' : 'down'}`}>
      {intl.formatMessage(
        { id: isUp ? 'home.delta_up' : 'home.delta_down' },
        { percent: display },
      )}
    </span>
  )
}
