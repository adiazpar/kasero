import { errorResponse, successResponse, withBusinessAuth, applyRateLimit, enforceMaxContentLength } from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { isPro } from '@kasero/shared/entitlements'
import { RateLimits } from '@/lib/rate-limit'
import { decodeAndSniffAiImage } from '@/lib/file-sniff'
import { logServerError } from '@/lib/server-logger'

/**
 * POST /api/businesses/[businessId]/ai/parse-receipt
 *
 * Receipt snap-to-expense: extracts { amount, date, merchant, note,
 * categoryName } from a receipt photo via gpt-4o-mini vision. Mirrors
 * /api/ai/identify-product for the raw-fetch call shape, image sniffing,
 * and cost-protection layers — but is business-scoped (withBusinessAuth)
 * so the entitlement tier (free vs Pro daily AI quota) is resolvable
 * from `access.plan` and the prompt can carry the business locale /
 * currency for correct amount parsing (comma decimals etc.).
 *
 * The route only EXTRACTS — the client prefills the add-expense form and
 * the user reviews before saving. Nothing is written to the DB here.
 */

// Decoded image cap for AI inputs. The wrapper Content-Length cap is
// 2 MB on the request envelope; base64 inflates ~33%, so the largest
// legit decoded image is ~1.5 MB. Matches identify-product.
const MAX_AI_IMAGE_BYTES = 1_500_000

const MAX_BODY_BYTES = 2 * 1024 * 1024

// Sanity cap on the extracted total. Matches Schemas.amount()'s upper
// bound so a hallucinated figure can't prefill something the expense
// POST would reject anyway.
const MAX_RECEIPT_AMOUNT = 1_000_000_000

// String-field caps — the values land in prompt-adjacent UI form fields,
// so keep them bounded regardless of what the model emits.
const MAX_MERCHANT_LENGTH = 120
const MAX_NOTE_LENGTH = 300
const MAX_CATEGORY_NAME_LENGTH = 80

// ISO 4217 / BCP 47 shape guards, same rationale as identify-product:
// these strings are rendered into the system prompt, so only the
// canonical shapes are accepted (values come from access.*, which is
// server-trusted, but the guard keeps the prompt predictable anyway).
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/
const LOCALE_PATTERN = /^[A-Za-z0-9-]{2,20}$/

interface ParseReceiptRequestBody {
  image?: string
}

interface ReceiptResult {
  amount: number
  date: string | null
  merchant: string | null
  note: string | null
  categoryName: string | null
}

function buildSystemPrompt(locale: string, currency: string): string {
  return `You are a receipt-parsing assistant for a small business expense tracker.

The business operates with locale ${locale} and currency ${currency}. Receipts may be printed in the language and number format of that region — for example, some locales write decimals with a comma ("12,50") and thousands with a dot ("1.250,00"). Interpret amounts accordingly.

Analyze the receipt photo and extract:
1. "amount": the grand TOTAL the customer paid (after tax, after discounts), as a plain positive number with a dot decimal separator, NO currency symbol, NO thousands separators. If several totals appear, pick the final amount paid. This field is REQUIRED — if you truly cannot read any total, return null and the request will be treated as unreadable.
2. "date": the purchase date in strict YYYY-MM-DD format, or null if not readable. Never guess a date that is not printed on the receipt.
3. "merchant": the store / vendor name as printed, or null.
4. "note": one short human-readable summary line of what was purchased (in the language of locale ${locale}), or null. Keep it under 120 characters. Example: "Cleaning supplies and paper towels".
5. "categoryName": your best guess at a short, generic expense category for this purchase (1-3 words), written in the language of locale ${locale}, or null. Examples for en-US: "Supplies", "Utilities", "Transport".

Rules:
- Extract only what is visible. Never invent an amount, date, or merchant.
- The photo may not be a receipt at all (a menu, a product, a blurry frame). In that case return {"amount": null, "date": null, "merchant": null, "note": null, "categoryName": null}.
- Do not use emojis anywhere in the output.

Respond with ONLY valid JSON in this exact shape:
{"amount": <number> | null, "date": "YYYY-MM-DD" | null, "merchant": "..." | null, "note": "..." | null, "categoryName": "..." | null}`
}

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLength)
}

/**
 * Normalize the model's date to a valid past-or-today ISO date (UTC), or
 * null. "Today" gets a one-day cushion so a receipt from a timezone
 * ahead of UTC isn't dropped at local end-of-day.
 */
