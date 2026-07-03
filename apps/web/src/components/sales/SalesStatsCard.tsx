'use client'

import { useIntl } from 'react-intl'
import { useMemo, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { IonButton } from '@ionic/react'
import { useBusiness } from '@/contexts/business-context'
import { useSales } from '@/contexts/sales-context'
import { useSalesSessions } from '@/contexts/sales-sessions-context'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'
import { SessionHistoryModal } from '@/components/sales/SessionHistoryModal'
import { ActiveSessionSalesModal } from '@/components/sales/ActiveSessionSalesModal'

interface SalesStatsCardProps {
  sessionOpen: boolean
  onOpenSession: () => void
  onRequestCloseSession: () => void
}

/**
 * Centerpiece of the Sales surface. Two layouts share one card shell —
 * an italic Fraunces headline, mono uppercase eyebrow + secondary row,
 * and a primary action pill.
 *
 *   Closed: TODAY's revenue as the headline, transactions / avg ticket
 *           / vs-yesterday in a divider-separated mono row, "Open
 *           session" full-width.
 *   Open:   The card grows a 3px terracotta rule along its leading edge.
 *           Headline becomes session revenue. The eyebrow flips to an
 *           italic "Session open · 4 sales" cue. Bottom row pairs a
 *           Receipt icon-button (view session sales) with a "Close
 *           session" pill.
 *
 * The two layouts are stacked and gated by the gridTemplateRows
 * 1fr/0fr collapse trick so the height transitions smoothly when the
 * session flips state.
 */
export function SalesStatsCard({
  sessionOpen,
  onOpenSession,
  onRequestCloseSession,
}: SalesStatsCardProps) {
  const t = useIntl()
  const { stats, sales } = useSales()
  const { currentSession } = useSalesSessions()
  const { formatCurrency } = useBusinessFormat()
  const { business, canManage } = useBusiness()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [sessionSalesOpen, setSessionSalesOpen] = useState(false)

  // Voided sales are excluded from the live session revenue/count — a
  // void is a reversal, not revenue (matches every server-side aggregate).
  const sessionSales = currentSession
    ? sales.filter((s) => s.sessionId === currentSession.id && s.status !== 'voided')
    : []
  const sessionRevenue = sessionSales.reduce((sum, s) => sum + s.total, 0)
  const sessionCount = sessionSales.length

  // Eyebrow date stamp ("TODAY · MAY 9"). Uses the business locale so
  // currency-coupled calendar conventions stay consistent with the
  // numbers below; the rest of the eyebrow string is translated.
  const eyebrowDate = useMemo(() => {
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

  const todayLabel = t.formatMessage({ id: 'sales.stats.today' })

  const noComparison = t.formatMessage({ id: 'sales.stats.no_comparison' })
  const revenueLabel = stats ? formatCurrency(stats.todayRevenue) : noComparison

  const vsValue = stats
    ? stats.vsYesterdayPct === null
      ? noComparison
      : stats.vsYesterdayPct >= 0
        ? t.formatMessage({ id: 'sales.stats.vs_yesterday_up' }, { pct: stats.vsYesterdayPct.toFixed(1) })
        : t.formatMessage({ id: 'sales.stats.vs_yesterday_down' }, { pct: stats.vsYesterdayPct.toFixed(1) })
    : noComparison

  const vsClass =
    !stats || stats.vsYesterdayPct === null
      ? 'sales-stats-metric__value--muted'
      : stats.vsYesterdayPct >= 0
        ? 'sales-stats-metric__value--up'
        : 'sales-stats-metric__value--down'

  return (
    <>
      <div className={`sales-stats-card${sessionOpen ? ' sales-stats-card--open' : ''}`}>
        {/* ===== Closed-state body — collapses to 0fr when sessionOpen ===== */}
        <div
          className="grid transition-[grid-template-rows] duration-300 ease-in-out"
          style={{ gridTemplateRows: sessionOpen ? '0fr' : '1fr' }}
        >
          <div className="overflow-hidden min-h-0">
            <div className="sales-stats-eyebrow-row">
              <span className="sales-stats-eyebrow">
                {todayLabel.toUpperCase()}
                {eyebrowDate ? ` · ${eyebrowDate}` : ''}
              </span>
              <button
                type="button"
                className="sales-stats-link"
                onClick={() => {
                  setHistoryOpen(true)
                }}
              >
                {t.formatMessage({ id: 'sales.stats.view_history_link' })}
                <ArrowRight className="sales-stats-link__arrow" size={12} strokeWidth={2.5} />
              </button>
            </div>

            <p className="sales-stats-headline">{revenueLabel}</p>
            <p className="sales-stats-headline-meta">
              {t.formatMessage({ id: 'sales.stats.today_revenue' })}
            </p>

            {canManage ? (
              <div className="sales-stats-secondary">
                <div className="sales-stats-metric">
                  <span className="sales-stats-metric__label">
                    {t.formatMessage({ id: 'sales.stats.today_count' })}
                  </span>
                  <span className="sales-stats-metric__value">
                    {stats ? stats.todayCount : noComparison}
                  </span>
                </div>
                <div className="sales-stats-metric">
                  <span className="sales-stats-metric__label">
                    {t.formatMessage({ id: 'sales.stats.avg_ticket' })}
                  </span>
                  <span className="sales-stats-metric__value">
                    {stats && stats.todayAvgTicket !== null
                      ? formatCurrency(stats.todayAvgTicket)
                      : noComparison}
                  </span>
                </div>
                <div className="sales-stats-metric">
                  <span className="sales-stats-metric__label">
                    {t.formatMessage({ id: 'sales.stats.vs_yesterday_label' })}
                  </span>
                  <span className={`sales-stats-metric__value ${vsClass}`}>{vsValue}</span>
                </div>
              </div>
            ) : (
              <p className="sales-stats-restricted">
                {t.formatMessage({ id: 'sales.stats.employee_open_notice' })}
              </p>
            )}

            <div className="sales-stats-actions">
              <IonButton
                expand="block"
                disabled={!canManage}
                onClick={() => {
                  onOpenSession()
                }}
              >
                {t.formatMessage({ id: 'sales.action.open_session' })}
              </IonButton>
            </div>
          </div>
        </div>

        {/* ===== Open-state body — collapses to 0fr when session closed ===== */}
        <div
          className="grid transition-[grid-template-rows] duration-300 ease-in-out"
          style={{ gridTemplateRows: sessionOpen ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden min-h-0">
            <div className="sales-stats-eyebrow-row">
              <span className="sales-stats-eyebrow sales-stats-eyebrow--open">
                <em>{t.formatMessage({ id: 'sales.stats.session_open_pulse' })}</em>
                {' · '}
                {t.formatMessage(
                  { id: 'sales.stats.session_sales_count' },
                  { count: sessionCount },
                )}
              </span>
              <button
                type="button"
                className="sales-stats-link"
                onClick={() => {
                  setSessionSalesOpen(true)
                }}
              >
                {t.formatMessage({ id: 'sales.stats.view_sales_link' })}
                <ArrowRight className="sales-stats-link__arrow" size={12} strokeWidth={2.5} />
              </button>
            </div>

            <p className="sales-stats-headline sales-stats-headline--compact">
              {formatCurrency(sessionRevenue)}
            </p>
            <p className="sales-stats-headline-meta">
              {t.formatMessage({ id: 'sales.stats.session_total_meta' })}
            </p>

            <div className="sales-stats-actions">
              <IonButton
                expand="block"
                color="danger"
                disabled={!canManage}
                onClick={() => {
                  onRequestCloseSession()
                }}
              >
                {t.formatMessage({ id: 'sales.action.close_session' })}
              </IonButton>
            </div>
          </div>
        </div>
      </div>

      <SessionHistoryModal isOpen={historyOpen} onClose={() => setHistoryOpen(false)} />
      <ActiveSessionSalesModal
        isOpen={sessionSalesOpen}
        onClose={() => setSessionSalesOpen(false)}
        businessId={business?.id ?? ''}
      />
    </>
  )
}
