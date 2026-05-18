/**
 * Locale configuration for business settings.
 *
 * Each locale carries its country, ISO code, currency, and flag. Timezone
 * is intentionally NOT stored: the browser's local timezone handles display
 * 95% of the time, and the 5% of edge cases (remote staff, traveling owner)
 * aren't worth the extra column + picker complexity.
 */

export type Region =
  | 'North America'
  | 'Central America'
  | 'South America'
  | 'Caribbean'
  | 'Europe'

interface LocaleConfig {
  code: string // Locale code (e.g., 'en-US')
  name: string // Display name
  country: string // Country name for grouping
  isoCountry: string // ISO 3166-1 alpha-2 country code (e.g., 'US', 'PE')
  currency: string // ISO 4217 currency code
  flag: string // Flag emoji for visual identification
  region: Region
}

interface CurrencyConfig {
  code: string // ISO 4217 code
  symbol: string // Currency symbol (narrowSymbol per CLDR)
  name: string // Display name
  decimals: number // Decimal places
  symbolPosition: 'before' | 'after' // Symbol position relative to amount
  denomination: string // Uppercase singular unit ("PESO", "DOLLAR", "EURO"),
                       // used for banknote-style engraving in the locale picker.
}

// Supported locales with their defaults
const LOCALES: LocaleConfig[] = [
  // North America
  { code: 'en-US', name: 'English (US)', country: 'United States', isoCountry: 'US', currency: 'USD', flag: '🇺🇸', region: 'North America' },
  { code: 'en-CA', name: 'English (Canada)', country: 'Canada', isoCountry: 'CA', currency: 'CAD', flag: '🇨🇦', region: 'North America' },
  { code: 'fr-CA', name: 'French (Canada)', country: 'Canada', isoCountry: 'CA', currency: 'CAD', flag: '🇨🇦', region: 'North America' },
  { code: 'es-MX', name: 'Spanish (Mexico)', country: 'Mexico', isoCountry: 'MX', currency: 'MXN', flag: '🇲🇽', region: 'North America' },

  // Central America
  { code: 'es-GT', name: 'Spanish (Guatemala)', country: 'Guatemala', isoCountry: 'GT', currency: 'GTQ', flag: '🇬🇹', region: 'Central America' },
  { code: 'es-SV', name: 'Spanish (El Salvador)', country: 'El Salvador', isoCountry: 'SV', currency: 'USD', flag: '🇸🇻', region: 'Central America' },
  { code: 'es-HN', name: 'Spanish (Honduras)', country: 'Honduras', isoCountry: 'HN', currency: 'HNL', flag: '🇭🇳', region: 'Central America' },
  { code: 'es-NI', name: 'Spanish (Nicaragua)', country: 'Nicaragua', isoCountry: 'NI', currency: 'NIO', flag: '🇳🇮', region: 'Central America' },
  { code: 'es-CR', name: 'Spanish (Costa Rica)', country: 'Costa Rica', isoCountry: 'CR', currency: 'CRC', flag: '🇨🇷', region: 'Central America' },
  { code: 'es-PA', name: 'Spanish (Panama)', country: 'Panama', isoCountry: 'PA', currency: 'USD', flag: '🇵🇦', region: 'Central America' },

  // South America
  { code: 'es-CO', name: 'Spanish (Colombia)', country: 'Colombia', isoCountry: 'CO', currency: 'COP', flag: '🇨🇴', region: 'South America' },
  { code: 'es-VE', name: 'Spanish (Venezuela)', country: 'Venezuela', isoCountry: 'VE', currency: 'VES', flag: '🇻🇪', region: 'South America' },
  { code: 'es-EC', name: 'Spanish (Ecuador)', country: 'Ecuador', isoCountry: 'EC', currency: 'USD', flag: '🇪🇨', region: 'South America' },
  { code: 'es-PE', name: 'Spanish (Peru)', country: 'Peru', isoCountry: 'PE', currency: 'PEN', flag: '🇵🇪', region: 'South America' },
  { code: 'es-BO', name: 'Spanish (Bolivia)', country: 'Bolivia', isoCountry: 'BO', currency: 'BOB', flag: '🇧🇴', region: 'South America' },
  { code: 'es-CL', name: 'Spanish (Chile)', country: 'Chile', isoCountry: 'CL', currency: 'CLP', flag: '🇨🇱', region: 'South America' },
  { code: 'es-AR', name: 'Spanish (Argentina)', country: 'Argentina', isoCountry: 'AR', currency: 'ARS', flag: '🇦🇷', region: 'South America' },
  { code: 'es-UY', name: 'Spanish (Uruguay)', country: 'Uruguay', isoCountry: 'UY', currency: 'UYU', flag: '🇺🇾', region: 'South America' },
  { code: 'es-PY', name: 'Spanish (Paraguay)', country: 'Paraguay', isoCountry: 'PY', currency: 'PYG', flag: '🇵🇾', region: 'South America' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)', country: 'Brazil', isoCountry: 'BR', currency: 'BRL', flag: '🇧🇷', region: 'South America' },

  // Caribbean
  { code: 'es-DO', name: 'Spanish (Dominican Republic)', country: 'Dominican Republic', isoCountry: 'DO', currency: 'DOP', flag: '🇩🇴', region: 'Caribbean' },
  { code: 'es-PR', name: 'Spanish (Puerto Rico)', country: 'Puerto Rico', isoCountry: 'PR', currency: 'USD', flag: '🇵🇷', region: 'Caribbean' },
  { code: 'es-CU', name: 'Spanish (Cuba)', country: 'Cuba', isoCountry: 'CU', currency: 'CUP', flag: '🇨🇺', region: 'Caribbean' },

  // Europe
  { code: 'en-GB', name: 'English (UK)', country: 'United Kingdom', isoCountry: 'GB', currency: 'GBP', flag: '🇬🇧', region: 'Europe' },
  { code: 'es-ES', name: 'Spanish (Spain)', country: 'Spain', isoCountry: 'ES', currency: 'EUR', flag: '🇪🇸', region: 'Europe' },
  { code: 'fr-FR', name: 'French (France)', country: 'France', isoCountry: 'FR', currency: 'EUR', flag: '🇫🇷', region: 'Europe' },
  { code: 'de-DE', name: 'German (Germany)', country: 'Germany', isoCountry: 'DE', currency: 'EUR', flag: '🇩🇪', region: 'Europe' },
  { code: 'it-IT', name: 'Italian (Italy)', country: 'Italy', isoCountry: 'IT', currency: 'EUR', flag: '🇮🇹', region: 'Europe' },
  { code: 'pt-PT', name: 'Portuguese (Portugal)', country: 'Portugal', isoCountry: 'PT', currency: 'EUR', flag: '🇵🇹', region: 'Europe' },
  { code: 'nl-NL', name: 'Dutch (Netherlands)', country: 'Netherlands', isoCountry: 'NL', currency: 'EUR', flag: '🇳🇱', region: 'Europe' },
]

