'use client'

import { useIntl } from 'react-intl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { IonButton, IonSpinner } from '@ionic/react'
import { ModalShell } from '@/components/ui/modal-shell'
import { LottiePlayerDynamic as LottiePlayer } from '@/components/animations'
import { useBusiness } from '@/contexts/business-context'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'
import { useUpdateBusiness } from '@/hooks/useUpdateBusiness'
import { sanitizeDecimalInput } from '@/lib/locale-number'
import type { TaxMode } from '@kasero/shared/types/sale'

interface Props { isOpen: boolean; onClose: () => void }

type Step = 'form' | 'save-success'

const TAX_MODES: TaxMode[] = ['none', 'inclusive', 'exclusive']

/**
 * Owner-only tax settings modal (Manage tab). Mode selector (none /
 * inclusive / exclusive) plus a percent rate input revealed for the two
 * taxed modes. Existing sales keep their commit-time tax snapshot — a
 * settings change only affects future checkouts.
 */
export function EditTaxModal({ isOpen, onClose }: Props) {
  const intl = useIntl()
  const { business } = useBusiness()
  const { locale } = useBusinessFormat()
  const { update, isSubmitting, error, reset } = useUpdateBusiness()
  const [step, setStep] = useState<Step>('form')
  const [saved, setSaved] = useState(false)
  const [mode, setMode] = useState<TaxMode>(business?.taxMode ?? 'none')
  const [rateStr, setRateStr] = useState(
    business && business.taxRate > 0 ? String(business.taxRate) : '',
  )

  // Open-time reset gated on close→open transition — see EditLocationModal
  // for the rationale (refreshBusiness mid-save must not bounce the step).
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setStep('form')
      setSaved(false)
      setMode(business?.taxMode ?? 'none')
      setRateStr(business && business.taxRate > 0 ? String(business.taxRate) : '')
    }
    wasOpenRef.current = isOpen
  }, [isOpen, business])

  // State reset runs in the modal's onClose (below), which ModalShell wires
  // to onDidDismiss — it fires AFTER the close animation, so there is no
  // mid-animation flash and no hand-rolled setTimeout (per the modal rules).
  const handleModalClose = () => {
    onClose()
    setSaved(false)
    setStep('form')
    reset()
  }

  const parsedRate = parseFloat(rateStr) || 0
  const rateInvalid = mode !== 'none' && (parsedRate <= 0 || parsedRate > 100)
  const effectiveRate = mode === 'none' ? 0 : parsedRate
  const isChanged =
    mode !== (business?.taxMode ?? 'none') ||
    effectiveRate !== (business?.taxRate ?? 0)

  const handleSave = async () => {
    if (!isChanged) { onClose(); return }
    const ok = await update({ taxMode: mode, taxRate: effectiveRate })
    if (ok) {
      setSaved(true)
      setStep('save-success')
    }
  }

  const titleNode = useMemo(() => {
    const full = intl.formatMessage({ id: 'manage.edit_tax_hero_title' })
    const emphasis = intl.formatMessage({ id: 'manage.edit_tax_hero_title_emphasis' })
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

  const modeLabels: Record<TaxMode, string> = {
    none: intl.formatMessage({ id: 'manage.edit_tax_mode_none' }),
    inclusive: intl.formatMessage({ id: 'manage.edit_tax_mode_inclusive' }),
    exclusive: intl.formatMessage({ id: 'manage.edit_tax_mode_exclusive' }),
  }
  const modeDescriptions: Record<TaxMode, string> = {
    none: intl.formatMessage({ id: 'manage.edit_tax_mode_none_desc' }),
    inclusive: intl.formatMessage({ id: 'manage.edit_tax_mode_inclusive_desc' }),
    exclusive: intl.formatMessage({ id: 'manage.edit_tax_mode_exclusive_desc' }),
  }

  const title = intl.formatMessage({ id: 'manage.edit_tax_title' })

  const footer = step === 'form' ? (
    <IonButton
      expand="block"
      onClick={handleSave}
      disabled={isSubmitting || !isChanged || rateInvalid}
      className="flex-1"
    >
      {isSubmitting ? <IonSpinner name="crescent" /> : intl.formatMessage({ id: 'manage.save' })}
    </IonButton>
  ) : (
    <IonButton
      expand="block"
      onClick={onClose}
      className="flex-1"
    >
      {intl.formatMessage({ id: 'common.done' })}
    </IonButton>
  )

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={handleModalClose}
      title={title}
      chromeless={step === 'save-success'}
      footer={footer}
      noSwipeDismiss
    >
      {step === 'form' && (
        <>
          {error && <div className="modal-error">{error}</div>}

          <header className="modal-hero">
            <div className="modal-hero__eyebrow">
              {intl.formatMessage({ id: 'manage.edit_tax_eyebrow' })}
            </div>
            <h1 className="modal-hero__title">{titleNode}</h1>
            <p className="modal-hero__subtitle">
              {intl.formatMessage({ id: 'manage.edit_tax_hero_subtitle' })}
            </p>
          </header>

          <div className="edit-tax__modes" role="radiogroup" aria-label={title}>
            {TAX_MODES.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                className={`edit-tax__mode${mode === m ? ' edit-tax__mode--active' : ''}`}
                onClick={() => setMode(m)}
              >
                <span className="edit-tax__mode-label">{modeLabels[m]}</span>
                <span className="edit-tax__mode-desc">{modeDescriptions[m]}</span>
              </button>
            ))}
          </div>

          {mode !== 'none' && (
            <div className="edit-tax__rate">
              <label className="edit-tax__rate-label" htmlFor="edit-tax-rate">
                {intl.formatMessage({ id: 'manage.edit_tax_rate_label' })}
              </label>
              <div className="edit-tax__rate-field">
                <input
                  id="edit-tax-rate"
                  type="text"
                  inputMode="decimal"
                  className="edit-tax__rate-input"
                  value={rateStr}
                  onChange={(e) => {
                    // Locale-aware: a comma-decimal locale ("8,5") must parse
                    // to 8.5, not 85. Canonical (dot) shape keeps the
                    // downstream parseFloat correct.
                    setRateStr(sanitizeDecimalInput(e.target.value, locale))
                  }}
                  placeholder="0"
                />
                <span className="edit-tax__rate-sign" aria-hidden="true">%</span>
              </div>
              {rateInvalid && rateStr !== '' && (
                <p className="edit-tax__rate-error" role="alert">
                  {intl.formatMessage({ id: 'manage.edit_tax_rate_error' })}
                </p>
              )}
              <div className="manage-edit__note">
                {intl.formatMessage({ id: 'manage.edit_tax_note' })}
              </div>
            </div>
          )}
        </>
      )}

      {step === 'save-success' && (
        <div className="manage-seal" aria-hidden={!saved}>
          <div className="manage-seal__lottie">
            {saved && (
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
            {intl.formatMessage({ id: 'manage.edit_tax_success_stamp' })}
          </span>

          <h2 className="manage-seal__title">
            {intl.formatMessage(
              { id: 'manage.edit_tax_success_title' },
              { em: (chunks) => <em key="em">{chunks}</em> },
            )}
          </h2>

          <p className="manage-seal__subtitle">
            {intl.formatMessage({ id: 'manage.edit_tax_success_subtitle' })}
          </p>
        </div>
      )}
    </ModalShell>
  )
}
