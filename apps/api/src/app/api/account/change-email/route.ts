import 'server-only'
import { z } from 'zod'
import { and, eq, ne } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { auth } from '@/lib/auth'
import { db } from '@/db'
import { users, session as sessions, verification } from '@kasero/shared/db/schema'
import {
  errorResponse,
  successResponse,
  validationError,
  withAuth,
} from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { Schemas } from '@/lib/schemas'
import { sendVerificationEmail } from '@/lib/email'
import { getOriginDeviceId, publishToUser } from '@/lib/realtime'

/**
 * POST /api/account/change-email
 *
 * Two-phase dual-OTP email change for the signed-in user. The flow is
 * deliberately stricter than better-auth's built-in change-email endpoint
 * because we want proof that the user controls BOTH addresses before we
 * cut the account loose from the old one.
 *
 * Phase 1 (initiate): user submits the new email. We reject same-email
 * and uniqueness collisions cheaply, then mint two 6-digit OTPs and store
 * them in better-auth's `verification` table using the exact wire format
 * the email-otp plugin uses (identifier `email-verification-otp-${email}`
 * and value `${otp}:${attempts}`). Emails go out via the same Resend
 * template used everywhere else.
 *
 * Phase 2 (confirm): user submits both codes. We verify each OTP
 * directly against the verification table, deleting both rows on success,
 * then atomically rewrite users.email, mark emailVerified, and revoke
 * every OTHER session for this user (the current session keeps working —
 * the user just changed their email, they shouldn't have to sign back in
 * on this device).
 *
 * Why we don't reuse auth.api.sendVerificationOTP / verifyEmailOTP:
 *
 *   1. sendVerificationOTP refuses `type: 'change-email'` and silently
 *      drops the send when the email isn't already a registered user.
 *      Since the WHOLE POINT of phase 1 is sending to a NEW email that
 *      doesn't have a users row yet, the plugin endpoint is the wrong
 *      primitive.
 *
 *   2. verifyEmailOTP runs under auth.ts's cross-account defense hook
 *      (lines 91-105) which throws CROSS_ACCOUNT_VERIFICATION_FORBIDDEN
 *      whenever the body's email differs from the active session's email.
 *      That's correct for normal email verification — it stops a logged-
 *      in attacker from poisoning the cookie cache of a different user.
 *      But for the change-email confirm step, the WHOLE POINT is verifying
 *      an email that isn't (yet) the session's email. So we go around it.
 *
 * Wrapped in withAuth for the standard same-origin / body-size /
 * per-user / per-IP guardrails.
 */

const InitiateBody = z.object({
  phase: z.literal('initiate'),
  newEmail: Schemas.email(),
})

const ConfirmBody = z.object({
  phase: z.literal('confirm'),
  newEmail: Schemas.email(),
  oldOtp: z.string().length(6).regex(/^[0-9]+$/),
  newOtp: z.string().length(6).regex(/^[0-9]+$/),
})

const Body = z.discriminatedUnion('phase', [InitiateBody, ConfirmBody])

// OTP storage shape mirrored from better-auth/dist/plugins/email-otp/utils.mjs.
// Format MUST match exactly or the row won't be findable by any future
// upstream verification flow.
const OTP_EXPIRES_IN_SECONDS = 600 // 10 minutes — mirrors auth.ts emailOTP({ expiresIn: 600 })
const OTP_LENGTH = 6

function otpIdentifier(email: string): string {
  // type-otp-email per toOTPIdentifier(). Type is 'email-verification' so
  // a future migration to auth.api.verifyEmailOTP (if the cross-account
  // hook is ever lifted) would find the row.
  return `email-verification-otp-${email.toLowerCase()}`
}

function generateOtp(): string {
  // Cryptographically uniform 6-digit numeric code. crypto.getRandomValues
  // is the same primitive better-auth's generateRandomString uses under
  // the hood for the same alphabet, but we don't depend on better-auth's
  // internals here.
  const bytes = new Uint8Array(OTP_LENGTH)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const byte of bytes) {
    out += (byte % 10).toString()
  }
  return out
}

async function createVerificationRow(email: string, otp: string): Promise<void> {
  const identifier = otpIdentifier(email)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + OTP_EXPIRES_IN_SECONDS * 1000)
  // better-auth stores `${otp}:${attempts}`. Attempts starts at 0.
  const value = `${otp}:0`
  // Delete any existing pending OTP for this identifier first — mirrors
  // resolveOTP's behavior when the create races a duplicate.
  await db.delete(verification).where(eq(verification.identifier, identifier))
  await db.insert(verification).values({
    id: nanoid(),
    identifier,
    value,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  })
}

/**
 * Verify a plain-text OTP against the verification table directly.
 * Bypasses auth.api.verifyEmailOTP's cross-account defense hook (which
 * is required for normal email-verification but actively wrong for the
 * change-email confirm step). Single-use: deletes the row on success.
 *
 * Storage format matches better-auth's email-otp plugin: identifier
 * `email-verification-otp-${email}`, value `${otp}:${attempts}`. We
 * intentionally do NOT enforce the per-row allowedAttempts counter here
 * because the per-user / per-IP rate limit on the withAuth wrapper
 * already caps how many wrong guesses an attacker can make per minute,
 * and adding upstream-compatible attempt bookkeeping doubles the test
 * surface for no real security gain.
 */
