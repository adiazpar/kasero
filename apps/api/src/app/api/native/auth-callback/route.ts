import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { applyRateLimit } from '@/lib/api-middleware'
import { RateLimits } from '@/lib/rate-limit'
import { storePkceChallenge } from '@/lib/native-token-store'
import { logServerError } from '@/lib/server-logger'

/**
 * Native OAuth bridge (with PKCE binding).
 *
 * The Capacitor app runs social sign-in in the SYSTEM browser (Apple and
 * Google both reject WebView OAuth). better-auth completes the OAuth
 * round-trip there and sets the session cookie in the system browser's
 * cookie jar — useless to the app's WebView. The app therefore points
 * `callbackURL` at this route: still inside the system browser (where the
 * fresh cookie IS attached), we mint a single-use one-time token and
 * bounce it into the app via the kasero:// deep link. The app redeems it
 * at POST /api/native/auth-callback/verify, whose response carries the
 * bearer session token in the `set-auth-token` header (bearer plugin).
 *
 * PKCE HARDENING (FINDING 1). The custom `kasero://` scheme can be
 * intercepted by any app that registers it, and this GET is reachable by
 * a cross-site top-level navigation (SameSite=Lax cookies attach, and a
 * GET skips the same-origin CSRF check). Two mitigations, both required:
 *
 *   1. The app derives `code_challenge = base64url(SHA-256(code_verifier))`
 *      from a secret it keeps, and passes the challenge through the OAuth
 *      round-trip via the callbackURL query. This route BINDS the challenge
 *      to the minted ott. Redemption requires the verifier — an interceptor
 *      that captured only the ott cannot redeem.
 *   2. This mint REQUIRES a challenge (missing/malformed -> 400). A blind
 *      cross-site navigation carries no challenge, so it cannot mint a
 *      redeemable token; an attacker would have to supply a challenge
 *      whose verifier only the real app holds.
 *
 * Universal Links / App Links (verified domain association) is the
 * strategic follow-up that removes custom-scheme interception entirely;
 * PKCE is the defense-in-depth shipping now. See capacitor-native.md.
 *
 * This is a browser NAVIGATION endpoint, not a fetch API — responses are
 * redirects (or a bare 4xx for the pre-flight guards), not ApiMessageCode
 * JSON envelopes (there is no JS on the other end to read one). Errors are
 * otherwise signaled via an `error` query param on the deep link so the
 * app can reset its pending UI.
 *
 * SECURITY: the one-time token is single-use and short-lived. It must
 * NEVER be logged — do not add logging that includes the redirect URL or
 * the challenge.
 */

const DEEP_LINK_BASE = 'kasero://auth-callback'

// base64url(SHA-256(x)) is exactly 43 chars in the [A-Za-z0-9_-] alphabet
// (32 bytes, no padding). Reject anything else before it reaches storage.
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const challenge = new URL(request.url).searchParams.get('challenge')
    // Require a well-formed PKCE challenge on the mint. A cross-site
    // navigation that blindly hits this route carries none -> 400, so it
    // cannot mint a redeemable token. This is a bare 400 (not a deep-link
    // redirect): the legitimate app always supplies a challenge, and we
    // do not want to bounce an attacker-triggered navigation into the app.
    if (!challenge || !CHALLENGE_RE.test(challenge)) {
      return new NextResponse(null, { status: 400 })
    }

    const session = await auth.api.getSession({ headers: request.headers })
    if (!session) {
      return NextResponse.redirect(`${DEEP_LINK_BASE}?error=unauthorized`)
    }

    // Modest per-user budget; a legitimate user completes OAuth a handful
    // of times, ever. Reuses the interactive-mutation preset (30/min).
    const rateLimited = await applyRateLimit(
      `native-auth-callback:${session.user.id}`,
      RateLimits.userMutation,
    )
    if (rateLimited) {
      return NextResponse.redirect(`${DEEP_LINK_BASE}?error=rate_limited`)
    }

    const { token } = await auth.api.generateOneTimeToken({
      headers: request.headers,
    })
    // Bind the challenge to the ott (short TTL, single-use). The verify
    // route rejects unless SHA-256(verifier) matches this challenge.
    await storePkceChallenge(token, challenge)

    return NextResponse.redirect(
      `${DEEP_LINK_BASE}?ott=${encodeURIComponent(token)}`,
    )
  } catch (err) {
    logServerError('api.native.auth-callback', err)
    return NextResponse.redirect(`${DEEP_LINK_BASE}?error=internal`)
  }
}
