import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { APIError } from 'better-auth/api'
import { auth } from '@/lib/auth'
import {
  applyRateLimit,
  enforceMaxContentLength,
  errorResponse,
  successResponse,
  validationError,
} from '@/lib/api-middleware'
import { RateLimits, getClientIp } from '@/lib/rate-limit'
import {
  consumePkceChallenge,
  deriveChallenge,
  challengesMatch,
} from '@/lib/native-token-store'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { logServerError } from '@/lib/server-logger'

/**
 * Native OAuth verify wrapper (PKCE-gated one-time-token redemption).
 *
 * The native app calls this on `appUrlOpen` after receiving the
 * `kasero://auth-callback?ott=...` deep link. It presents BOTH the ott and
 * its secret `code_verifier`. We:
 *   1. Consume (single-use) the `code_challenge` the auth-callback route
 *      bound to this ott.
 *   2. Reject unless SHA-256(verifier) equals that challenge (PKCE). An app
 *      that intercepted the deep link has the ott but not the verifier.
 *   3. Redeem the ott via better-auth's one-time-token verify, capturing
 *      the `set-auth-token` header the bearer plugin emits, and hand it
 *      back to the native client (which persists it as its session token).
 *
 * Public route: the caller is NOT yet authenticated in the WebView (this
 * is how it BECOMES authenticated). Security rests on the ott+verifier
 * secret pair, not ambient auth — a cross-site caller can neither supply a
 * valid pair nor read the response (CORS). Per-IP rate-limited. The ott,
 * verifier, and set-auth-token are NEVER logged.
 */

const MAX_BODY_BYTES = 4 * 1024

const verifySchema = z.object({
  // The better-auth one-time token from the deep link.
  token: z.string().min(10).max(256),
  // The PKCE code_verifier (client random, base64url).
  verifier: z.string().min(32).max(256),
})

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Per-IP throttle: legitimate redemption happens a handful of times
    // ever per user; this caps brute-force probing of ott/verifier pairs.
    const clientIp = getClientIp(request)
    const rateLimited = await applyRateLimit(
      `native-oauth-verify:${clientIp}`,
      RateLimits.userMutation,
    )
    if (rateLimited) return rateLimited

    const oversize = enforceMaxContentLength(request, MAX_BODY_BYTES)
    if (oversize) return oversize

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return errorResponse(ApiMessageCode.VALIDATION_GENERIC, 400)
    }
    const parsed = verifySchema.safeParse(body)
    if (!parsed.success) return validationError(parsed)
    const { token, verifier } = parsed.data

    // PKCE check (single-use consume). Missing binding => unknown/expired/
    // replayed ott, or an interceptor that never went through the mint.
    const storedChallenge = await consumePkceChallenge(token)
    if (!storedChallenge) {
      return errorResponse(ApiMessageCode.UNAUTHORIZED, 401)
    }
    if (!challengesMatch(deriveChallenge(verifier), storedChallenge)) {
      return errorResponse(ApiMessageCode.UNAUTHORIZED, 401)
    }

    // Redeem the ott via better-auth. `returnHeaders` surfaces the
    // `set-auth-token` header the bearer plugin attaches when the verify
    // sets the session cookie. We forward ONLY that header to the client
    // (native uses the bearer token, not the cookie).
    let setAuthToken: string | null = null
    try {
      const { headers } = await auth.api.verifyOneTimeToken({
        body: { token },
        headers: request.headers,
        returnHeaders: true,
      })
      setAuthToken = headers.get('set-auth-token')
    } catch (err) {
      // Invalid / expired / already-consumed ott -> better-auth throws.
      if (err instanceof APIError) {
        return errorResponse(ApiMessageCode.UNAUTHORIZED, 401)
      }
      throw err
    }

    if (!setAuthToken) {
      return errorResponse(ApiMessageCode.UNAUTHORIZED, 401)
    }

    const response = successResponse({})
    // The native app reads the session token from this header (exposed to
    // the WebView via the proxy's Access-Control-Expose-Headers).
    response.headers.set('set-auth-token', setAuthToken)
    return response
  } catch (err) {
    logServerError('api.native.auth-callback.verify', err)
    return errorResponse(ApiMessageCode.INTERNAL_ERROR, 500)
  }
}
