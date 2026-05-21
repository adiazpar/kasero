'use client'

import { useIntl } from 'react-intl'

interface WizardProgressProps {
  /** 1-based index of the current step. */
  current: number
  /** Total number of steps in the chain. */
  total: number
}

/**
 * Thin progress bar rendered at the top of each Add/Edit product wizard
 * step. The bar IS the step count — no prominent "STEP X OF Y" eyebrow
 * label needed. A small mono `1 / 4` is included as an a11y-readable
 * companion that won't out-shout the question prompt.
 *
 * Track is a 2px hair-coloured strip; the inner fill is brand terracotta
 * and tweens its width on step change (see CSS).
 */
export function WizardProgress({ current, total }: WizardProgressProps) {
  const t = useIntl()
  const pct = Math.min(100, Math.max(0, (current / total) * 100))
  const ariaLabel = t.formatMessage(
    { id: 'productAddEdit.wizard_progress_aria' },
    { current, total },
  )

  return (
    <div
      className="pm-wizard-progress"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={current}
      aria-label={ariaLabel}
    >
      <div className="pm-wizard-progress__track">
        <div
          className="pm-wizard-progress__fill"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="pm-wizard-progress__label" aria-hidden="true">
        {current} / {total}
      </span>
    </div>
  )
}
