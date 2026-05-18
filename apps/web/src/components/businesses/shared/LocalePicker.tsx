'use client'

import { useIntl } from 'react-intl';
import { REGIONS, getLocalesByRegion, getCurrencyConfig } from '@kasero/shared/locale-config'
import type { Region } from '@kasero/shared/locale-config'

export interface LocalePickerProps {
  value: string
  onChange: (locale: string) => void
  /** If true, shows the derived currency below the select. Defaults to true. */
  showCurrency?: boolean
}

export function LocalePicker({ value, onChange, showCurrency = true }: LocalePickerProps) {
  const t = useIntl()
  const localesByRegion = getLocalesByRegion()

  // Derive currency from the selected locale
  const selectedLocale = (() => {
    for (const region of REGIONS) {
      const loc = localesByRegion[region].find(l => l.code === value)
      if (loc) return loc
    }
    return null
  })()

  const currencyConfig = selectedLocale ? getCurrencyConfig(selectedLocale.currency) : null

  const regionLabels: Record<Region, string> = {
    'North America': t.formatMessage({
      id: 'createBusiness.region_north_america'
    }),
    'Central America': t.formatMessage({
      id: 'createBusiness.region_central_america'
    }),
    'South America': t.formatMessage({
      id: 'createBusiness.region_south_america'
    }),
    'Caribbean': t.formatMessage({
      id: 'createBusiness.region_caribbean'
    }),
    'Europe': t.formatMessage({
      id: 'createBusiness.region_europe'
    }),
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="auth-field">
        <span className="auth-field__label">
          {t.formatMessage({ id: 'createBusiness.location_label' })}
        </span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="auth-field__input auth-field__input--select"
        >
          {REGIONS.map((region) => (
            <optgroup key={region} label={regionLabels[region]}>
              {localesByRegion[region].map((loc) => (
                <option key={loc.code} value={loc.code}>
                  {loc.flag} {loc.country} ({loc.name})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      {showCurrency && currencyConfig && selectedLocale && (
        <aside className="locale-currency" aria-live="polite">
          <div className="locale-currency__face" aria-hidden="true">
            <span
              key={`country-${selectedLocale.code}`}
              className="locale-currency__engrave locale-currency__engrave--top"
            >
              {selectedLocale.country.toUpperCase()}
            </span>
            <span
              key={`sym-${currencyConfig.code}`}
              className="locale-currency__symbol"
              data-len={currencyConfig.symbol.length}
            >
              {currencyConfig.symbol}
            </span>
            <span
              key={`denom-${currencyConfig.code}`}
              className="locale-currency__engrave locale-currency__engrave--bottom"
            >
              {currencyConfig.denomination}
            </span>
          </div>

          <div className="locale-currency__meta">
            <span className="locale-currency__eyebrow">
              {t.formatMessage({ id: 'createBusiness.currency_label' })}
            </span>
            <span className="locale-currency__rule" aria-hidden="true" />
            <span key={`name-${currencyConfig.code}`} className="locale-currency__name">
              {currencyConfig.name}
            </span>
            <span key={`code-${currencyConfig.code}`} className="locale-currency__code">
              {currencyConfig.code}
            </span>
          </div>
        </aside>
      )}
    </div>
  );
}
