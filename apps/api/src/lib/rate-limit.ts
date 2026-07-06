/**
 * Rate limiter with two backends.
 *
 * - If `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set,
 *   every limit check goes through Upstash's sliding-window Redis
 *   limiter. This is the correct backend for a multi-Lambda deploy
 *   on Vercel — counters live in Redis, so a user's budget is shared
 *   across every Lambda that handles their traffic.
 *
 * - Otherwise (local dev, single-instance, or creds missing) it falls
 *   back to an in-memory Map. The fallback is per-process, so rate
 *   limits don't survive horizontal scaling — acceptable in dev, but
 *   NOT in prod without the Upstash creds.
 *
 * If Upstash itself is unreachable (network blip, outage) the call
 * fails OPEN: the request is allowed through, and a warning is
 * logged. Better than taking the app down over the rate limiter.
 */

import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// ============================================
// BACKEND SELECTION
// ============================================

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null

// Refuse to start in Vercel production without Upstash creds. Without
// Redis, every Lambda has its own in-memory counter — so the effective
// rate limit is `limit * concurrency` and brute-force protection is a
// myth.
//
// We gate on:
//   - VERCEL_ENV === 'production' so non-Vercel contexts (local build,
//     CI, vitest) don't trip this without Upstash creds.
//   - NEXT_PHASE !== 'phase-production-build' so Vercel's `next build`
//     "Collecting page data" step — which runs every route module's
//     top-level code with VERCEL_ENV=production — completes even when
//     Upstash env vars haven't been wired up yet. NEXT_PHASE is unset
//     in the serverless runtime, so the safety still fires on the first
//     real request to a misconfigured prod Lambda.
if (
  process.env.VERCEL_ENV === 'production' &&
  process.env.NEXT_PHASE !== 'phase-production-build' &&
  !redis
) {
  throw new Error(
    'Rate-limit backend misconfiguration: UPSTASH_REDIS_REST_URL and ' +
      'UPSTASH_REDIS_REST_TOKEN are required in production. The in-memory ' +
      'fallback is per-Lambda and provides no real rate-limit protection ' +
      'across instances.',
  )
}

/**
 * Thrown by checkRateLimit when a fail-closed limiter (e.g. login)
 * cannot reach Upstash. Callers catch this and translate to a 503 with
 * RATE_LIMITER_UNAVAILABLE so the auth surface degrades safely instead
 * of silently disabling brute-force protection during an Upstash blip.
 */
export class UpstashUnavailableError extends Error {
  constructor(message = 'Upstash rate-limiter unavailable') {
    super(message)
    this.name = 'UpstashUnavailableError'
  }
}

// One Ratelimit instance per distinct (limit, window) pair — creating
// them is a no-op for Upstash once Redis is shared, but caching the
// instance keeps allocation off the hot path.
const upstashLimiters = new Map<string, Ratelimit>()
function getUpstashLimiter(config: RateLimitConfig): Ratelimit | null {
  if (!redis) return null
  const key = `${config.limit}:${config.windowSeconds}`
  let limiter = upstashLimiters.get(key)
  if (!limiter) {
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(
        config.limit,
        `${config.windowSeconds} s`,
      ),
      analytics: false,
      prefix: 'kasero',
    })
    upstashLimiters.set(key, limiter)
  }
  return limiter
}

// ============================================
// IN-MEMORY FALLBACK
// ============================================

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

// Clean up expired entries every 5 minutes (fallback only).
const CLEANUP_INTERVAL = 5 * 60 * 1000
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt < now) {
      store.delete(key)
    }
  }
}, CLEANUP_INTERVAL)

function checkInMemory(
  identifier: string,
  config: RateLimitConfig,
): RateLimitResult {
  const now = Date.now()
  const windowMs = config.windowSeconds * 1000
  const entry = store.get(identifier)

  if (!entry || entry.resetAt < now) {
    const resetAt = now + windowMs
    store.set(identifier, { count: 1, resetAt })
    return {
      success: true,
      remaining: config.limit - 1,
      resetAt,
    }
  }

  if (entry.count >= config.limit) {
    return {
      success: false,
      remaining: 0,
      resetAt: entry.resetAt,
    }
  }

  entry.count++
  return {
    success: true,
    remaining: config.limit - entry.count,
    resetAt: entry.resetAt,
  }
}

// ============================================
// PUBLIC API
// ============================================

