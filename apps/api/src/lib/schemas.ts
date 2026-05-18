/**
 * Shared Zod schema builders for common validation patterns.
 *
 * Custom error messages intentionally omitted: the route-level
 * `validationError()` helper in api-middleware.ts maps Zod issue codes
 * to ApiMessageCode values, and the client translates them via the
 * `apiMessages` i18n namespace. Adding `.min(n, 'English string')` here
 * would be dead code that no one reads.
 */

import { z } from 'zod'

export const Schemas = {
  /**
   * Email field with lowercase normalization.
   */
  email: () => z.email().toLowerCase(),

  /**
   * Required name field with minimum and maximum length. The 80-char default
   * is a permissive safety net: plenty of room for real business/product
   * names while blocking pathological pasted values.
   */
  name: (minLength = 1, maxLength = 80) =>
    z.string().min(minLength).max(maxLength),

  /**
   * Required ID field. Capped at 64 chars: nanoid produces 21-char
   * IDs by default, and even doubled-up legacy IDs stay well under
   * 64. Without this cap an attacker could pass a megabyte string
   * as an ID and force a full-length DB string-compare on every
   * lookup that hits this schema.
   */
  id: () => z.string().min(1).max(64),

  /**
   * Boolean from string or boolean input (for FormData).
   * Defaults to true if not provided.
   */
  activeFlag: () =>
    z
      .preprocess((val) => val === 'true' || val === true, z.boolean())
      .default(true),

  /**
   * Optional phone number field.
   */
  phone: () => z.string().nullable().optional(),

  /**
   * Non-negative numeric amount for JSON-body callers (the field
   * arrives as a number, not a string). Upper bound caps the value
   * at ~1B in the smallest currency unit — well above any legit
   * single-item price, but low enough that a client sending
   * Number.MAX_SAFE_INTEGER gets rejected at the edge instead of
   * writing a nonsense value to the DB.
   *
   * For FormData routes (price/total fields that arrive as strings),
   * use `Schemas.amountFromString()` — explicitly typed so the
   * intent is visible at the call site.
   *
   * The previous single `amount()` used `z.coerce.number()` which
   * silently accepted booleans, single-element arrays, null, etc.
   * Splitting forces each caller to declare its boundary.
   */
  amount: () => z.number().min(0).max(1_000_000_000),

  /**
   * Positive numeric amount (must be > 0) for JSON-body callers.
   * Same upper bound as amount. Use `positiveAmountFromString()`
   * for FormData paths.
   */
  positiveAmount: () => z.number().positive().max(1_000_000_000),

  /**
   * Non-negative numeric amount for FormData-body callers (the
   * field arrives as a string from `formData.get(...)`). The
   * preprocess step accepts only strings, parses to number, and
   * lets the strict `z.number()` shape do the actual validation.
   * Non-string inputs (the surprising outputs of `z.coerce.number()`
   * on booleans / arrays / null) hit the `NaN` branch and fail
   * validation cleanly.
   */
  amountFromString: () =>
    z.preprocess(
      (val) => (typeof val === 'string' ? Number(val) : NaN),
      z.number().min(0).max(1_000_000_000),
    ),

  /**
   * Positive numeric amount (must be > 0) for FormData-body callers.
   */
  positiveAmountFromString: () =>
    z.preprocess(
      (val) => (typeof val === 'string' ? Number(val) : NaN),
      z.number().positive().max(1_000_000_000),
    ),

  /**
   * Required code field (invite codes, transfer codes). All current
   * code surfaces use 6 alphanumeric characters; the .length(6) cap
   * matches the DB schema and stops anyone passing a megabyte string
   * into routes that key on `code`. Charset enforcement rejects
   * weird Unicode that would otherwise pass through .toUpperCase()
   * and waste DB time on a no-match SELECT.
   */
  code: () =>
    z
      .string()
      .length(6)
      .regex(/^[A-Z0-9]+$/i)
      .toUpperCase(),

  /**
   * Role field with allowed values.
   */
  role: () => z.enum(['owner', 'partner', 'employee']),

  /**
   * Locale code (e.g., 'en-US', 'es-MX').
   */
  locale: () => z.string().regex(/^[a-z]{2}-[A-Z]{2}$/),

  /**
   * Currency code (ISO 4217, e.g., 'USD', 'MXN').
   */
  currency: () => z.string().length(3).toUpperCase(),

  /**
   * Business icon (emoji or base64 image data URL).
   *
   * Accepts either a short string (emoji / ZWJ sequence) or a data URL whose
   * MIME type is a supported image format and whose decoded payload is <= 2 MB.
   * Rejects anything else so a tampered client can't bloat the row.
   */
  businessIcon: () =>
    z
      .string()
      .nullable()
      .optional()
      .refine(
        (val) => {
          if (val == null || val === '') return true
          if (!val.startsWith('data:')) {
            // Emoji / short identifier — cap length as a safety net.
            return val.length <= 64
          }
          if (!DATA_URL_IMAGE_REGEX.test(val)) return false
          const base64 = val.slice(val.indexOf(',') + 1)
          const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
          const decodedBytes = Math.floor((base64.length * 3) / 4) - padding
          return decodedBytes <= MAX_BUSINESS_ICON_BYTES
        },
        // params.apiMessageCode is read by mapZodIssueToEnvelope() in
        // api-middleware.ts and mapped to a translated string on the client.
        { params: { apiMessageCode: 'BUSINESS_ICON_INVALID' } }
      ),
}

const MAX_BUSINESS_ICON_BYTES = 2 * 1024 * 1024
const DATA_URL_IMAGE_REGEX = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/
