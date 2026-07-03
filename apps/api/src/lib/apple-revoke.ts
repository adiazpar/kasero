import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { account } from '@kasero/shared/db/schema'
import { mintAppleClientSecret } from './apple-client-secret'

const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke'

/**
 * Revoke a user's stored Sign in with Apple tokens.
 *
 * App Store guideline 5.1.1(v): apps offering Sign in with Apple must
 * revoke the user's Apple tokens when the user deletes their account.
 * Called from the better-auth `user.deleteUser.beforeDelete` hook in
 * auth.ts — it must run BEFORE the user row is deleted because the
 * `account` rows (and the tokens stored on them) cascade-delete with it.
 *
 * Fail-open by design: this function NEVER throws. A revocation failure
 * must not block account deletion — it logs a warning (never including
 * token contents) and returns. It is silently a no-op when the user has
 * no linked Apple account or the APPLE_* envs are not configured.
 */
export async function revokeAppleTokensForUser(userId: string): Promise<void> {
  const clientId = process.env.APPLE_CLIENT_ID
  const teamId = process.env.APPLE_TEAM_ID
  const keyId = process.env.APPLE_KEY_ID
  const privateKey = process.env.APPLE_PRIVATE_KEY
  if (!clientId || !teamId || !keyId || !privateKey) return

  try {
    const appleAccounts = await db.query.account.findMany({
      where: and(eq(account.userId, userId), eq(account.providerId, 'apple')),
      columns: { refreshToken: true, accessToken: true },
    })
    if (appleAccounts.length === 0) return

    // Apple's /auth/revoke authenticates the app with the same short-lived
    // ES256 client-secret JWT the OAuth provider uses; mint a fresh one on
    // demand (cheap local signing, no network round trip).
    const clientSecret = await mintAppleClientSecret({
      teamId,
      clientId,
      keyId,
      privateKey,
    })

    for (const row of appleAccounts) {
      const token = row.refreshToken ?? row.accessToken
      if (!token) continue
      const response = await fetch(APPLE_REVOKE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          token,
          token_type_hint: row.refreshToken ? 'refresh_token' : 'access_token',
        }),
      })
      if (!response.ok) {
        // Status only — never the token or response body.
        console.warn(
          `[apple-revoke] Apple token revocation returned ${response.status} for user ${userId}; continuing with deletion`,
        )
      }
    }
  } catch (err) {
    // Message only — never token contents.
    console.warn(
      '[apple-revoke] Apple token revocation failed; continuing with deletion:',
      err instanceof Error ? err.message : String(err),
    )
  }
}