export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  limit: number
  /** Window size in seconds */
  windowSeconds: number
  /**
   * When true, a transient Upstash failure causes checkRateLimit to
   * THROW UpstashUnavailableError instead of silently falling back to
   * the per-Lambda in-memory limiter. Use for cost-/abuse-critical
   * limits (AI per-user daily, global AI daily kill-switch): better to
   * 503 the request than to disable spend protection during an Upstash
   * blip. For non-critical limiters (HEIC, business/user mutations,
   * code validation) leave unset — the in-memory fallback is
   * acceptable degradation.
   */
  failClosed?: boolean
}

interface RateLimitResult {
  success: boolean
  remaining: number
  resetAt: number
}

/**
 * Check if a request should be rate limited.
 *
 * @param identifier - Unique identifier (e.g., IP address, user ID)
 * @param config - Rate limit configuration
 * @returns Whether the request is allowed and remaining quota
 */
export async function checkRateLimit(
  identifier: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const limiter = getUpstashLimiter(config)
  if (limiter) {
    try {
      const result = await limiter.limit(identifier)
      return {
        success: result.success,
        remaining: result.remaining,
        resetAt: result.reset,
      }
    } catch (error) {
      // Two failure modes diverge here:
      //   - failClosed: throw UpstashUnavailableError so the calling
      //     route returns 503. Mandatory for auth limiters: silent
      //     fallback to per-Lambda counters during a brownout = no
      //     real rate limit at scale = brute force enabled.
      //   - !failClosed: log + fall back to in-memory. Acceptable for
      //     business mutations and AI routes where the in-memory cap
      //     is still meaningful per-Lambda.
      console.warn('Upstash rate-limit call failed:', error)
      if (config.failClosed) {
        throw new UpstashUnavailableError()
      }
    }
  }
  return checkInMemory(identifier, config)
}

/**
 * Get the trusted client IP from request headers.
 *
 * The previous implementation took the first hop of `x-forwarded-for`,
 * which a client can spoof unconditionally. On Vercel that worked
 * because Vercel rewrites the header at its edge — but anywhere else
 * (`npm run start:local`, a non-Vercel deploy, a future container
 * migration), an attacker rotating `X-Forwarded-For: <random>` per
 * request bypassed every per-IP rate limit (login brute-force,
 * register spam, invite-code guessing).
 *
 * Trust hierarchy (first match wins):
 *   1. `x-vercel-forwarded-for` — set by Vercel's edge from the
 *      verified TLS peer; not forwarded from upstream and so cannot
 *      be set by a client.
 *   2. `x-real-ip` — typically set by a trusted proxy (nginx,
 *      Cloudflare, Tailscale). On non-Vercel deploys this is the
 *      conventional way to surface the real client IP.
 *   3. The LAST hop of `x-forwarded-for`. The right-most entry is the
 *      one added by the closest trusted proxy; the left-most is what
 *      the upstream client claimed and is untrustworthy. The previous
 *      implementation took the LEFT-most — the spoofable one — so
 *      this swap is the security fix.
 *   4. Fallback `127.0.0.1` for environments where none of the above
 *      is present (dev curl). Not security-relevant in dev.
 *
 * DEPLOYMENT REQUIREMENT — non-Vercel: the upstream proxy MUST strip
 * any `x-forwarded-for` and `x-vercel-forwarded-for` it receives from
 * the client and APPEND its own observation. If your proxy passes the
 * client header through unchanged, this function is back to spoofable.
 */
export function getClientIp(request: Request): string {
  const vercel = request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim()
  if (vercel) return vercel

  const realIp = request.headers.get('x-real-ip')?.trim()
  if (realIp) return realIp

  const xff = request.headers.get('x-forwarded-for')
  if (xff) {
    const hops = xff.split(',').map((s) => s.trim()).filter(Boolean)
    const lastHop = hops[hops.length - 1]
    if (lastHop) return lastHop
  }

  return '127.0.0.1'
}

