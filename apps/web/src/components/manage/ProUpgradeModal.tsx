'use client'

import { useIntl } from 'react-intl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { IonButton, IonInput, IonSpinner } from '@ionic/react'
import { Camera, Sparkles, ReceiptText, Store } from 'lucide-react'
import { ModalShell } from '@/components/ui/modal-shell'
import { LottiePlayerDynamic as LottiePlayer } from '@/components/animations'
import { useBusiness } from '@/contexts/business-context'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'
import { useSubscription } from '@/hooks/useSubscription'
import { getBillingAdapter } from '@/lib/billing'
import { PRO_PRICING, AI_DAILY_QUOTA, isPro as computeIsPro } from '@kasero/shared/entitlements'

interface Props { isOpen: boolean; onClose: () => void }

type Step = 'form' | 'redeem-success'

/**
 * Kasero Pro modal (Manage tab). One surface, two states:
 *   - Free (or expired pro): pillar pitch + store purchase button
 *     ("coming to the stores" while the billing adapter is a stub) +
 *     owner-only promo-code redemption (works end to end today).
 *   - Active Pro: management state — source + expiry.
 * Structure clones EditTaxModal: step enum in the consumer, open-time
 * reset gated on the close-to-open transition, mutation awaited before
 * advancing to the chromeless success step.
 */
