/**
 * API route middleware utilities.
 *
 * Provides wrappers and helpers to reduce boilerplate in API routes,
 * plus the canonical response helpers that emit ApiMessageEnvelope
 * bodies for i18n-aware error and success messages.
 */

import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireBusinessAccess, type BusinessAccess } from './business-auth'
import { ApiMessageCode, type ApiMessageEnvelope } from '@kasero/shared/api-messages'
import { auth } from './auth'
import { isNativeAppOrigin } from './native-origins'
import { checkRateLimit, getClientIp, RateLimits, UpstashUnavailableError, type RateLimitConfig } from './rate-limit'
import { logServerError } from './server-logger'

// ============================================
// ROUTE PARAMETER TYPES
// ============================================

/**
 * Standard route params for business-scoped routes.
 */
export interface RouteParams {
  params: Promise<{
    businessId: string
  }>
}

/**
 * The shape passed to user-scoped handler functions wrapped with withAuth.
 * Field names are normalized from the better-auth session — `userId`
 * (not `id`) so call sites in business-auth and elsewhere don't need to
 * branch on which auth surface they came from. `withAuth` translates
 * better-auth's `session.user.{id,email,emailVerified,name,language}`
 * into this shape.
 */
export interface AuthedUser {
  userId: string
  email: string
  emailVerified: boolean
  name: string
  language: string
}

// ============================================
// CSRF DEFENSE-IN-DEPTH
// ============================================

/**
 * Reject any non-GET/HEAD request whose Origin or Referer doesn't
 * match the request URL's origin.
 *
 * Auth cookies are SameSite=Lax which is the primary CSRF defense
 * against cross-site mutations — but multipart POST is still one of
 * the three "simple" content types and would be form-CSRF-able if
 * SameSite ever weakens (e.g., a future change to support iframe
 * embedding sets SameSite=None). This helper is the second line of
 * defense: even if a cookie reaches a route via a cross-site
 * navigation, the Origin header doesn't match and the request is
 * rejected before any state mutation happens.
 *
 * Returns null if the request passes; otherwise returns a 403
 * response the route should bubble up.
 */
// Native (Capacitor) WebView origins live in @/lib/native-origins — the
// single source of truth shared with proxy.ts, realtime/route.ts, and
// auth.ts. `isNativeAppOrigin` accepts an exact origin match or an
// origin-prefixed Referer. This is an explicit, exact-match allowlist for
// the native app only — the browser same-origin rule below is unchanged,
// and requests from these origins authenticate via the bearer plugin
// (Authorization header), not cookies, so it is not a cookie-CSRF vector.

function enforceSameOrigin(request: NextRequest): NextResponse | null {
  if (request.method === 'GET' || request.method === 'HEAD') return null
  const origin = request.headers.get('origin') ?? request.headers.get('referer')
  if (!origin) {
    // Missing both headers: this is unusual for a real browser
    // making a same-origin request (Origin is sent on virtually
    // every non-GET fetch since 2020) and is the shape of a curl /
    // server-to-server call. Reject with 403 — legitimate clients
    // can re-issue with the proper header set automatically by the
    // browser.
    return errorResponse(ApiMessageCode.FORBIDDEN, 403)
  }

  // Capacitor-native app: exact-match allowlist (see NATIVE_APP_ORIGINS).
  // The startsWith form covers the Referer header, which carries a path.
  if (isNativeAppOrigin(origin)) return null

  // Build the expected origin from the request's user-facing host, NOT
  // from `new URL(request.url).origin`. In Next.js's Edge runtime,
  // `request.url` reflects the API server's actual binding (e.g.
  // `https://localhost:8000`), not the host the browser actually
  // talked to. In Vercel production, the user hits the public domain
  // and Vercel rewrites internally; X-Forwarded-Host carries the
  // public hostname. In Vite dev with a Tailscale device, Vite forwards
  // requests to localhost:8000 but preserves the original Host header
  // (we explicitly disabled changeOrigin for this reason). Either way,
  // the host the BROWSER thinks it's talking to is what the Origin
  // header reflects, and that's what we must compare against.
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (!host) {
    return errorResponse(ApiMessageCode.FORBIDDEN, 403)
  }
  // Protocol: prefer X-Forwarded-Proto (set by Vercel and most proxies);
  // fall back to the request's actual protocol, which matches the
  // server's listening protocol. In dev with HTTPS Tailscale certs, the
  // listener is https; in plain localhost dev, it's http; both match the
  // proxy's external scheme because Vite serves on the same protocol it
  // proxies through.
  const protocol = request.headers.get('x-forwarded-proto')
    ?? new URL(request.url).protocol.replace(':', '')
  const allowedOrigin = `${protocol}://${host}`

  // Use startsWith on Origin (which has no trailing path) and a
  // strict origin-prefix match on Referer (which may include path).
  if (!origin.startsWith(allowedOrigin)) {
    return errorResponse(ApiMessageCode.FORBIDDEN, 403)
  }
  return null
}

