'use client'

import { useIntl } from 'react-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
import { IonSpinner } from '@ionic/react'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'
import { apiRequest } from '@/lib/api-client'
import { registerRefetch } from '@/lib/realtime/refetch-registry'

export interface SaleProjection {
  id: string
  saleNumber: number
  total: number
  paymentMethod: 'cash' | 'card' | 'other'
  createdAt: string
}

interface SessionSalesListProps {
  businessId: string
  /** Session id to fetch sales for. Null/empty → renders nothing
   *  (defensive — caller should gate on the active step). */
  sessionId: string | null
  /** Tap handler for an individual sale row. The caller is responsible
   *  for both setting their selectedSaleId state AND navigating the
   *  modal step. */
  onSaleTap: (saleId: string) => void
}

/**
 * Content-only step component for the per-session sales list. Fetches
 * /api/businesses/[businessId]/sales-sessions/[sessionId]/sales when
 * the sessionId changes.
 *
 * Shared between ActiveSessionSalesModal (current session) and
 * SessionHistoryModal (historic session drill-down).
 */
export function SessionSalesList({
  businessId,
  sessionId,
  onSaleTap,
}: SessionSalesListProps) {
  const t = useIntl()
  const { formatCurrency, formatTime } = useBusinessFormat()

  const [items, setItems] = useState<SaleProjection[]>([])
  const [loading, setLoading] = useState(false)

  // Latest sessionId in a ref so the refetch callback registered with
  // the realtime layer sees the current session without re-registering
  // on every render.
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId

  const refetch = useCallback(async () => {
    const sid = sessionIdRef.current
    if (!sid) {
      setItems([])
      return
    }
    setLoading(true)
    try {
      const { sales } = await apiRequest<{ sales: SaleProjection[] }>(
        `/api/businesses/${businessId}/sales-sessions/${sid}/sales?limit=50`,
      )
      setItems(sales)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [businessId])

  // Initial load + refetch when sessionId changes.
  useEffect(() => {
    if (!sessionId) {
      setItems([])
      return
    }
    void refetch()
  }, [sessionId, refetch])

  // Subscribe to the realtime 'sales' refetch key so a sale rung up on
  // another device while this view is open refreshes the list without
  // requiring the user to close and reopen the modal. The main
  // sales-context already owns 'sales' for its own list view; multiple
  // registrants under the same key all fire on every realtime sale
  // event.
  useEffect(() => registerRefetch('sales', refetch), [refetch])

  if (loading) {
    return (
      <div className="modal-step-item">
        <div className="session-sales-loading">
          <IonSpinner name="crescent" style={{ '--color': 'var(--color-brand)' } as React.CSSProperties} />
          <span className="session-sales-loading__caption">
            {t.formatMessage({ id: 'sales.session.list_loading' })}
          </span>
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="session-sales-empty">
        <span className="session-sales-empty__rule" />
        <p className="session-sales-empty__title">
          {t.formatMessage({ id: 'sales.session.list_empty_title' })}
        </p>
        <p className="session-sales-empty__desc">
          {t.formatMessage({ id: 'sales.session.active_sales_modal.empty' })}
        </p>
      </div>
    )
  }

  return (
    <div className="modal-step-item">
      <div className="session-sales-eyebrow">
        <span>
          {t.formatMessage({ id: 'sales.session.list_eyebrow' })}
        </span>
        <span className="session-sales-eyebrow__count">
          {t.formatMessage(
            { id: 'sales.session.list_count' },
            { count: items.length },
          )}
        </span>
      </div>
      <div className="session-sales-list">
        {items.map((s) => {
          const methodKey = `sales.cart.modal_method_${s.paymentMethod}` as const
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                onSaleTap(s.id)
              }}
              className="session-sales-row"
            >
              <div className="session-sales-row__lead">
                <span className="session-sales-row__stamp">
                  {t.formatMessage(
                    { id: 'sales.session.sale_stamp' },
                    { number: s.saleNumber },
                  )}
                </span>
                <span className="session-sales-row__meta">
                  <span className="session-sales-row__time">
                    {formatTime(new Date(s.createdAt))}
                  </span>
                  <span
                    className={`session-sales-row__dot session-sales-row__dot--${s.paymentMethod}`}
                    aria-hidden="true"
                  />
                  <span className="session-sales-row__method">
                    {t.formatMessage({ id: methodKey })}
                  </span>
                </span>
              </div>
              <span className="session-sales-row__total">
                {formatCurrency(s.total)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
