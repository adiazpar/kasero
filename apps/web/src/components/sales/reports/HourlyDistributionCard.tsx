'use client'

import { useIntl } from 'react-intl'
import type { HourlyEntry } from '@kasero/shared/types/sales-aggregate'

interface HourlyDistributionCardProps {
  entries: HourlyEntry[]
}

/**
 * 24-bar histogram of revenue by hour-of-day, aggregated across the
 * last 7 days (UTC). The peak hour bar renders in terracotta; all
 * others render in muted cream blocks. Hour labels at 12am / 6am /
 * 12pm / 6pm via a 4-column mono-uppercase axis row below the bars.
 */
export function HourlyDistributionCard({ entries }: HourlyDistributionCardProps) {
  const t = useIntl()

  const max = entries.reduce((m, e) => (e.total > m ? e.total : m), 0)
  const peakIdx = entries.findIndex((e) => e.total === max && max > 0)

  return (
    <section className="report-card">
      <header className="report-card__header">
        <span className="report-card__eyebrow">
          {t.formatMessage({ id: 'sales.reports.hourly_eyebrow' })}
        </span>
        <h3 className="report-card__title">
          {t.formatMessage({ id: 'sales.reports.hourly_title' })}
        </h3>
      </header>
      {max === 0 ? (
        <p className="report-card__empty">
          {t.formatMessage({ id: 'sales.reports.hourly_no_data' })}
        </p>
      ) : (
        <>
          <div className="hourly-row">
            {entries.map((e, idx) => {
              const heightPct = max > 0 && e.total > 0 ? (e.total / max) * 100 : 0
              const isPeak = idx === peakIdx
              return (
                <div
                  key={e.hour}
                  className={`hourly-bar${isPeak ? ' hourly-bar--peak' : ''}`}
                  style={{
                    height: e.total > 0 ? `${heightPct}%` : '3px',
                    // Left-to-right stagger for the mount animation
                    // (hourly-bar-grow in sales-tab.css). CSS-only;
                    // disabled under prefers-reduced-motion.
                    ['--bar-delay' as string]: `${idx * 16}ms`,
                  }}
                  aria-hidden="true"
                />
              )
            })}
          </div>
          <div className="hourly-axis">
            <span className="text-left">
              {t.formatMessage({ id: 'sales.reports.hourly_label_12am' })}
            </span>
            <span className="text-left">
              {t.formatMessage({ id: 'sales.reports.hourly_label_6am' })}
            </span>
            <span className="text-left">
              {t.formatMessage({ id: 'sales.reports.hourly_label_12pm' })}
            </span>
            <span className="text-left">
              {t.formatMessage({ id: 'sales.reports.hourly_label_6pm' })}
            </span>
          </div>
        </>
      )}
    </section>
  )
}