// ============================================
// USER AUTH WRAPPER
// ============================================

type UserRouteHandler = (
  request: NextRequest,
  user: AuthedUser,
) => Promise<NextResponse>

/**
 * Wraps a route handler with user-level authentication (no business scope).
 *
 * Use for routes that need a logged-in user but aren't tied to a specific
 * business — e.g. AI / HEIC pipelines, account-level operations that don't
 * fit under `/businesses/[businessId]/*`.
 *
 * Default mutation guard: on non-GET/HEAD methods the wrapper applies
 * RateLimits.userMutation keyed on userId (30/min) AND a coarse per-IP
 * cap (600/min). The per-IP cap stops a botnet from spreading work
 * across N fresh accounts to bypass the per-user budget. Routes that
 * need custom limits (login uses a stricter login bucket; AI uses a
 * tighter ai bucket; auth/me DELETE uses a login-shaped bucket) can
 * opt out via `{ rateLimit: false }` and call applyRateLimit themselves.
 *
 * On failure returns UNAUTHORIZED 401. Rare framework errors return
 * INTERNAL_ERROR 500.
 */
// Default body size cap applied by both wrappers. 256 KB is plenty
// for any JSON-only route (the largest realistic body on this app is
// a list of order items or a paste of provider notes). Routes that
// accept media uploads override via `{ maxBodyBytes: <bigger> }`.
const DEFAULT_MAX_BODY_BYTES = 256 * 1024

// URL-segment validator. nanoid uses the alphabet [A-Za-z0-9_-]; the
// length is 21 by default but we accept 12-64 to leave room for
// legacy IDs and future migration. Used by withBusinessAuth before
// businessId reaches Drizzle so a 1 MB segment can't drive a full-
// string compare per request (audit L-3).
const URL_ID_SEGMENT = /^[A-Za-z0-9_-]{12,64}$/

function isValidUrlIdSegment(value: string | undefined): value is string {
  return typeof value === 'string' && URL_ID_SEGMENT.test(value)
}

export function withAuth(
  handler: UserRouteHandler,
  options: { rateLimit?: false; maxBodyBytes?: number; allowUnverified?: boolean } = {},
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      // CSRF defense-in-depth fires BEFORE auth lookup so a cross-
      // site request can't even probe for "is the cookie still
      // valid?" via response timing.
      const csrfReject = enforceSameOrigin(request)
      if (csrfReject) return csrfReject

      // Body-size guard. Fires for non-GET/HEAD/DELETE; the cap is
      // either the route-supplied override or the default 256 KB.
      // Routes that pre-validated body already (legacy callers that
      // call enforceMaxContentLength themselves) re-trip safely —
      // this is idempotent.
      //
      // DELETE is exempted because the method is semantically bodyless
      // and some clients (notably iOS Safari and iOS PWAs) omit the
      // Content-Length header on DELETE. Without this exemption every
      // DELETE from those clients 411s with REQUEST_LENGTH_REQUIRED.
      if (
        request.method !== 'GET' &&
        request.method !== 'HEAD' &&
        request.method !== 'DELETE'
      ) {
        const cap = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
        const oversize = enforceMaxContentLength(request, cap)
        if (oversize) return oversize
      }

      const session = await auth.api.getSession({ headers: request.headers })
      if (!session) return errorResponse(ApiMessageCode.UNAUTHORIZED, 401)

      const sessionUser = session.user as {
        id: string
        email: string
        emailVerified: boolean
        name: string
        language?: string
      }

      if (!options.allowUnverified && !sessionUser.emailVerified) {
        return errorResponse(ApiMessageCode.EMAIL_NOT_VERIFIED, 403)
      }

      const user: AuthedUser = {
        userId: sessionUser.id,
        email: sessionUser.email,
        emailVerified: sessionUser.emailVerified,
        name: sessionUser.name,
        language: sessionUser.language ?? 'en-US',
      }

      if (
        options.rateLimit !== false &&
        request.method !== 'GET' &&
        request.method !== 'HEAD'
      ) {
        // Per-user mutation cap. Mirrors the protection withBusinessAuth
        // applies to /businesses/[businessId]/* mutations; without this,
        // /api/user/language was unrate-limited
        // and an attacker with a stolen cookie could hammer them
        // unconstrained.
        const userLimited = await applyRateLimit(
          `user-mutation:${user.userId}`,
          RateLimits.userMutation,
        )
        if (userLimited) return userLimited
        // Coarse per-IP guardrail. The user-keyed limit above is
        // bypassable by an attacker spreading load across many fresh
        // accounts; a per-IP cap is the second line of defense.
        const ip = getClientIp(request)
        const ipLimited = await applyRateLimit(
          `ip-mutation:${ip}`,
          RateLimits.ipMutation,
        )
        if (ipLimited) return ipLimited
      }

      return await handler(request, user)
    } catch (error) {
      logServerError('api.with-auth', error)
      return errorResponse(ApiMessageCode.INTERNAL_ERROR, 500)
    }
  }
}

