'use client'

import { useIntl } from 'react-intl'
import { useEffect, useMemo, useState } from 'react'
import { IonButton, IonSpinner } from '@ionic/react'
import { ModalShell, PriceKeypadStep } from '@/components/ui'
import { LottiePlayerDynamic as LottiePlayer } from '@/components/animations'
import { useSales } from '@/contexts/sales-context'
import { useSalesSessions } from '@/contexts/sales-sessions-context'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'
import { useApiMessage } from '@/hooks/useApiMessage'
import { ApiError } from '@/lib/api-client'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { computeExpectedCash, computeVariance } from '@kasero/shared/sales-helpers'
import { useBusiness } from '@/contexts/business-context'

interface CloseSessionConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  onCloseComplete?: () => void
}

type Step = 0 | 1 | 2

export function CloseSessionConfirmModal({
  isOpen,
  onClose,
  onCloseComplete,
}: CloseSessionConfirmModalProps) {
  const intl = useIntl()
  const { business } = useBusiness()
  const { formatCurrency, formatTime } = useBusinessFormat()
  const sales = useSales()
  const { currentSession, closeSession } = useSalesSessions()
  const translateApiMessage = useApiMessage()

  const [step, setStep] = useState<Step>(0)
  const [countedCashStr, setCountedCashStr] = useState<string>('0')
  const [submitting, setSubmitting] = useState(false)
  const [closed, setClosed] = useState(false)
  const [error, setError] = useState('')

  // Reset state after the modal exit animation completes.
  useEffect(() => {
    if (!isOpen) {
      const t = setTimeout(() => {
        setStep(0)
        setCountedCashStr('0')
        setSubmitting(false)
        setClosed(false)
        setError('')
      }, 250)
      return () => clearTimeout(t)
    }
  }, [isOpen])

  const currency = business?.currency ?? 'USD'

  // Session-scoped stats from cached sales filtered by sessionId.
  // NOT useSales().stats — that's today's UTC totals, not session totals.
  // Voided sales are excluded so this preview matches the server's
  // close-time aggregation (which filters status = 'completed').
  const sessionStats = useMemo(() => {
    if (!currentSession) return null
    const sessionSales = sales.sales.filter(
      (s) => s.sessionId === currentSession.id && s.status !== 'voided',
    )
    const transactions = sessionSales.length
    const totalRevenue = sessionSales.reduce((acc, s) => acc + s.total, 0)
    const avgTicket = transactions > 0 ? totalRevenue / transactions : null
    const cashSales = sessionSales
      .filter((s) => s.paymentMethod === 'cash')
      .reduce((acc, s) => acc + s.total, 0)
    const expected = computeExpectedCash(currentSession.startingCash, cashSales, currency)
    const counted = parseFloat(countedCashStr) || 0
    const variance = computeVariance(counted, expected, currency)
    return { transactions, totalRevenue, avgTicket, cashSales, expected, counted, variance }
  }, [currentSession, sales.sales, countedCashStr, currency])

  const handleNext = async () => {
    // Refetch sales to ensure freshness for the variance reveal.
    await sales.refetch()
    setStep(1)
  }

  const handleConfirm = async () => {
    setError('')
    setSubmitting(true)
    setStep(2)
    try {
      const counted = parseFloat(countedCashStr) || 0
      await closeSession({ countedCash: counted })
      setClosed(true)
      onCloseComplete?.()
    } catch (err) {
      if (err instanceof ApiError && err.messageCode === ApiMessageCode.SESSION_NOT_OPEN) {
        setError(intl.formatMessage({ id: 'sales.session.close_modal.error_not_open' }))
      } else if (err instanceof ApiError && err.envelope) {
        setError(translateApiMessage(err.envelope))
      } else {
        setError(intl.formatMessage({ id: 'common.error' }))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const isSuccess = step === 2 && closed
  const title = isSuccess
    ? undefined
    : intl.formatMessage({ id: 'sales.session.close_modal.title' })

  // ----- Footers (kept identical to behavior contract) -----
  const step0Footer = (
    <IonButton onClick={handleNext} disabled={submitting}>
      {intl.formatMessage({ id: 'sales.session.close_modal.next' })}
    </IonButton>
  )

  const step1Footer = (
    <>
      <IonButton fill="outline" onClick={() => setStep(0)} disabled={submitting}>
        {intl.formatMessage({ id: 'common.back' })}
      </IonButton>
      <IonButton color="danger" onClick={handleConfirm} disabled={submitting} data-haptic>
        {intl.formatMessage({ id: 'sales.session.close_modal.confirm' })}
      </IonButton>
    </>
  )

  const step2Footer = closed ? (
    <IonButton onClick={onClose}>
      {intl.formatMessage({ id: 'common.done' })}
    </IonButton>
  ) : error ? (
    <IonButton fill="outline" onClick={() => setStep(1)}>
      {intl.formatMessage({ id: 'sales.session.close_modal.error_back' })}
    </IonButton>
  ) : null

  const footer = step === 0 ? step0Footer : step === 1 ? step1Footer : step2Footer

  // ----- Variance state for step 1 -----
  const isZeroVariance = sessionStats ? sessionStats.variance === 0 : false
  const heroEyebrowKey = isZeroVariance
    ? 'sales.session.close_modal.variance_zero_label'
    : 'sales.session.close_modal.variance_off_label'
  const heroCaptionKey = isZeroVariance
    ? 'sales.session.close_modal.variance_zero_caption'
    : 'sales.session.close_modal.variance_off_caption'

  // Format the variance with an explicit sign so the hero numeral
  // reads as a delta — "+$0.50" / "-$1.20" / "$0.00".
  const heroVarianceLabel = sessionStats
    ? sessionStats.variance > 0
      ? `+${formatCurrency(sessionStats.variance)}`
      : formatCurrency(sessionStats.variance)
    : ''

  // Session stamp — opening time, locale-formatted. Used in step 1 as
  // a "which session am I closing?" anchor and in step 2 as the
  // closing slip's printed mark.
  const sessionStamp = currentSession
    ? intl.formatMessage(
        { id: 'sales.session.close_modal.session_stamp' },
        { time: formatTime(currentSession.openedAt) },
      )
    : ''

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      chromeless={isSuccess}
      onBack={step === 1 ? () => setStep(0) : undefined}
      footer={footer}
      noSwipeDismiss
      noScroll={step === 0}
    >
      {/* ============ Step 0 — Final count via inline keypad ============ */}
      {step === 0 && (
        <PriceKeypadStep
          value={countedCashStr}
          onValueChange={setCountedCashStr}
          eyebrow={intl.formatMessage({ id: 'sales.session.close_modal.step0_eyebrow' })}
          title={intl.formatMessage(
            { id: 'sales.session.close_modal.step0_title' },
            { em: (chunks) => <em key="em">{chunks}</em> },
          )}
          amountLabel={intl.formatMessage({ id: 'sales.session.close_modal.counted_label' })}
          helper={intl.formatMessage({ id: 'sales.session.close_modal.count_helper' })}
          ariaLabel={intl.formatMessage({ id: 'sales.session.close_modal.counted_label' })}
        />
      )}

      {/* ============ Step 1 — Variance reveal ============ */}
      {step === 1 && sessionStats && (
        <>
          <div
            className={`close-session__hero ${
              isZeroVariance ? 'close-session__hero--zero' : 'close-session__hero--off'
            }`}
          >
            <span className="close-session__hero-eyebrow">
              {intl.formatMessage({ id: heroEyebrowKey })}
            </span>
            <span className="close-session__hero-value">{heroVarianceLabel}</span>
            <span className="close-session__hero-caption">
              {intl.formatMessage({ id: heroCaptionKey })}
            </span>
            {currentSession && (
              <span className="close-session__hero-stamp">{sessionStamp}</span>
            )}
          </div>

          <div className="close-session__ledger">
            <section className="close-session__ledger-section">
              <div className="close-session__ledger-heading">
                {intl.formatMessage({ id: 'sales.session.close_modal.summary_heading' })}
              </div>

              <LedgerRow
                label={intl.formatMessage({
                  id: 'sales.session.close_modal.transactions_label',
                })}
                value={sessionStats.transactions.toString()}
              />
              <LedgerRow
                label={intl.formatMessage({
                  id: 'sales.session.close_modal.revenue_label',
                })}
                value={formatCurrency(sessionStats.totalRevenue)}
                strong
              />
              <LedgerRow
                label={intl.formatMessage({
                  id: 'sales.session.close_modal.avg_ticket_label',
                })}
                value={
                  sessionStats.avgTicket !== null
                    ? formatCurrency(sessionStats.avgTicket)
                    : '—'
                }
                muted={sessionStats.avgTicket === null}
              />
            </section>

            <section className="close-session__ledger-section">
              <div className="close-session__ledger-heading">
                {intl.formatMessage({ id: 'sales.session.close_modal.recon_heading' })}
              </div>

              <LedgerRow
                label={intl.formatMessage({
                  id: 'sales.session.close_modal.starting_cash',
                })}
                value={formatCurrency(currentSession?.startingCash ?? 0)}
              />
              <LedgerRow
                label={intl.formatMessage({
                  id: 'sales.session.close_modal.cash_sales',
                })}
                value={formatCurrency(sessionStats.cashSales)}
              />
              <LedgerRow
                label={intl.formatMessage({
                  id: 'sales.session.close_modal.expected',
                })}
                value={formatCurrency(sessionStats.expected)}
                strong
              />
              <LedgerRow
                label={intl.formatMessage({
                  id: 'sales.session.close_modal.counted',
                })}
                value={formatCurrency(sessionStats.counted)}
              />

              {/* Variance row — chipped, color-coded, no leader. */}
              <div className="close-session__ledger-row close-session__ledger-row--variance">
                <span className="close-session__ledger-label">
                  {intl.formatMessage({ id: 'sales.session.close_modal.variance' })}
                </span>
                <span className="close-session__ledger-leader" aria-hidden />
                <span
                  className={`close-session__variance-chip ${
                    isZeroVariance
                      ? 'close-session__variance-chip--zero'
                      : 'close-session__variance-chip--off'
                  }`}
                >
                  {heroVarianceLabel}
                </span>
              </div>
            </section>
          </div>
        </>
      )}

      {/* ============ Step 2 — Closed / loading / error ============ */}
      {step === 2 && (
        <div className="close-session__resolution">
          <div className="close-session__lottie-frame">
            {closed ? (
              <LottiePlayer
                src="/animations/success.json"
                loop={false}
                autoplay={true}
                delay={300}
                style={{ width: 160, height: 160 }}
              />
            ) : error ? null : (
              <div className="close-session__spinner-frame">
                <IonSpinner name="crescent" />
              </div>
            )}
          </div>

          {closed && (
            <>
              <p className="close-session__success-title">
                {intl.formatMessage({
                  id: 'sales.session.close_modal.success_heading',
                })}
              </p>
              <span className="close-session__success-stamp">
                {intl.formatMessage({
                  id: 'sales.session.close_modal.success_stamp',
                })}
              </span>
            </>
          )}

          {!closed && error && <p className="close-session__error">{error}</p>}
        </div>
      )}
    </ModalShell>
  )
}

/** A single label/value row in the ledger. The dotted leader between
 *  label and value is the printed-receipt affordance — `aria-hidden`
 *  so screen readers don't announce it. */
function LedgerRow({
  label,
  value,
  strong,
  muted,
}: {
  label: string
  value: string
  strong?: boolean
  muted?: boolean
}) {
  return (
    <div className="close-session__ledger-row">
      <span className="close-session__ledger-label">{label}</span>
      <span className="close-session__ledger-leader" aria-hidden />
      <span
        className={`close-session__ledger-value${
          strong ? ' close-session__ledger-value--strong' : ''
        }${muted ? ' close-session__ledger-value--muted' : ''}`}
      >
        {value}
      </span>
    </div>
  )
}
