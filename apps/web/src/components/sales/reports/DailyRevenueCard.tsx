'use client'

import { useEffect, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import type { DailyRevenueEntry } from '@kasero/shared/types/sales-aggregate'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'

interface DailyRevenueCardProps {
  entries: DailyRevenueEntry[]
}

/**
 * 7-day revenue bar chart. Today is the last entry and renders in
 * the brand terracotta at full opacity; prior days render in the
 * brand tint at reduced opacity. Days with total = 0 still show a
 * 2px hairline so the time axis stays legible. A static y-axis on
 * the right edge (MAX / AVG / 0) gives users vertical reference
 * without burning per-column width on currency labels.
 *
 * Tapping a column reveals a small tooltip with the day label and the
 * exact currency value for that day. Tap outside (or Escape) dismisses;
 * tapping another column switches. The tap target is the full column
 * (not just the ~32px bar) so we keep at least a 40px hit area.
 */
export function DailyRevenueCard({ entries }: DailyRevenueCardProps) {
  const t = useIntl()
  const { formatCurrency } = useBusinessFormat()
  // Day-of-week label is LANGUAGE, not formatting — use the user's UI
  // locale so an English UI doesn't show "Lun/Mar/Mié" for a Spanish-
  // locale business.
  const userLocale = t.locale

  const max = entries.reduce((m, e) => (e.total > m ? e.total : m), 0)

  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const rowRef = useRef<HTMLDivElement | null>(null)

  // Dismiss on tap-outside (Stripe/Monzo behavior) and on Escape.
  // Listener is only attached while a tooltip is open so we never pay
  // for it during normal browsing.
  useEffect(() => {
    if (activeIdx === null) return
    const onPointer = (e: PointerEvent) => {
      const root = rowRef.current
      if (root && !root.contains(e.target as Node)) {
        setActiveIdx(null)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveIdx(null)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [activeIdx])

  const tooltipDayFmt = new Intl.DateTimeFormat(userLocale, {
    weekday: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })

  return (
    <section className="report-card">
      <header className="report-card__header">
        <span className="report-card__eyebrow">
          {t.formatMessage({ id: 'sales.reports.daily_revenue_eyebrow' })}
        </span>
        <h3 className="report-card__title">
          {t.formatMessage({ id: 'sales.reports.daily_revenue_title' })}
        </h3>
      </header>
      <div className="daily-revenue-chart">
        <div className="daily-revenue-row" ref={rowRef}>
          {entries.map((entry, idx) => {
            const isCurrent = idx === entries.length - 1
            const isActive = idx === activeIdx
            const heightPct =
              max > 0 && entry.total > 0 ? (entry.total / max) * 100 : 0
            const date = new Date(entry.date + 'T00:00:00Z')
            const dayLabel = new Intl.DateTimeFormat(userLocale, {
              weekday: 'short',
              timeZone: 'UTC',
            }).format(date)
            const tooltipLabel = tooltipDayFmt.format(date)
            return (
              <button
                key={entry.date}
                type="button"
                className={`daily-revenue-col${
                  isActive ? ' daily-revenue-col--active' : ''
                }`}
                aria-label={t.formatMessage(
                  { id: 'sales.reports.daily_revenue_tooltip_label' },
                  { day: tooltipLabel, amount: formatCurrency(entry.total) },
                )}
                aria-expanded={isActive}
                onClick={() => setActiveIdx((prev) => (prev === idx ? null : idx))}
              >
                <div className="daily-revenue-col__bar-track">
                  <div
                    className={`daily-revenue-col__bar${
                      isCurrent ? ' daily-revenue-col__bar--current' : ''
                    }`}
                    style={{ height: `${heightPct}%` }}
                  />
                  {isActive ? (
                    <div className="daily-revenue-tooltip" role="tooltip">
                      <span className="daily-revenue-tooltip__day">
                        {tooltipLabel}
                      </span>
                      <span className="daily-revenue-tooltip__value">
                        {formatCurrency(entry.total)}
                      </span>
                    </div>
                  ) : null}
                </div>
                <span
                  className={`daily-revenue-col__day${
                    isCurrent ? ' daily-revenue-col__day--current' : ''
                  }`}
                >
                  {dayLabel}
                </span>
              </button>
            )
          })}
        </div>
        <div
          className="daily-revenue-axis"
          aria-hidden="true"
        >
          <span className="daily-revenue-axis__tick">
            {t.formatMessage({ id: 'sales.reports.daily_revenue_axis_max' })}
          </span>
          <span className="daily-revenue-axis__tick">
            {t.formatMessage({ id: 'sales.reports.daily_revenue_axis_avg' })}
          </span>
          <span className="daily-revenue-axis__tick">
            {t.formatMessage({ id: 'sales.reports.daily_revenue_axis_zero' })}
          </span>
        </div>
      </div>
    </section>
  )
}
