import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Proxy — lightweight gate before page navigations.
 *
 * Session verification is delegated to `auth.api.getSession()` at the
 * route handler / page level. The proxy runtime is Node.js (Next.js 16
 * dropped edge support for this file convention; we always needed Node
 * for libsql + the Drizzle adapter anyway), so the most this layer does
 * is confirm that the better-auth session cookie is present and redirect
 * to / (EntryPage) when it isn't.
 *
 * Risk model: a present-but-revoked cookie reaches the page, then the
 * page's `getSession()` returns null, and the handler issues its own
 * 401 / redirect. The proxy just keeps unauthenticated traffic from
 * spending a Lambda invocation to find that out.
 *
 * Cookie names this proxy accepts:
 *   - "kasero.session_token"            (dev / non-secure)
 *   - "__Secure-kasero.session_token"   (production, useSecureCookies)
 *
 * Anything more elaborate (signature check, DB lookup, refresh) happens
 * inside the route handler, not here.
 */

const publicPaths = [
  '/',
  '/auth',
  '/join',
]

function isPublicPath(pathname: string): boolean {
  return publicPaths.some(p => pathname === p || pathname.startsWith(`${p}/`))
}

function shouldSkip(pathname: string): boolean {
  return (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/') ||
    pathname.includes('.')
  )
}

const BUSINESS_ID_RE = /^[A-Za-z0-9_-]{21}$/

const SESSION_COOKIE_RE = /(?:^|;\s*)(?:__Secure-)?kasero\.session_token=[^;\s]+/

function hasSessionCookie(request: NextRequest): boolean {
  const header = request.headers.get('cookie')
  if (!header) return false
  return SESSION_COOKIE_RE.test(header)
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (shouldSkip(pathname)) return NextResponse.next()
  if (isPublicPath(pathname)) return NextResponse.next()

  if (!hasSessionCookie(request)) {
    const entryUrl = new URL('/', request.url)
    entryUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(entryUrl)
  }

  // Defense in depth for /<businessId>/* page routes: reject obviously
  // malformed business id segments (e.g. a 1MB path) before the page
  // handler bothers querying the DB. The full membership check still
  // runs server-side in withBusinessAuth.
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length > 0) {
    const first = segments[0]
    const knownRoutes = ['account', 'business', 'auth', 'join']
    if (!knownRoutes.includes(first) && !BUSINESS_ID_RE.test(first)) {
      return NextResponse.redirect(new URL('/', request.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    // Anything not /api/*, not /_next/*, not a static asset.
    '/((?!api/|_next/|.*\\.).*)',
  ],
}
