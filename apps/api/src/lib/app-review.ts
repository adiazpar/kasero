import 'server-only'

/**
 * Apple App Review demo-account support (App Store guideline 2.1).
 *
 * Apple's reviewers sign in with a designated demo account but cannot
 * receive OTP emails, so the review account must accept a fixed code.
 * Both APP_REVIEW_EMAIL and APP_REVIEW_OTP must be set for the feature
 * to activate; when either is missing (every non-review environment)
 * the helpers below return negative/undefined and the normal
 * random-OTP flow is completely untouched.
 *
 * Security posture:
 *   - Exact-match against a single configured email (trimmed,
 *     case-insensitive). The static code is only ever minted for that
 *     one address — `getAppReviewOTP` returns undefined for every
 *     other email, so the code can never verify any other account.
 *   - The code itself is never logged and never emailed.
 *   - APP_REVIEW_OTP must be 6+ digits; anything else deactivates the
 *     feature entirely rather than weakening it.
 *
 * Values live in Bitwarden ("Kasero — Vercel project envs"); the
 * companion .env.example documents the shape only.
 */

function reviewConfig(): { email: string; otp: string } | null {
  const email = process.env.APP_REVIEW_EMAIL?.trim().toLowerCase()
  const otp = process.env.APP_REVIEW_OTP?.trim()
  if (!email || !otp) return null
  if (!/^\d{6,}$/.test(otp)) return null
  return { email, otp }
}

/** True when `email` is the configured Apple review account. */
export function isAppReviewEmail(email: string): boolean {
  const config = reviewConfig()
  return config !== null && email.trim().toLowerCase() === config.email
}

/**
 * Static OTP for the Apple review account, undefined for everyone else.
 *
 * Wired into the emailOTP plugin's `generateOTP` override. better-auth
 * falls back to its random generator whenever the override returns
 * undefined (`opts.generateOTP(...) || defaultOTPGenerator(opts)` in
 * better-auth's email-otp routes), so the normal flow is unaffected.
 * For the review address the static code is written to the standard
 * verification row, which the unmodified verify flow then matches
 * deterministically.
 */
export function getAppReviewOTP(email: string): string | undefined {
  const config = reviewConfig()
  if (config === null) return undefined
  return email.trim().toLowerCase() === config.email ? config.otp : undefined
}
