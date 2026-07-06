import { errorResponse, successResponse, withBusinessAuth, applyRateLimit } from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { isPro } from '@kasero/shared/entitlements'
import { getLocaleConfig } from '@kasero/shared/locales'
import { RateLimits, checkRateLimit, UpstashUnavailableError } from '@/lib/rate-limit'
import { logServerError } from '@/lib/server-logger'
import { gatherPulseData, fetchUserLanguage, type PulseSummaryData } from './data'

/**
 * POST /api/businesses/[businessId]/pulse
 *
 * Kasero Pulse — a localized AI digest of how the business is doing.
 * Any member role can generate one (the digest reads the same shared
 * aggregates every member already sees on Home).
 *
 * Gate: Pro businesses generate freely within the AI quota; free
 * businesses get 1 sample per calendar month, then
 * PULSE_FREE_LIMIT_REACHED (403) drives the upgrade path on the client.
 *
 * All data gathering + currency formatting happens server-side in
 * ./data.ts; the model only writes prose around pre-formatted strings.
 * The digest is written in the requesting user's UI language while
 * amounts stay business-locale formatted.
 */

const MAX_HEADLINE_LENGTH = 200
const MAX_SECTION_TITLE_LENGTH = 120
const MAX_SECTION_BODY_LENGTH = 800
const MAX_WATCHOUT_LENGTH = 300

export interface PulseDigest {
  headline: string
  sections: { title: string; body: string }[]
  watchouts: string[]
  generatedAt: string
}

/** Upstream billing exhaustion — not retryable, maps to AI_QUOTA_EXHAUSTED. */
class QuotaExhaustedError extends Error {
  constructor() {
    super('OpenAI quota exhausted')
    this.name = 'QuotaExhaustedError'
  }
}

function buildSystemPrompt(languageName: string, languageCode: string): string {
  return `You are Kasero Pulse, a business-performance digest writer inside a small-business management app.

You will receive a JSON summary of one small business's recent performance. Write a short, useful digest for the owner.

Language rules — follow strictly:
- Write EVERY piece of text (headline, section titles, section bodies, watchouts) in ${languageName} (${languageCode}).
- Monetary amounts in the input are ALREADY formatted strings in the business's local currency. Reproduce them EXACTLY as given, character for character. NEVER recompute, convert, reformat, round, or total any amount, and never do arithmetic of your own.
- Product names, category names, and the business name are user data — reproduce them verbatim; never translate them.

Content rules:
- Be concrete and grounded in the provided numbers. No filler, no generic advice that ignores the data.
- Plain-spoken and professional. No emojis. No markdown. No bullet characters inside strings.
- If the data is sparse (a new or quiet business), say so honestly and keep the digest short rather than inventing trends.
- "watchouts" are short risk flags supported by the data (low stock, revenue dips, expenses outpacing income). An empty array is fine.

Respond with ONLY valid JSON in this exact shape:
{"headline": "...", "sections": [{"title": "...", "body": "..."}], "watchouts": ["..."]}
- headline: one sentence, at most 90 characters.
- sections: 2 to 4 items; each body is 1-3 sentences.
- watchouts: 0 to 3 short strings.`
}

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLength)
}

/**
 * Hand-validate the model JSON into the digest contract. Throws on any
 * shape the client can't render (the caller retries once, then emits
 * AI_PULSE_FAILED).
 */
function validateDigest(parsed: unknown): Omit<PulseDigest, 'generatedAt'> {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Response is not an object')
  }
  const obj = parsed as Record<string, unknown>

  const headline = cleanString(obj.headline, MAX_HEADLINE_LENGTH)
  if (!headline) {
    throw new Error('Missing headline')
  }

  if (!Array.isArray(obj.sections)) {
    throw new Error('Missing sections')
  }
  const sections: { title: string; body: string }[] = []
  for (const raw of obj.sections) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const title = cleanString(item.title, MAX_SECTION_TITLE_LENGTH)
    const body = cleanString(item.body, MAX_SECTION_BODY_LENGTH)
    if (title && body) sections.push({ title, body })
  }
  if (sections.length < 2) {
    throw new Error('Fewer than 2 valid sections')
  }

  const watchouts = Array.isArray(obj.watchouts)
    ? obj.watchouts
        .map((w) => cleanString(w, MAX_WATCHOUT_LENGTH))
        .filter((w): w is string => w !== null)
        .slice(0, 3)
    : []

  return { headline, sections: sections.slice(0, 4), watchouts }
}

