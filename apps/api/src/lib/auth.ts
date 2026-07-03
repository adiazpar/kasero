import 'server-only'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { bearer, emailOTP, oneTimeToken } from 'better-auth/plugins'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { eq } from 'drizzle-orm'
import { Redis } from '@upstash/redis'
import { db } from '@/db'
import * as schema from '@kasero/shared/db/schema'
import { NATIVE_APP_ORIGINS } from './native-origins'
import { sendVerificationEmail } from './email'
import { mintAppleClientSecret } from './apple-client-secret'
import { getAppReviewOTP, isAppReviewEmail } from './app-review'
import { revokeAppleTokensForUser } from './apple-revoke'

async function lookupUserLanguage(email: string): Promise<string> {
  try {
    const row = await db
      .select({ language: schema.users.language })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1)
    return row[0]?.language ?? 'en-US'
  } catch {
    return 'en-US'
  }
}

// Loose typing here because the apple provider takes a different shape
// (extra appBundleIdentifier field) than Google's clientId/clientSecret pair.
const socialProviders: Record<string, Record<string, unknown>> = {}

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  }
}

if (
  process.env.APPLE_CLIENT_ID &&
  process.env.APPLE_TEAM_ID &&
  process.env.APPLE_KEY_ID &&
  process.env.APPLE_PRIVATE_KEY
) {
  // better-auth's apple provider only accepts a string clientSecret (a
  // pre-built JWT). We mint it at module load so there's no 6-month human
  // rotation. Vercel cold-starts re-mint; the JWT itself expires in 1h.
  // See node_modules/@better-auth/core/dist/social-providers/apple.d.mts
  // for the AppleOptions interface.
  try {
    const appleClientSecret = await mintAppleClientSecret({
      teamId: process.env.APPLE_TEAM_ID,
      clientId: process.env.APPLE_CLIENT_ID,
      keyId: process.env.APPLE_KEY_ID,
      privateKey: process.env.APPLE_PRIVATE_KEY,
    })

    socialProviders.apple = {
      clientId: process.env.APPLE_CLIENT_ID,
      clientSecret: appleClientSecret,
      ...(process.env.APPLE_APP_BUNDLE_IDENTIFIER && {
        appBundleIdentifier: process.env.APPLE_APP_BUNDLE_IDENTIFIER,
      }),
    }
  } catch (err) {
    // Fail loudly in production — a malformed APPLE_PRIVATE_KEY there must
    // surface as a deploy failure, not silently disable Apple sign-in
    // (.claude/docs/apple-sign-in-setup.md). Non-prod swallows so a
    // partially-pasted .p8 in .env.local doesn't take down email-OTP and
    // Google routes alongside Apple.
    if (process.env.NODE_ENV === 'production') throw err
    console.error('[auth] Failed to initialize Apple provider, dropping it:', err)
  }
}

// Shared Upstash client. Only enabled in production / when env vars are set.
// In dev without Upstash creds, secondaryStorage is undefined and better-auth
// falls back to in-memory (acceptable for local development).
const redisClient =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null