// ============================================
// RATE LIMITING HELPER
// ============================================

/**
 * Apply a rate limit check to a request. Returns a 429 NextResponse if the
 * caller is over their budget, or `null` if the request may proceed.
 *
 * The `Retry-After` header is populated so well-behaved clients back off
 * at the correct interval.
 *
 * Async because `checkRateLimit` may call Upstash over the network when
 * Redis credentials are configured. In-memory fallback resolves
 * synchronously; the await is effectively a no-op in that case.
 *
 * @example
 *   const rl = await applyRateLimit(`ai:${user.userId}`, RateLimits.ai)
 *   if (rl) return rl
 */
export async function applyRateLimit(
  identifier: string,
  config: RateLimitConfig,
  rateLimitedCode: ApiMessageCode = ApiMessageCode.RATE_LIMITED,
): Promise<NextResponse | null> {
  let result
  try {
    result = await checkRateLimit(identifier, config)
  } catch (err) {
    // Fail-closed limiters (auth-critical) throw when Upstash is
    // unreachable. Translate to a 503 with a sensible Retry-After
    // instead of falling back to in-memory and silently disabling
    // brute-force protection.
    if (err instanceof UpstashUnavailableError) {
      const response = errorResponse(ApiMessageCode.RATE_LIMITER_UNAVAILABLE, 503)
      response.headers.set('Retry-After', '5')
      return response
    }
    throw err
  }
  if (result.success) return null
  const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))
  const response = errorResponse(rateLimitedCode, 429)
  response.headers.set('Retry-After', String(retryAfter))
  return response
}

// ============================================
// BODY SIZE GUARD
// ============================================

/**
 * Reject the request before reading the body if the declared
 * Content-Length exceeds `maxBytes`. Returns a 413 NextResponse to send,
 * or `null` if the request is within the limit.
 *
 * This runs BEFORE `request.formData()` / `request.arrayBuffer()` /
 * `request.json()` so the Lambda never buffers an oversized body into
 * memory. A missing Content-Length is rejected with 411 — we require a
 * declared length to be able to cap it up front.
 *
 * @example
 *   const oversize = enforceMaxContentLength(request, 5 * 1024 * 1024)
 *   if (oversize) return oversize
 */
export function enforceMaxContentLength(
  request: NextRequest,
  maxBytes: number,
): NextResponse | null {
  const header = request.headers.get('content-length')
  if (header === null) {
    return errorResponse(ApiMessageCode.REQUEST_LENGTH_REQUIRED, 411)
  }
  const length = Number(header)
  if (!Number.isFinite(length) || length < 0) {
    return errorResponse(ApiMessageCode.REQUEST_LENGTH_REQUIRED, 411)
  }
  if (length > maxBytes) {
    return errorResponse(ApiMessageCode.REQUEST_TOO_LARGE, 413)
  }
  return null
}

// ============================================
// BUSINESS AUTH WRAPPER
// ============================================

type BusinessRouteHandler = (
  request: NextRequest,
  access: BusinessAccess,
  params: Record<string, string>
) => Promise<NextResponse>