// Region display order for grouped pickers
export const REGIONS: Region[] = [
  'North America',
  'Central America',
  'South America',
  'Caribbean',
  'Europe',
]

// Currency configurations. Symbols are derived from CLDR via
// `Intl.NumberFormat` with `narrowSymbol`, paired with the first locale
// that uses each currency — so a Canadian business sees "$", not "CA$";
// a Peruvian sees "S/", not "PEN". This is what locals actually write
// in their own market, and matches `formatCurrency` in lib/utils.
const CURRENCY_BASE: Record<string, Omit<CurrencyConfig, 'symbol'>> = {
  USD: { code: 'USD', name: 'US Dollar', decimals: 2, symbolPosition: 'before', denomination: 'DOLLAR' },
  CAD: { code: 'CAD', name: 'Canadian Dollar', decimals: 2, symbolPosition: 'before', denomination: 'DOLLAR' },
  MXN: { code: 'MXN', name: 'Mexican Peso', decimals: 2, symbolPosition: 'before', denomination: 'PESO' },
  EUR: { code: 'EUR', name: 'Euro', decimals: 2, symbolPosition: 'before', denomination: 'EURO' },
  GBP: { code: 'GBP', name: 'British Pound', decimals: 2, symbolPosition: 'before', denomination: 'POUND' },
  BRL: { code: 'BRL', name: 'Brazilian Real', decimals: 2, symbolPosition: 'before', denomination: 'REAL' },
  ARS: { code: 'ARS', name: 'Argentine Peso', decimals: 2, symbolPosition: 'before', denomination: 'PESO' },
  CLP: { code: 'CLP', name: 'Chilean Peso', decimals: 0, symbolPosition: 'before', denomination: 'PESO' },
  COP: { code: 'COP', name: 'Colombian Peso', decimals: 0, symbolPosition: 'before', denomination: 'PESO' },
  PEN: { code: 'PEN', name: 'Peruvian Sol', decimals: 2, symbolPosition: 'before', denomination: 'SOL' },
  GTQ: { code: 'GTQ', name: 'Guatemalan Quetzal', decimals: 2, symbolPosition: 'before', denomination: 'QUETZAL' },
  HNL: { code: 'HNL', name: 'Honduran Lempira', decimals: 2, symbolPosition: 'before', denomination: 'LEMPIRA' },
  NIO: { code: 'NIO', name: 'Nicaraguan Cordoba', decimals: 2, symbolPosition: 'before', denomination: 'CÓRDOBA' },
  CRC: { code: 'CRC', name: 'Costa Rican Colon', decimals: 0, symbolPosition: 'before', denomination: 'COLÓN' },
  DOP: { code: 'DOP', name: 'Dominican Peso', decimals: 2, symbolPosition: 'before', denomination: 'PESO' },
  CUP: { code: 'CUP', name: 'Cuban Peso', decimals: 2, symbolPosition: 'before', denomination: 'PESO' },
  BOB: { code: 'BOB', name: 'Bolivian Boliviano', decimals: 2, symbolPosition: 'before', denomination: 'BOLIVIANO' },
  UYU: { code: 'UYU', name: 'Uruguayan Peso', decimals: 2, symbolPosition: 'before', denomination: 'PESO' },
  PYG: { code: 'PYG', name: 'Paraguayan Guarani', decimals: 0, symbolPosition: 'before', denomination: 'GUARANÍ' },
  VES: { code: 'VES', name: 'Venezuelan Bolivar', decimals: 2, symbolPosition: 'before', denomination: 'BOLÍVAR' },
}