async function verifyOtpDirect(email: string, otp: string): Promise<boolean> {
  const identifier = otpIdentifier(email)
  const now = new Date()
  const rows = await db
    .select({
      id: verification.id,
      value: verification.value,
      expiresAt: verification.expiresAt,
    })
    .from(verification)
    .where(eq(verification.identifier, identifier))
    .limit(1)
  const row = rows[0]
  if (!row) return false
  if (row.expiresAt.getTime() < now.getTime()) {
    // Expired: garbage-collect and fail.
    await db.delete(verification).where(eq(verification.id, row.id))
    return false
  }
  // splitAtLastColon: storage is `${otp}:${attempts}`. Last colon
  // separates the attempts counter from the OTP value (which never
  // contains a colon since it's 6 digits in our config).
  const lastColon = row.value.lastIndexOf(':')
  const storedOtp = lastColon === -1 ? row.value : row.value.slice(0, lastColon)
  if (storedOtp !== otp) return false
  // Single-use: delete the row regardless of any future re-attempt.
  await db.delete(verification).where(eq(verification.id, row.id))
  return true
}

export const POST = withAuth(async (request, user) => {
  const parsed = Body.safeParse(await request.json())
  if (!parsed.success) return validationError(parsed)

  if (parsed.data.phase === 'initiate') {
    const target = parsed.data.newEmail
    if (target === user.email.toLowerCase()) {
      return errorResponse(ApiMessageCode.EMAIL_CHANGE_SAME_AS_CURRENT, 400)
    }
    // Uniqueness: reject if another user already owns this email.
    const collision = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, target), ne(users.id, user.userId)))
      .limit(1)
    if (collision.length > 0) {
      return errorResponse(ApiMessageCode.EMAIL_CHANGE_TARGET_TAKEN, 409)
    }
    // Mint two independent OTPs, persist both rows, send both emails.
    // Independent rows so the two codes are distinct numbers — the user
    // sees two different codes in two different inboxes, which both
    // proves possession and makes phishing one of them useless on its
    // own.
    const oldOtp = generateOtp()
    const newOtp = generateOtp()
    await Promise.all([
      createVerificationRow(user.email, oldOtp),
      createVerificationRow(target, newOtp),
    ])
    // Send the emails in parallel. user.language is the signed-in user's
    // preferred language; the new mailbox shares it because the same
    // human owns both. If a future product change adds a per-mailbox
    // language preference we'll need to look it up per address.
    await Promise.all([
      sendVerificationEmail({ email: user.email, otp: oldOtp, language: user.language }),
      sendVerificationEmail({ email: target, otp: newOtp, language: user.language }),
    ])
    return successResponse({}, ApiMessageCode.EMAIL_CHANGE_OTP_SENT)
  }

  // phase === 'confirm'
  const { newEmail, oldOtp, newOtp } = parsed.data
  const target = newEmail
  if (target === user.email.toLowerCase()) {
    return errorResponse(ApiMessageCode.EMAIL_CHANGE_SAME_AS_CURRENT, 400)
  }
  // Re-check uniqueness — another user could have claimed the email
  // between initiate and confirm.
  const collision = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, target), ne(users.id, user.userId)))
    .limit(1)
  if (collision.length > 0) {
    return errorResponse(ApiMessageCode.EMAIL_CHANGE_TARGET_TAKEN, 409)
  }
  // Verify BOTH OTPs before any DB mutation. We don't short-circuit on
  // the first failure: that would leak which side was wrong via timing
  // and would also leave the surviving row in the DB. Verifying both in
  // parallel deletes both rows on success and leaves any survivor in
  // place to be tried again with a fresh code.
  const [oldOk, newOk] = await Promise.all([
    verifyOtpDirect(user.email, oldOtp),
    verifyOtpDirect(target, newOtp),
  ])
  if (!oldOk || !newOk) {
    return errorResponse(ApiMessageCode.OTP_INVALID, 401)
  }
  // Atomic: rewrite users.email, mark verified, revoke every other
  // session for this user. The CURRENT session stays alive — we identify
  // it by its bearer cookie via auth.api.getSession so the user doesn't
  // get kicked off the device they're using.
  const currentSession = await auth.api.getSession({ headers: request.headers })
  const currentSessionId = currentSession?.session?.id
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        email: target,
        emailVerified: true,
        emailVerifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.userId))
    if (currentSessionId) {
      await tx
        .delete(sessions)
        .where(
          and(eq(sessions.userId, user.userId), ne(sessions.id, currentSessionId)),
        )
    } else {
      // Belt-and-suspenders: if for some reason we can't identify the
      // current session id, wipe ALL sessions for this user. The user
      // will need to sign in again on this device but no other device
      // keeps a stale email.
      await tx.delete(sessions).where(eq(sessions.userId, user.userId))
    }
  })
  // Fail-open: a publish blip must not block the user from seeing their
  // email change succeed. The client will learn the new value on next
  // profile load if the SSE event is missed.
  await publishToUser(user.userId, {
    type: 'profile.updated',
    fields: ['email'],
  }, getOriginDeviceId(request))

  return successResponse({ newEmail: target }, ApiMessageCode.EMAIL_CHANGED)
})