export function ProUpgradeModal({ isOpen, onClose }: Props) {
  const intl = useIntl()
  const { businessId, isOwner } = useBusiness()
  const { formatDate } = useBusinessFormat()

  // Reference prices are USD by definition (PRO_PRICING.monthlyUsd) —
  // never format them with the business currency symbol, or a PEN
  // business would read "S/ 7.99" as 7.99 soles. Use the viewer's UI
  // locale for digit/separator conventions with an explicit USD unit;
  // the store sets the real localized price.
  const formatUsd = (value: number) =>
    new Intl.NumberFormat(intl.locale, {
      style: 'currency',
      currency: 'USD',
      currencyDisplay: 'narrowSymbol',
    }).format(value)
  const {
    subscription,
    redeem,
    isRedeeming,
    redeemError,
    resetRedeemError,
  } = useSubscription(businessId)

  const [step, setStep] = useState<Step>('form')
  const [redeemed, setRedeemed] = useState(false)
  const [code, setCode] = useState('')

  // The billing adapter is environment-static (native vs web), so one
  // resolution per mount is enough.
  const billing = useMemo(() => getBillingAdapter(), [])

  const proActive = subscription
    ? computeIsPro(subscription.plan, subscription.expiresAt)
    : false

  // Open-time reset gated on the close-to-open transition — see
  // EditTaxModal for the rationale (a background subscription refresh
  // mid-redeem must not bounce the step back to 'form').
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setStep('form')
      setRedeemed(false)
      setCode('')
      resetRedeemError()
    }
    wasOpenRef.current = isOpen
  }, [isOpen, resetRedeemError])

  // Cleanup runs in onClose, which ModalShell wires to onDidDismiss —
  // after the close animation, so no mid-animation content flash.
  const handleModalClose = () => {
    onClose()
    setStep('form')
    setRedeemed(false)
    setCode('')
    resetRedeemError()
  }

  const handleRedeem = async () => {
    const trimmed = code.trim()
    if (!trimmed || isRedeeming) return
    // Await the mutation; advance only on success so errors surface
    // inline on the form (modal rule 4).
    const ok = await redeem(trimmed)
    if (ok) {
      setRedeemed(true)
      setStep('redeem-success')
    }
  }

  const titleNode = useMemo(() => {
    const full = intl.formatMessage({ id: 'manage.pro_hero_title' })
    const emphasis = intl.formatMessage({ id: 'manage.pro_hero_title_emphasis' })
    const idx = full.indexOf(emphasis)
    if (!emphasis || idx === -1) return full
    return (
      <>
        {full.slice(0, idx)}
        <em>{emphasis}</em>
        {full.slice(idx + emphasis.length)}
      </>
    )
  }, [intl])

  const pillars = [
    {
      icon: <Camera aria-hidden="true" />,
      title: intl.formatMessage({ id: 'manage.pro_pillar_ai_title' }),
      desc: intl.formatMessage(
        { id: 'manage.pro_pillar_ai_desc' },
        { pro: AI_DAILY_QUOTA.pro, free: AI_DAILY_QUOTA.free },
      ),
    },
    {
      icon: <Sparkles aria-hidden="true" />,
      title: intl.formatMessage({ id: 'manage.pro_pillar_pulse_title' }),
      desc: intl.formatMessage({ id: 'manage.pro_pillar_pulse_desc' }),
    },
    {
      icon: <ReceiptText aria-hidden="true" />,
      title: intl.formatMessage({ id: 'manage.pro_pillar_receipt_title' }),
      desc: intl.formatMessage({ id: 'manage.pro_pillar_receipt_desc' }),
    },
    {
      icon: <Store aria-hidden="true" />,
      title: intl.formatMessage({ id: 'manage.pro_pillar_locations_title' }),
      desc: intl.formatMessage({ id: 'manage.pro_pillar_locations_desc' }),
    },
  ]

  // Enum -> label maps built at the call site (identifiers are never
  // rendered raw). "Kasero Pro" itself is a product name and stays
  // untranslated inside every locale's value.
  const sourceLabels: Record<'none' | 'apple' | 'google' | 'promo', string> = {
    none: intl.formatMessage({ id: 'manage.pro_source_none' }),
    apple: intl.formatMessage({ id: 'manage.pro_source_apple' }),
    google: intl.formatMessage({ id: 'manage.pro_source_google' }),
    promo: intl.formatMessage({ id: 'manage.pro_source_promo' }),
  }

  const title = intl.formatMessage({ id: 'manage.pro_title' })

  const footer =
    step === 'form' ? (
      proActive ? (
        <IonButton expand="block" onClick={onClose} className="flex-1">
          {intl.formatMessage({ id: 'common.done' })}
        </IonButton>
      ) : (
        // Store purchase entry point. Both adapter branches are
        // unavailable today (store products pending / web unsupported),
        // so this renders as a disabled "coming to the stores" state.
        <IonButton expand="block" disabled className="flex-1">
          {billing.available
            ? intl.formatMessage({ id: 'manage.pro_purchase_button' })
            : intl.formatMessage({ id: 'manage.pro_store_coming' })}
        </IonButton>
      )
    ) : (
      <IonButton expand="block" onClick={onClose} className="flex-1">
        {intl.formatMessage({ id: 'common.done' })}
      </IonButton>
    )

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={handleModalClose}
      title={title}
      chromeless={step === 'redeem-success'}
      footer={footer}
      noSwipeDismiss
    >
      {step === 'form' && (
        <>
          <header className="modal-hero">
            <div className="modal-hero__eyebrow">
              {intl.formatMessage({ id: 'manage.pro_eyebrow' })}
            </div>
            <h1 className="modal-hero__title">{titleNode}</h1>
            <p className="modal-hero__subtitle">
              {proActive
                ? intl.formatMessage({ id: 'manage.pro_hero_subtitle_active' })
                : intl.formatMessage({ id: 'manage.pro_hero_subtitle' })}
            </p>
          </header>

          {proActive && subscription && (
            <div className="pro-status">
              <span className="pro-status__badge">
                {intl.formatMessage({ id: 'manage.pro_status_active' })}
              </span>
              <span className="pro-status__row">
                <span className="pro-status__label">
                  {intl.formatMessage({ id: 'manage.pro_status_source_label' })}
                </span>
                <span className="pro-status__value">
                  {sourceLabels[subscription.source]}
                </span>
              </span>
              <span className="pro-status__row">
                <span className="pro-status__label">
                  {intl.formatMessage({ id: 'manage.pro_status_expiry_label' })}
                </span>
                <span className="pro-status__value">
                  {subscription.expiresAt
                    ? formatDate(new Date(subscription.expiresAt))
                    : intl.formatMessage({ id: 'manage.pro_status_no_expiry' })}
                </span>
              </span>
            </div>
          )}

          <ul className="pro-pillars">
            {pillars.map((pillar) => (
              <li key={pillar.title} className="pro-pillar">
                <span className="pro-pillar__icon">{pillar.icon}</span>
                <span className="pro-pillar__body">
                  <span className="pro-pillar__title">{pillar.title}</span>
                  <span className="pro-pillar__desc">{pillar.desc}</span>
                </span>
              </li>
            ))}
          </ul>

          {!proActive && (
            <p className="pro-price">
              {intl.formatMessage(
                { id: 'manage.pro_price_line' },
                {
                  monthly: formatUsd(PRO_PRICING.monthlyUsd),
                  annual: formatUsd(PRO_PRICING.annualUsd),
                },
              )}
              <span className="pro-price__note">
                {intl.formatMessage({ id: 'manage.pro_price_note' })}
              </span>
            </p>
          )}

          {isOwner && (
            <div className="pro-promo">
              <div className="manage-edit__note">
                {proActive
                  ? intl.formatMessage({ id: 'manage.pro_promo_label_extend' })
                  : intl.formatMessage({ id: 'manage.pro_promo_label' })}
              </div>
              <div className="pro-promo__row">
                <IonInput
                  className="pro-promo__input"
                  value={code}
                  placeholder={intl.formatMessage({ id: 'manage.pro_promo_placeholder' })}
                  autocapitalize="characters"
                  autocorrect="off"
                  spellcheck={false}
                  maxlength={64}
                  aria-label={intl.formatMessage({ id: 'manage.pro_promo_label' })}
                  onIonInput={(e) => {
                    setCode(e.detail.value ?? '')
                    if (redeemError) resetRedeemError()
                  }}
                />
                <IonButton
                  className="pro-promo__button"
                  onClick={handleRedeem}
                  disabled={isRedeeming || code.trim().length === 0}
                >
                  {isRedeeming ? (
                    <IonSpinner name="crescent" />
                  ) : (
                    intl.formatMessage({ id: 'manage.pro_promo_redeem' })
                  )}
                </IonButton>
              </div>
              {redeemError && (
                <p className="pro-promo__error" role="alert">
                  {redeemError}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {step === 'redeem-success' && (
        <div className="manage-seal" aria-hidden={!redeemed}>
          <div className="manage-seal__lottie">
            {redeemed && (
              <LottiePlayer
                src="/animations/success.json"
                loop={false}
                autoplay={true}
                delay={300}
                style={{ width: 144, height: 144 }}
              />
            )}
          </div>

          <span className="manage-seal__stamp">
            {intl.formatMessage({ id: 'manage.pro_redeem_success_stamp' })}
          </span>

          <h2 className="manage-seal__title">
            {intl.formatMessage(
              { id: 'manage.pro_redeem_success_title' },
              { em: (chunks) => <em key="em">{chunks}</em> },
            )}
          </h2>

          <p className="manage-seal__subtitle">
            {subscription?.expiresAt
              ? intl.formatMessage(
                  { id: 'manage.pro_redeem_success_subtitle' },
                  { date: formatDate(new Date(subscription.expiresAt)) },
                )
              : intl.formatMessage({ id: 'manage.pro_redeem_success_subtitle_no_expiry' })}
          </p>
        </div>
      )}
    </ModalShell>
  )
}