// better-auth's secondaryStorage interface. We use a key-prefix so kasero's
// keys don't collide with the @upstash/ratelimit keys (which use prefix
// `kasero` — see rate-limit.ts:91). Different prefix here intentionally.
const secondaryStorage: NonNullable<Parameters<typeof betterAuth>[0]['secondaryStorage']> | undefined =
  redisClient
    ? {
        get: async (key: string) => {
          const value = await redisClient.get(`kasero:ba:${key}`)
          // Upstash @upstash/redis auto-deserializes JSON; coerce to string
          // for better-auth which expects either a string or null.
          if (value === null || value === undefined) return null
          if (typeof value === 'string') return value
          return JSON.stringify(value)
        },
        set: async (key: string, value: string, ttl?: number) => {
          if (typeof ttl === 'number' && ttl > 0) {
            await redisClient.set(`kasero:ba:${key}`, value, { ex: ttl })
          } else {
            await redisClient.set(`kasero:ba:${key}`, value)
          }
        },
        delete: async (key: string) => {
          await redisClient.del(`kasero:ba:${key}`)
        },
      }
    : undefined

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'sqlite',
    schema: {
      ...schema,
      user: schema.users,
    },
  }),

  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:8000',
  secret: process.env.AUTH_SECRET ?? '',

  // Origins beyond `baseURL` that better-auth's CSRF check should accept.
  // Comma-separated list in BETTER_AUTH_TRUSTED_ORIGINS, plus an always-on
  // dev set (localhost:3000 = Vite SPA, localhost:8000 = API). Production
  // is same-origin via the Vercel deploy and falls back to baseURL alone.
  trustedOrigins: [
    'http://localhost:3000',
    'http://localhost:8000',
    // Capacitor-native WebView origins (single source of truth in
    // @/lib/native-origins). better-auth's origin check must accept them
    // or every native sign-in POST 403s. An explicit exact-match
    // allowlist, never a wildcard; the browser same-origin flow is
    // unaffected.
    ...NATIVE_APP_ORIGINS,
    ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? []),
  ],

  // Reuse Upstash Redis for better-auth's short-lived auth data —
  // rate-limit counters only (see rateLimit.storage below).
  // Sessions and verification records intentionally stay in Turso because:
  //   - Open bugs in better-auth's secondary-storage handling of those:
  //     #8893 (verification model removed from adapter schema breaks
  //     our change-email direct DB query), #4721 (email-verified flag
  //     not synced), #1368 (email-change cache invalidation).
  // If secondaryStorage is undefined (no Upstash creds in dev), better-auth
  // silently falls back to in-memory rate-limiting which is fine locally.
  secondaryStorage,

  user: {
    modelName: 'users',
    fields: { image: 'avatar' },
    additionalFields: {
      language: { type: 'string', required: false, defaultValue: 'en-US', input: true },
      phoneNumber: { type: 'string', required: false, input: true },
      phoneNumberVerified: { type: 'boolean', required: false, defaultValue: false, input: false },
    },
    deleteUser: {
      enabled: true,
      // App Store guideline 5.1.1(v): apps offering Sign in with Apple
      // must revoke the user's Apple tokens when the account is deleted.
      // This runs in beforeDelete (not afterDelete) because the account
      // rows — and the stored refresh/access tokens on them — cascade-
      // delete with the user row. Fail-open: revokeAppleTokensForUser
      // never throws, so a revocation blip cannot block the deletion.
      // It is a silent no-op when no Apple account is linked or the
      // APPLE_* envs are unset.
      beforeDelete: async (user) => {
        await revokeAppleTokensForUser(user.id)
      },
    },
  },

  // Passwordless by design. No password column is read or written by this
  // config; the legacy account.password column was dropped in migration
  // 2026-05-14-01-passwordless-cleanup.sql.

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
    // Disable better-auth's default 24h sensitive-op freshness gate. We
    // gate destructive actions (delete account, change email, etc.) with
    // a fresh email-OTP step-up at the route level — that proves mailbox
    // control RIGHT NOW. The upstream freshAge check tests calendar age
    // from initial login, which is redundant with our OTP gate and would
    // produce SESSION_EXPIRED 500s for legitimate 6-day-old sessions.
    // See node_modules/better-auth/dist/api/routes/update-user.mjs:304-308.
    freshAge: 0,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },

  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ['google', 'apple'],
    },
  },

  socialProviders,

  // Cross-session cookie-cache poisoning defense. better-auth's POST
  // /email-otp/verify-email identifies the user by `body.email` and updates
  // the CALLER's session cache with `emailVerified: true` even if the
  // caller's session belongs to a different user.
  // See node_modules/better-auth/dist/plugins/email-otp/routes.mjs:336-345
  // for the upstream code path this defends against.
  // We reject the request whenever there's an active session whose email
  // doesn't match the email being verified.
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/email-otp/verify-email') return
      const body = ctx.body as { email?: string } | undefined
      const targetEmail = body?.email?.toLowerCase()
      if (!targetEmail) return
      const currentSession = await getSessionFromCtx(ctx).catch(() => null)
      if (!currentSession) return
      const sessionEmail = currentSession.user.email?.toLowerCase()
      if (sessionEmail && sessionEmail !== targetEmail) {
        throw new APIError('FORBIDDEN', {
          message: 'Cannot verify a different account while signed in. Sign out first.',
          code: 'CROSS_ACCOUNT_VERIFICATION_FORBIDDEN',
        })
      }
    }),

    // After /update-user succeeds, publish a profile.updated event so
    // other devices learn about displayName / language changes in realtime.
    // Fail-open: a publish blip must not break the update response.
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/update-user') return
      const session = await getSessionFromCtx(ctx).catch(() => null)
      if (!session) return
      const body = ctx.body as { name?: string; language?: string } | undefined
      const fields: Array<'displayName' | 'language'> = []
      if (body?.name != null) fields.push('displayName')
      if (body?.language != null) fields.push('language')
      if (fields.length === 0) return
      const deviceId = ctx.request?.headers.get('x-device-id') ?? undefined
      // Dynamic import avoids a potential circular load order between
      // auth.ts (loaded at module init) and realtime/publisher (which
      // imports redis.ts, which also runs at module init).
      const { publishToUser } = await import('./realtime/publisher')
      await publishToUser(session.user.id, {
        type: 'profile.updated',
        fields,
      }, deviceId || undefined).catch((err) => {
        console.warn('[realtime] auth after /update-user publish failed', err)
      })
    }),
  },

  plugins: [
    // Native (Capacitor) session transport. The WebView origin is
    // cross-origin to the API so cookies are unreliable there; `bearer()`
    // lets the native app authenticate via `Authorization: Bearer
    // <session-token>` and mirrors the session token into the
    // `set-auth-token` response header whenever a response sets the
    // session cookie (sign-in, one-time-token verify). Web clients never
    // send the header, so the cookie flow is untouched.
    bearer(),
    // Bridges the native OAuth flow: after the system-browser OAuth
    // round-trip, /api/native/auth-callback mints a one-time token
    // (cookie-authenticated in the system browser) and deep-links it into
    // the app, which exchanges it via POST /api/auth/one-time-token/verify
    // for a session + set-auth-token header. Tokens are single-use,
    // short-lived, and never logged.
    oneTimeToken(),
    emailOTP({
      otpLength: 6,
      expiresIn: 600, // 10 minutes
      disableSignUp: false,
      // Apple App Review demo account (App Store guideline 2.1): Apple's
      // reviewers cannot receive OTP emails, so when APP_REVIEW_EMAIL and
      // APP_REVIEW_OTP are BOTH configured, exactly that one address gets
      // a deterministic static code. The code is written to the standard
      // verification row, so the unmodified verify flow matches it.
      // Returning undefined for every other address makes better-auth
      // fall back to its random generator — the normal flow is untouched
      // and the static code can never verify any other account. Entirely
      // inert unless both envs are set. See lib/app-review.ts.
      generateOTP: ({ email }) => getAppReviewOTP(email),
      async sendVerificationOTP({ email, otp }) {
        // Skip the email for the Apple review account — the reviewer
        // types the static code directly (guideline 2.1, see above).
        if (isAppReviewEmail(email)) return
        const language = await lookupUserLanguage(email)
        await sendVerificationEmail({ email, otp, language })
      },
    }),
  ],

  rateLimit: {
    enabled: true,
    storage: 'secondary-storage',
    customRules: {
      '/email-otp/send-verification-otp': { window: 60, max: 1 },
      '/email-otp/verify-email': { window: 60, max: 5 },
      '/sign-in/email-otp': { window: 60, max: 5 },
    },
  },

  advanced: {
    cookiePrefix: 'kasero',
    useSecureCookies: process.env.NODE_ENV === 'production',
    crossSubDomainCookies: { enabled: false },
  },
})

export type Auth = typeof auth
export type Session = typeof auth.$Infer.Session