async function callModel(
  apiKey: string,
  summary: PulseSummaryData,
  languageName: string,
  languageCode: string,
): Promise<Omit<PulseDigest, 'generatedAt'>> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: buildSystemPrompt(languageName, languageCode) },
        {
          role: 'user',
          content: `Business performance summary JSON:\n${JSON.stringify(summary)}`,
        },
      ],
      max_tokens: 700,
      temperature: 0.4,
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    // Upstream error body is provider-controlled; safe-logger keeps prod
    // logs down to the tag.
    logServerError(
      'pulse.openai-error',
      new Error(`openai responded ${response.status}`),
      { errorData },
    )
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
      // Billing exhaustion is deployment-wide — retrying is pointless.
      throw new QuotaExhaustedError()
    }
    throw new Error(`OpenAI request failed (${response.status})`)
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content?.trim()
  if (!content) {
    throw new Error('Empty model response')
  }

  const cleanContent = content
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim()
  return validateDigest(JSON.parse(cleanContent))
}

export const POST = withBusinessAuth(async (_request, access) => {
  const proEntitled = isPro(access.plan, access.planExpiresAt)

  // Free-tier gate: 1 sample per calendar month per business. The key is
  // month-stamped so the sample resets on calendar-month boundaries
  // regardless of the sliding-window math (the 35-day window only has to
  // outlive the longest month). checkRateLimit is used directly (not
  // applyRateLimit) because the limited outcome is a 403 paywall
  // envelope, not a 429.
  if (!proEntitled) {
    const monthStamp = new Date().toISOString().slice(0, 7) // YYYY-MM
    try {
      const sample = await checkRateLimit(
        `pulse-free:${access.businessId}:${monthStamp}`,
        RateLimits.pulseFreeSample,
      )
      if (!sample.success) {
        return errorResponse(ApiMessageCode.PULSE_FREE_LIMIT_REACHED, 403)
      }
    } catch (err) {
      // failClosed limiter: an Upstash brownout must not hand out
      // unmetered free samples.
      if (err instanceof UpstashUnavailableError) {
        const response = errorResponse(ApiMessageCode.RATE_LIMITER_UNAVAILABLE, 503)
        response.headers.set('Retry-After', '5')
        return response
      }
      throw err
    }
  }

  // Standard AI cost-protection layers, same shape as parse-receipt /
  // identify-product: shared per-minute budget, entitlement-tier daily
  // ceiling (distinct 'ai-daily-pro:' key prefix for the pro bucket),
  // global daily kill-switch.
  const rateLimited = await applyRateLimit(`ai:${access.userId}`, RateLimits.ai)
  if (rateLimited) return rateLimited
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

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return errorResponse(ApiMessageCode.AI_NOT_CONFIGURED, 500)
  }

  try {
    const [summary, userLanguage] = await Promise.all([
      gatherPulseData(access),
      fetchUserLanguage(access.userId),
    ])
    // Resolve through the locale registry so an unregistered value on the
    // row collapses to the en-US default rather than leaking into the
    // prompt verbatim.
    const localeConfig = getLocaleConfig(userLanguage)
    const languageCode = localeConfig ? userLanguage : 'en-US'
    const languageName = localeConfig?.translate?.name ?? 'English'

    // Malformed model output gets exactly one retry — a second bad JSON
    // means AI_PULSE_FAILED rather than a third billable call.
    let digest: Omit<PulseDigest, 'generatedAt'> | null = null
    for (let attempt = 0; attempt < 2 && !digest; attempt++) {
      try {
        digest = await callModel(apiKey, summary, languageName, languageCode)
      } catch (err) {
        if (err instanceof QuotaExhaustedError) {
          return errorResponse(ApiMessageCode.AI_QUOTA_EXHAUSTED, 503)
        }
        logServerError('pulse.attempt-failed', err, { attempt })
      }
    }
    if (!digest) {
      return errorResponse(ApiMessageCode.AI_PULSE_FAILED, 500)
    }

    return successResponse({
      data: { ...digest, generatedAt: new Date().toISOString() },
    })
  } catch (error) {
    logServerError('pulse', error)
    return errorResponse(ApiMessageCode.INTERNAL_ERROR, 500)
  }
})
