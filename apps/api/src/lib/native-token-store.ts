import 'server-only'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { Redis } from '@upstash/redis'

/**
 * Short-lived, single-use token store for the native (Capacitor) auth
 * plumbing. Two consumers:
 *
 *   1. PKCE binding for native OAuth (FINDING 1). The native app derives a
 *      `code_challenge` from a secret `code_verifier`; the auth-callback
 *      route binds that challenge to the minted one-time token here, and
 *      the verify route redeems it only if `SHA-256(verifier)` matches.
 *      An app that intercepts the deep link has the ott but not the
 *      verifier, so it cannot redeem.
 *
 *   2. SSE connect tickets (FINDING 2). EventSource cannot set an
 *      Authorization header, so instead of leaking the bearer SESSION
 *      token in the `?token=` query (which lands in infra request logs),
 *      the native client mints a 30s single-use ticket bound to its
 *      userId and opens `/api/realtime?ticket=...`.
 *
 * BACKEND CHOICE. This uses the Upstash REST client
 * (`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`) — the SAME
 * credentials as `rate-limit.ts` and better-auth's `secondaryStorage` in
 * `auth.ts`. We deliberately do NOT reuse the realtime ioredis client
 * (`UPSTASH_REDIS_URL`): its wrapper surface only exposes pub/sub + XADD,
 * not the atomic GET+DEL these single-use tokens require, and touching it
 * would mean editing the realtime backend. In Vercel production the REST
 * creds are guaranteed present — `rate-limit.ts` throws at module load
 * without them — so the in-memory fallback below is a dev-only path
 * (mirrors the fallback in `rate-limit.ts`). Values are single-use and
 * expire fast; tokens/tickets/verifiers are NEVER logged.
 */

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null

// Key prefixes keep these namespaces distinct from the rate-limiter's
// `kasero:` keys and from each other.
const PKCE_PREFIX = 'kasero:native:pkce:'
const TICKET_PREFIX = 'kasero:native:sse:'

// TTLs. The PKCE challenge outlives a slow OAuth round trip but not by
// much; the SSE ticket is redeemed immediately after minting.
const PKCE_TTL_SECONDS = 180
const TICKET_TTL_SECONDS = 30

// ============================================
// IN-MEMORY FALLBACK (dev only — see backend note above)
// ============================================

interface MemEntry {
  value: string
  expiresAt: number
}

const memStore = new Map<string, MemEntry>()

function memPut(key: string, value: string, ttlSeconds: number): void {
  // Opportunistic sweep so a long-running dev process doesn't accumulate
  // expired entries (no background timer to keep the event loop / vitest
  // alive).
  if (memStore.size > 256) {
    const now = Date.now()
    for (const [k, entry] of memStore) {
      if (entry.expiresAt <= now) memStore.delete(k)
    }
  }
  memStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
}

function memTake(key: string): string | null {
  const entry = memStore.get(key)
  if (!entry) return null
  memStore.delete(key) // single-use
  if (entry.expiresAt <= Date.now()) return null
  return entry.value
}

// ============================================
// GENERIC PUT / TAKE
// ============================================

async function put(key: string, value: string, ttlSeconds: number): Promise<void> {
  if (redis) {
    await redis.set(key, value, { ex: ttlSeconds })
    return
  }
  memPut(key, value, ttlSeconds)
}

/**
 * Atomic get-and-delete. Returns the stored value (once) or null if the
 * key is missing/expired/already consumed. Single-use is enforced by the
 * atomic GETDEL on Redis and the delete-before-return on the in-memory
 * fallback.
 */
async function take(key: string): Promise<string | null> {
  if (redis) {
    const value = await redis.getdel<string>(key)
    return typeof value === 'string' ? value : null
  }
  return memTake(key)
}

// ============================================
// PKCE CHALLENGE BINDING (FINDING 1)
// ============================================

// The one-time token is itself a secret; we key by its SHA-256 so the raw
// ott never lands in the Redis keyspace.
function pkceKey(oneTimeToken: string): string {
  return PKCE_PREFIX + createHash('sha256').update(oneTimeToken).digest('hex')
}

/** Base64url of SHA-256(verifier) — the server-side challenge derivation. */
export function deriveChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

/** Constant-time comparison of two challenge strings. */
export function challengesMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/**
 * Bind a PKCE `code_challenge` to a freshly minted one-time token. Called
 * by the auth-callback route right before it deep-links the ott.
 */
export async function storePkceChallenge(
  oneTimeToken: string,
  challenge: string,
): Promise<void> {
  await put(pkceKey(oneTimeToken), challenge, PKCE_TTL_SECONDS)
}

/**
 * Consume (single-use) the challenge bound to a one-time token. Returns
 * null if none is bound (unknown/expired/replayed ott).
 */
export async function consumePkceChallenge(
  oneTimeToken: string,
): Promise<string | null> {
  return take(pkceKey(oneTimeToken))
}

// ============================================
// SSE CONNECT TICKETS (FINDING 2)
// ============================================

/**
 * Mint a 30s single-use SSE ticket bound to `userId`. Returned to an
 * authenticated native client, which opens `/api/realtime?ticket=...`.
 */
export async function mintSseTicket(userId: string): Promise<string> {
  const ticket = randomBytes(32).toString('base64url')
  await put(TICKET_PREFIX + ticket, userId, TICKET_TTL_SECONDS)
  return ticket
}

/**
 * Consume (single-use) an SSE ticket, returning the bound userId or null.
 */
export async function consumeSseTicket(ticket: string): Promise<string | null> {
  return take(TICKET_PREFIX + ticket)
}

/** Test-only: clear the in-memory fallback between tests. */
export function __resetForTests(): void {
  memStore.clear()
}
