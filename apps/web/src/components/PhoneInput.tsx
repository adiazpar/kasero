import { useState, useEffect } from 'react'
import {
  IonInput, IonItem, IonLabel, IonSelect, IonSelectOption,
} from '@ionic/react'
import { useIntl } from 'react-intl'
// The /min entrypoint ships reduced metadata (no extended validation /
// geolocation data) — sufficient for parse-to-E.164 validation here and
// roughly half the size of the default entrypoint.
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min'
import { useAuth } from '@/contexts/auth-context'
import './PhoneInput.css'

interface PhoneInputProps {
  /**
   * Current value in E.164 form, or null if no number is entered.
   * Empty string is treated the same as null.
   */
  value: string | null
  /**
   * Fired when the parsed E.164 value changes. Receives null when the
   * field is empty OR the input doesn't form a valid number for the
   * selected country.
   */
  onChange: (e164: string | null) => void
}

/**
 * Country-aware phone input. The user picks a default country, then
 * types their number in local format; we parse to E.164 on every
 * keystroke via libphonenumber-js and report the parsed value (or null
 * if the input doesn't validate). On first mount, the country defaults
 * from the user's UI language so a Japanese-speaking user starts on
 * Japan, etc.
 */
function defaultCountryFromLanguage(language: string): CountryCode {
  if (language === 'es') return 'PE'
  if (language === 'ja') return 'JP'
  return 'US'
}

const COUNTRIES: ReadonlyArray<{ code: CountryCode; label: string }> = [
  { code: 'US', label: 'United States (+1)' },
  { code: 'PE', label: 'Peru (+51)' },
  { code: 'JP', label: 'Japan (+81)' },
  { code: 'MX', label: 'Mexico (+52)' },
  { code: 'ES', label: 'Spain (+34)' },
  { code: 'GB', label: 'United Kingdom (+44)' },
  { code: 'CA', label: 'Canada (+1)' },
]

export function PhoneInput({ value, onChange }: PhoneInputProps) {
  const intl = useIntl()
  const { user } = useAuth()
  const [country, setCountry] = useState<CountryCode>(() =>
    defaultCountryFromLanguage(user?.language ?? 'en-US'),
  )
  // Local display: if value is E.164 and parseable for the current
  // country, render it in national format; otherwise just hold what
  // the user is typing.
  const [raw, setRaw] = useState<string>(() => {
    if (!value) return ''
    const parsed = parsePhoneNumberFromString(value)
    return parsed?.formatNational() ?? value
  })
  const [showError, setShowError] = useState(false)

  useEffect(() => {
    if (!raw.trim()) {
      onChange(null)
      setShowError(false)
      return
    }
    const parsed = parsePhoneNumberFromString(raw, country)
    if (parsed && parsed.isValid()) {
      onChange(parsed.number)
      setShowError(false)
    } else {
      onChange(null)
      setShowError(true)
    }
  }, [raw, country, onChange])

  return (
    <div className="phone-input">
      <IonItem>
        <IonLabel>{intl.formatMessage({ id: 'profile_phone_country' })}</IonLabel>
        <IonSelect
          value={country}
          onIonChange={(e) => setCountry(e.detail.value as CountryCode)}
          interface="popover"
        >
          {COUNTRIES.map((c) => (
            <IonSelectOption key={c.code} value={c.code}>{c.label}</IonSelectOption>
          ))}
        </IonSelect>
      </IonItem>
      <IonItem>
        <IonLabel position="floating">
          {intl.formatMessage({ id: 'profile_phone_label' })}
        </IonLabel>
        <IonInput
          type="tel"
          inputmode="tel"
          autocomplete="tel"
          value={raw}
          onIonInput={(e) => setRaw(e.detail.value ?? '')}
        />
      </IonItem>
      <p className="phone-input__help">
        {intl.formatMessage({ id: 'profile_phone_help' })}
      </p>
      {showError && (
        <p role="alert" className="phone-input__error">
          {intl.formatMessage({ id: 'phone_invalid' })}
        </p>
      )}
    </div>
  )
}