/**
 * Wraps an API route handler with business authentication.
 *
 * Handles:
 * - Extracting and validating businessId from route params
 * - Calling requireBusinessAccess for authorization
 * - Standard error responses for Unauthorized/Not found/Server errors
 */
export function withBusinessAuth(
  handler: BusinessRouteHandler,
  options: { maxBodyBytes?: number } = {},
) {
  return async (
    request: NextRequest,
    { params }: { params: Promise<Record<string, string>> }
  ) => {
    try {
      // CSRF defense-in-depth — see enforceSameOrigin and the H-15
      // audit finding for context. Fires before the access lookup
      // for the same reason as withAuth: response-time probing.
      const csrfReject = enforceSameOrigin(request)
      if (csrfReject) return csrfReject

      // Body-size backstop. Most business routes parse small JSON;
      // file-upload routes (products POST/PATCH with up to 5 MB icons)
      // override the cap explicitly. Without this default, dozens of
      // routes were unbounded in the audit (H-16).
      //
      // DELETE is exempted — see the matching note in `withAuth`
      // above (iOS Safari / iOS PWA omits Content-Length on DELETE).
      if (
        request.method !== 'GET' &&
        request.method !== 'HEAD' &&
        request.method !== 'DELETE'
      ) {
        const cap = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
        const oversize = enforceMaxContentLength(request, cap)
        if (oversize) return oversize
      }

      const resolvedParams = await params
      const { businessId, ...restParams } = resolvedParams
      // URL-segment format check (audit L-3): businessIds are
      // nanoids in the [A-Za-z0-9_-] alphabet. Without this guard
      // an attacker passing a 1 MB businessId would force a
      // full-length DB string compare on every requireBusinessAccess
      // call; reject early with 400.
      if (!isValidUrlIdSegment(businessId)) {
        return errorResponse(ApiMessageCode.BUSINESS_NOT_FOUND, 404)
      }
      const access = await requireBusinessAccess(businessId)

      // Rate-limit writes per (user, business). Reads are unbounded so
      // legit polling / navigation never hits 429, but POST/PATCH/DELETE
      // caps out at RateLimits.businessMutation. Keyed per-business so a
      // partner in two businesses doesn't contend with themselves.
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        const rateLimited = await applyRateLimit(
          `mutate:${access.userId}:${access.businessId}`,
          RateLimits.businessMutation,
        )
        if (rateLimited) return rateLimited
      }

      return await handler(request, access, restParams)
    } catch (error) {
      if (error instanceof Error) {
        // Split 401 "not authenticated" from 403 "no membership" so
        // clients can distinguish re-login-required from permission-
        // denied. requireBusinessAccess throws distinct messages.
        if (error.message.includes('Not authenticated')) {
          return errorResponse(ApiMessageCode.UNAUTHORIZED, 401)
        }
        if (error.message.includes('Email not verified')) {
          return errorResponse(ApiMessageCode.EMAIL_NOT_VERIFIED, 403)
        }
        if (error.message.includes('No access')) {
          return errorResponse(ApiMessageCode.FORBIDDEN, 403)
        }
        if (error.message.includes('Not found')) {
          return errorResponse(ApiMessageCode.NOT_FOUND, 404)
        }
      }
      logServerError('api.with-business-auth', error)
      return errorResponse(ApiMessageCode.INTERNAL_ERROR, 500)
    }
  }
}

// ============================================
// ENVELOPE RESPONSE HELPERS
// ============================================

/**
 * Build a structured error response body with a message code.
 *
 * @example
 *   return errorResponse(ApiMessageCode.PRODUCT_NOT_FOUND, 404)
 *   return errorResponse(ApiMessageCode.VALIDATION_STRING_TOO_SHORT, 400, { min: 2 })
 */
export function errorResponse(
  code: ApiMessageCode,
  status: number,
  vars?: Record<string, string | number>,
): NextResponse {
  const body: ApiMessageEnvelope = { messageCode: code }
  if (vars) body.messageVars = vars
  return NextResponse.json(body, { status })
}

/**
 * Build a structured success response that merges route data with an
 * optional message code for toast / feedback rendering on the client.
 *
 * Includes `success: true` so legacy consumers that check `data.success`
 * continue to work during the migration. Remove when all consumers have
 * switched to `response.ok` checks.
 *
 * @example
 *   return successResponse({ user }, ApiMessageCode.AUTH_LOGIN_SUCCESS)
 *   return successResponse({ products })  // no toast — just data
 */