// Preset configurations for common use cases
export const RateLimits = {
  /** Code validation (invite, transfer): 10 per 15 minutes */
  codeValidation: { limit: 10, windowSeconds: 15 * 60 },
  /**
   * AI endpoints (generate-icon, identify-product, remove-background):
   * 20 per minute per user. Shared budget across the three routes, so a
   * user can't spread-then-burst. Each call is billable to fal.ai/OpenAI,
   * so the limit is intentionally tight.
   */
  ai: { limit: 20, windowSeconds: 60 },
  /**
   * AI per-user DAILY ceiling: 100 calls per user per 24 hours.
   * Layered on top of the per-minute cap. Mitigates the
   * "register fresh accounts to bypass per-user budget" attack: even
   * with N fake users, each is still bounded daily. failClosed
   * because the fal.ai/OpenAI cost amplification is unbounded
   * during an Upstash brownout otherwise (~$500/hour observed in
   * audit modeling for generate-icon at $0.04/call).
   */
  aiDaily: { limit: 100, windowSeconds: 24 * 60 * 60, failClosed: true },
  /**
   * AI per-user DAILY ceiling for Kasero Pro members: 400 calls per user
   * per 24 hours. Same failClosed rationale as aiDaily. IMPORTANT: use a
   * DISTINCT identifier prefix (`ai-daily-pro:` vs `ai-daily:`) at the
   * call site — the Upstash limiter instance is keyed on (limit, window),
   * so reusing the `ai-daily:` key with this config would silently share
   * a sliding window between the two tiers.
   */
  aiDailyPro: { limit: 400, windowSeconds: 24 * 60 * 60, failClosed: true },
  /**
   * GLOBAL AI daily kill-switch: 10000 calls per day across the whole
   * deployment. Single counter for ALL users; trips a circuit
   * breaker if attack traffic somehow saturates user-level limits
   * (large botnet, mass account creation). Tune downward if
   * organic usage stays well under this. failClosed for the same
   * cost-protection rationale as aiDaily.
   */
  aiGlobalDaily: { limit: 10_000, windowSeconds: 24 * 60 * 60, failClosed: true },
  /**
   * HEIC conversion: 30 per minute per user. Not billable externally, but
   * each call can buffer up to 30 MB into Lambda memory.
   */
  heic: { limit: 30, windowSeconds: 60 },
  /**
   * Ownership-transfer initiation: 5 per 15 minutes per user. Mitigates
   * account enumeration via the recipient-email lookup.
   */
  transferInitiate: { limit: 5, windowSeconds: 15 * 60 },
  /**
   * Kasero Pulse free-tier sample: 1 per ~35 days per business. The call
   * site stamps the key with the calendar month (`pulse-free:{biz}:{YYYY-MM}`)
   * so the sample actually resets on month boundaries regardless of the
   * sliding-window math — the 35-day window just guarantees the counter
   * outlives the longest month. failClosed: this is the paywall boundary,
   * and a fail-open fallback during an Upstash brownout would hand out
   * unmetered model calls on the free tier.
   */
  pulseFreeSample: { limit: 1, windowSeconds: 35 * 24 * 60 * 60, failClosed: true },
  /**
   * Promo-code redemption (Kasero Pro): 5 per hour per user. Brute-force
   * protection on the PRO_PROMO_CODES namespace — codes are short,
   * human-shareable strings, so the budget must stay tight. failClosed:
   * during an Upstash brownout the per-Lambda in-memory fallback would
   * effectively disable brute-force protection, and unlike AI routes a
   * blocked redeem attempt has no user-visible cost beyond a retry.
   */
  promoRedeem: { limit: 5, windowSeconds: 60 * 60, failClosed: true },
  /**
   * Business-scoped mutations (POST/PATCH/DELETE under
   * /api/businesses/[businessId]/**): 200 per minute per (user, business).
   * Generous for real workloads — bulk product onboarding from AI snap is
   * well under this — but tight enough to cap malicious delete loops.
   */
  businessMutation: { limit: 200, windowSeconds: 60 },
  /**
   * User-scoped mutations that aren't business-scoped (invite/join,
   * transfer/decline): 30 per minute per user. Legit paths are called
   * interactively and never in bulk.
   */
  userMutation: { limit: 30, windowSeconds: 60 },
  /**
   * Coarse per-IP mutation guardrail layered on top of user-keyed
   * limits. 600/min is well above any legitimate single-user
   * interactive load but tight enough to cap a single attacker who
   * registers N fresh accounts to bypass per-user budgets.
   */
  ipMutation: { limit: 600, windowSeconds: 60 },
  /**
   * Realtime SSE connect storms (GET /api/realtime). Each EventSource
   * stays open ~300s (Fluid Compute maxDuration), then the browser
   * reconnects automatically — so steady-state is ~12/hour/device.
   *
   * The limit must be FAR above the browser's auto-retry cadence (3s
   * default for EventSource). If a transient bug causes the SSE stream
   * to close immediately, EventSource retries every 3s = 20/min. A
   * tight limit means the rate limiter PERMANENTLY 429s the user once
   * tripped — because every retry within the sliding window keeps
   * refreshing the limit, and EventSource has no JS-controllable
   * backoff to escape the loop. 300/min/user gives ~15x headroom over
   * the worst-case auto-retry rate. NOT failClosed — an Upstash blip
   * should not lock a user out of the live layer.
   */
  realtimeConnect: { limit: 300, windowSeconds: 60 },
} as const
