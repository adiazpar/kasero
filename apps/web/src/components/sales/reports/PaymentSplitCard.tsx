'use client'

import { useIntl } from 'react-intl'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'
import type { PaymentSplit } from '@kasero/shared/types/sales-aggregate'

interface PaymentSplitCardProps {
  split: PaymentSplit
}

interface Segment {
  key: 'cash' | 'card' | 'other'
  amount: number
  color: string
  i18nKey:
    | 'sales.cart.modal_method_cash'
    | 'sales.cart.modal_method_card'
    | 'sales.cart.modal_method_other'
}

/**
 * Hand-rolled SVG donut + legend. Three concentric arcs drawn via
 * stroke-dasharray on a single rotated <circle> per segment. Legend
 * rows are mono numerals + mono percentages, with a small swatch dot
 * keyed to each segment color.
 */
export function PaymentSplitCard({ split }: PaymentSplitCardProps) {
  const t = useIntl()
  const tMethod = useIntl()
  const { formatCurrency } = useBusinessFormat()

  const total = split.cash + split.card + split.other

  const segments: Segment[] = [
    { key: 'cash', amount: split.cash, color: 'var(--color-success)', i18nKey: 'sales.cart.modal_method_cash' },
    { key: 'card', amount: split.card, color: 'var(--color-brand)', i18nKey: 'sales.cart.modal_method_card' },
    { key: 'other', amount: split.other, color: 'var(--color-text-secondary)', i18nKey: 'sales.cart.modal_method_other' },
  ]

  return (
    <section className="report-card">
      <header className="report-card__header">
        <span className="report-card__eyebrow">
          {t.formatMessage({ id: 'sales.reports.payment_split_eyebrow' })}
        </span>
        <h3 className="report-card__title">
          {t.formatMessage({ id: 'sales.reports.payment_split_title' })}
        </h3>
      </header>
      {total === 0 ? (
        <p className="report-card__empty">
          {t.formatMessage({ id: 'sales.reports.payment_split_no_data' })}
        </p>
      ) : (
        <div className="payment-split-grid">
          <Donut segments={segments} total={total} />
          <div className="payment-split-legend">
            {segments.map((seg) => {
              const pct = total > 0 ? Math.round((seg.amount / total) * 100) : 0
              return (
                <div key={seg.key} className="payment-split-legend-row">
                  <span
                    className="payment-split-legend-dot"
                    style={{ background: seg.color }}
                  />
                  <span className="payment-split-legend-label">
                    {tMethod.formatMessage({ id: seg.i18nKey })}
                  </span>
                  <span className="payment-split-legend-amount">
                    {formatCurrency(seg.amount)}
                  </span>
                  <span className="payment-split-legend-pct">{pct}%</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}

interface DonutProps {
  segments: Segment[]
  total: number
}

/**
 * SVG donut: each segment is a <circle> with stroke-dasharray
 * representing only its arc fraction of the circumference, and a
 * stroke-dashoffset that rotates it to start at the cumulative offset
 * of preceding segments. Center hole achieved via fill="none".
 */
function Donut({ segments, total }: DonutProps) {
  const radius = 38
  const stroke = 12
  const circumference = 2 * Math.PI * radius

  let cumulative = 0
  const arcs = segments.map((seg, i) => {
    const fraction = total > 0 ? seg.amount / total : 0
    const arcLength = fraction * circumference
    const gap = circumference - arcLength
    const arc = (
      <circle
        key={seg.key}
        className="payment-split-arc"
        cx="50"
        cy="50"
        r={radius}
        fill="none"
        stroke={seg.color}
        strokeWidth={stroke}
        strokeDasharray={`${arcLength} ${gap}`}
        strokeDashoffset={-cumulative}
        transform="rotate(-90 50 50)"
        // Feeds the mount sweep (payment-split-sweep in sales-tab.css):
        // dasharray animates 0 -> arc while the offset pins the start
        // angle, staggered per segment. CSS-only; disabled under
        // prefers-reduced-motion.
        style={{
          ['--arc' as string]: `${arcLength}px`,
          ['--gap' as string]: `${gap}px`,
          ['--circ' as string]: `${circumference}px`,
          ['--seg-delay' as string]: `${i * 120}ms`,
        }}
      />
    )
    cumulative += arcLength
    return arc
  })

  return (
    <svg viewBox="0 0 100 100" width="120" height="120" aria-hidden="true">
      {arcs}
    </svg>
  )
}