export function successResponse(
  data: Record<string, unknown>,
  code?: ApiMessageCode,
  vars?: Record<string, string | number>,
): NextResponse {
  const body: Record<string, unknown> = { success: true, ...data }
  if (code) body.messageCode = code
  if (vars) body.messageVars = vars
  return NextResponse.json(body)
}

// ============================================
// ZOD ISSUE -> MESSAGE CODE MAPPING
// ============================================

/**
 * Map a Zod issue to an ApiMessageEnvelope. Called by validationError().
 * Returns null when the issue doesn't match a known pattern; the caller
 * falls back to VALIDATION_GENERIC.
 *
 * Handles the common Zod v4 issue codes: too_small / too_big (for strings
 * and numbers), invalid_format (email), invalid_type. Also handles custom
 * refine() issues that attach a `params.apiMessageCode` -- any refine can
 * emit any ApiMessageCode by adding `params: { apiMessageCode: '...' }`
 * as the second argument. Extend this function as new Zod constraints
 * are introduced.
 */
function mapZodIssueToEnvelope(issue: z.core.$ZodIssue): ApiMessageEnvelope | null {
  // Custom refine() calls can pass through an explicit code via the
  // `params` field. This is how refine errors map to the i18n layer.
  if (issue.code === 'custom') {
    const params = (issue as z.core.$ZodIssue & { params?: unknown }).params
    if (
      params &&
      typeof params === 'object' &&
      'apiMessageCode' in params &&
      typeof (params as { apiMessageCode: unknown }).apiMessageCode === 'string'
    ) {
      const code = (params as { apiMessageCode: string }).apiMessageCode
      // We trust the refine author to use a real ApiMessageCode value.
      // The i18n typecheck will catch unknown keys at render time.
      return { messageCode: code as ApiMessageCode }
    }
    return null
  }

  switch (issue.code) {
    case 'too_small': {
      const min = Number(issue.minimum ?? 0)
      if (issue.origin === 'string') {
        return {
          messageCode: ApiMessageCode.VALIDATION_STRING_TOO_SHORT,
          messageVars: { min },
        }
      }
      if (issue.origin === 'number') {
        return {
          messageCode: ApiMessageCode.VALIDATION_NUMBER_TOO_SMALL,
          messageVars: { min },
        }
      }
      return null
    }
    case 'too_big': {
      const max = Number(issue.maximum ?? 0)
      if (issue.origin === 'string') {
        return {
          messageCode: ApiMessageCode.VALIDATION_STRING_TOO_LONG,
          messageVars: { max },
        }
      }
      if (issue.origin === 'number') {
        return {
          messageCode: ApiMessageCode.VALIDATION_NUMBER_TOO_LARGE,
          messageVars: { max },
        }
      }
      return null
    }
    case 'invalid_format': {
      const format = issue.format
      if (format === 'email') {
        return { messageCode: ApiMessageCode.VALIDATION_INVALID_EMAIL }
      }
      return { messageCode: ApiMessageCode.VALIDATION_INVALID_FORMAT }
    }
    case 'invalid_type': {
      // Zod v4 reports missing required fields as invalid_type with received === 'undefined'
      if (issue.input === undefined) {
        return { messageCode: ApiMessageCode.VALIDATION_REQUIRED }
      }
      return { messageCode: ApiMessageCode.VALIDATION_INVALID_TYPE }
    }
    default:
      return null
  }
}

/**
 * Creates a validation error response from a Zod parse result.
 *
 * Emits the new ApiMessageEnvelope shape. The first issue is mapped to
 * a concrete code where possible; otherwise falls back to
 * VALIDATION_GENERIC.
 *
 * @example
 * ```typescript
 * const validation = schema.safeParse(body)
 * if (!validation.success) {
 *   return validationError(validation)
 * }
 * ```
 */
export function validationError(
  result: z.ZodSafeParseResult<unknown>
): NextResponse {
  if (result.success) {
    return errorResponse(ApiMessageCode.VALIDATION_GENERIC, 400)
  }
  const firstIssue = result.error.issues[0]
  const envelope = firstIssue ? mapZodIssueToEnvelope(firstIssue) : null
  if (envelope) {
    return NextResponse.json(envelope, { status: 400 })
  }
  return errorResponse(ApiMessageCode.VALIDATION_GENERIC, 400)
}