function narrowSymbol(currency: string): string {
  // Pair with the first locale that uses this currency so ICU returns
  // the local glyph rather than the disambiguated en form (PEN → "S/"
  // via es-PE, not "PEN" via en).
  const locale = LOCALES.find(l => l.currency === currency)?.code ?? 'en'
  const parts = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  }).formatToParts(0)
  return parts.find(p => p.type === 'currency')?.value ?? currency
}

const CURRENCIES: Record<string, CurrencyConfig> = Object.fromEntries(
  Object.entries(CURRENCY_BASE).map(([code, base]) => [
    code,
    { ...base, symbol: narrowSymbol(code) },
  ]),
)

// Helper functions
export function getLocaleConfig(localeCode: string): LocaleConfig | undefined {
  return LOCALES.find(l => l.code === localeCode)
}

export function getCurrencyConfig(currencyCode: string): CurrencyConfig | undefined {
  return CURRENCIES[currencyCode]
}

/**
 * Return the default currency for a locale. Falls back to USD.
 */
export function getCurrencyForLocale(localeCode: string): string {
  return getLocaleConfig(localeCode)?.currency ?? 'USD'
}

// Group locales by region for a grouped <select>.
export function getLocalesByRegion(): Record<Region, LocaleConfig[]> {
  const groups: Record<Region, LocaleConfig[]> = {
    'North America': [],
    'Central America': [],
    'South America': [],
    'Caribbean': [],
    'Europe': [],
  }
  for (const locale of LOCALES) {
    groups[locale.region].push(locale)
  }
  return groups
}

// Find locale by ISO country code (returns first match for countries with multiple locales)
export function getLocaleByCountryCode(isoCountry: string): LocaleConfig | undefined {
  return LOCALES.find(l => l.isoCountry === isoCountry.toUpperCase())
}