function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null
  const parsed = new Date(`${match[0]}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return null
  // Round-trip check: rejects impossible dates like 2026-02-31 that
  // Date silently rolls over into the next month.
  if (parsed.toISOString().slice(0, 10) !== match[0]) return null
  const tomorrow = Date.now() + 24 * 60 * 60 * 1000
  if (parsed.getTime() > tomorrow) return null
  return match[0]
}

/**
 * Hand-validate the parsed model JSON, mirroring identify-product's
 * validateResult. The amount is the one hard requirement — a receipt
 * without a readable total is an unusable extraction, so we throw and
 * the caller surfaces AI_RECEIPT_FAILED. Every other field collapses to
 * null rather than prefilling a doubtful value the owner may
 * rubber-stamp.
 */
function validateResult(parsed: unknown): ReceiptResult {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Response is not an object')
  }
  const obj = parsed as Record<string, unknown>

  const rawAmount = obj.amount
  if (
    typeof rawAmount !== 'number' ||
    !Number.isFinite(rawAmount) ||
    rawAmount <= 0 ||
    rawAmount > MAX_RECEIPT_AMOUNT
  ) {
    throw new Error('Receipt amount missing or invalid')
  }

  return {
    amount: rawAmount,
    date: normalizeDate(obj.date),
    merchant: cleanString(obj.merchant, MAX_MERCHANT_LENGTH),
    note: cleanString(obj.note, MAX_NOTE_LENGTH),
    categoryName: cleanString(obj.categoryName, MAX_CATEGORY_NAME_LENGTH),
  }
}

export const POST = withBusinessAuth(async (request, access) => {
  const oversize = enforceMaxContentLength(request, MAX_BODY_BYTES)
  if (oversize) return oversize

  // Three-layer cost protection, same shape as identify-product:
  //   1. Per-minute per-user (shared 'ai:' budget across all AI routes).
  //   2. Per-day per-user — tier-selected: Pro members get the larger
  //      aiDailyPro bucket under the DISTINCT 'ai-daily-pro:' key prefix
  //      (the Upstash limiter instance is keyed on (limit, window), so
  //      reusing 'ai-daily:' with the pro config would silently share
  //      one sliding window between the tiers). failClosed.
  //   3. Global per-day kill-switch on total deployment spend.
  const rateLimited = await applyRateLimit(`ai:${access.userId}`, RateLimits.ai)
  if (rateLimited) return rateLimited
  const proEntitled = isPro(access.plan, access.planExpiresAt)
  const userDailyLimited = await applyRateLimit(
    proEntitled ? `ai-daily-pro:${access.userId}` : `ai-daily:${access.userId}`,
    proEntitled ? RateLimits.aiDailyPro : RateLimits.aiDaily,
    ApiMessageCode.AI_RATE_LIMITED,
  )
  if (userDailyLimited) return userDailyLimited
  const today = new Date().toISOString().slice(0, 10)
  const globalLimited = await applyRateLimit(
    `ai-global:${today}`,
    RateLimits.aiGlobalDaily,
    ApiMessageCode.AI_RATE_LIMITED,
  )
  if (globalLimited) return globalLimited

  try {
    const body = (await request.json()) as ParseReceiptRequestBody
    const image = body.image

    if (!image) {
      return errorResponse(ApiMessageCode.AI_IMAGE_REQUIRED, 400)
    }

    // Decode + content-sniff BEFORE forwarding to OpenAI — never burn
    // tokens on a payload that isn't a real raster image, and re-encode
    // using the sniffed MIME so the prefix matches the bytes.
    const sniffResult = decodeAndSniffAiImage(image, MAX_AI_IMAGE_BYTES)
    if (!sniffResult.ok) {
      return errorResponse(ApiMessageCode.AI_IMAGE_REQUIRED, 400)
    }

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      return errorResponse(ApiMessageCode.AI_NOT_CONFIGURED, 500)
    }

    const locale = LOCALE_PATTERN.test(access.businessLocale)
      ? access.businessLocale
      : 'en-US'
    const currency = CURRENCY_PATTERN.test(access.businessCurrency)
      ? access.businessCurrency.toUpperCase()
      : 'USD'

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: buildSystemPrompt(locale, currency) },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Parse this receipt. Return only JSON.' },
              {
                type: 'image_url',
                image_url: {
                  // Re-encoded data URL whose MIME matches the sniffed
                  // bytes — never the client-declared prefix.
                  url: sniffResult.dataUrl,
                  detail: 'low',
                },
              },
            ],
          },
        ],
        max_tokens: 250,
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      // Upstream error body is provider-controlled; route through the
      // safe-logger so prod logs only carry the tag.
      logServerError(
        'ai.parse-receipt.openai-error',
        new Error(`openai responded ${response.status}`),
        { errorData },
      )
      // Surface upstream billing exhaustion distinctly, same as
      // identify-product: deployment-wide condition vs a retryable
      // extraction failure.
      const openaiError =
        errorData && typeof errorData === 'object' && 'error' in errorData
          ? (errorData as { error?: { code?: unknown; type?: unknown } }).error
          : null
      const errorCode =
        openaiError && typeof openaiError.code === 'string' ? openaiError.code : ''
      const errorType =
        openaiError && typeof openaiError.type === 'string' ? openaiError.type : ''
      if (
        response.status === 429 &&
        (errorCode === 'insufficient_quota' || errorType === 'insufficient_quota')
      ) {
        return errorResponse(ApiMessageCode.AI_QUOTA_EXHAUSTED, 503)
      }
      return errorResponse(ApiMessageCode.AI_RECEIPT_FAILED, 500)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content?.trim()

    if (!content) {
      return errorResponse(ApiMessageCode.AI_RECEIPT_FAILED, 500)
    }

    try {
      const cleanContent = content
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim()
      const parsed = JSON.parse(cleanContent)
      const result = validateResult(parsed)
      return successResponse({ data: result })
    } catch (err) {
      // `content` is the raw model output; pass via context so it's
      // available in dev but dropped in prod.
      logServerError('ai.parse-receipt.parse-failed', err, { content })
      return errorResponse(ApiMessageCode.AI_RECEIPT_FAILED, 500)
    }
  } catch (error) {
    logServerError('ai.parse-receipt', error)
    return errorResponse(ApiMessageCode.INTERNAL_ERROR, 500)
  }
}, { maxBodyBytes: MAX_BODY_BYTES })
