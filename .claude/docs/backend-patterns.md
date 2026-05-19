# Backend Patterns Guide

This document outlines the established patterns and utilities for backend development. **All new features must use these patterns** to maintain consistency and security.

---

## Table of Contents

1. [API Routes](#api-routes)
2. [Response Helpers](#response-helpers)
3. [Frontend API Calls](#frontend-api-calls)
4. [Validation with Zod](#validation-with-zod)
5. [Authorization](#authorization)
6. [Rate Limiting](#rate-limiting)
7. [Upload Validation](#upload-validation)
8. [Security Checklist](#security-checklist)
9. [Realtime publishes](#realtime-publishes) — see `.claude/docs/realtime-system.md`

---

## API Routes

### Realtime publishes

When a mutation route changes shared state, audit whether open clients on other devices should learn of the change in real time. If so, publish the appropriate event after the DB write via the publisher helpers in `@/lib/realtime`. The event type, channel, and fail-open/fail-closed semantics are all documented in `.claude/docs/realtime-system.md`. The publish call belongs after the DB write succeeds, before `successResponse`.

---

### Business-Scoped Routes

All routes under `/api/businesses/[businessId]/` must use the `withBusinessAuth` wrapper.

```typescript
// apps/api/src/app/api/businesses/[businessId]/products/route.ts
import { db } from '@/db'
import { products } from '@kasero/shared/db/schema'
import { eq, and } from 'drizzle-orm'
import { withBusinessAuth, errorResponse, successResponse, validationError } from '@/lib/api-middleware'
import { canManageBusiness } from '@/lib/business-auth'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { Schemas } from '@/lib/schemas'
import { z } from 'zod'

const createProductSchema = z.object({
  name: Schemas.name(),
  price: Schemas.amount(),
})

// GET — list products (any team member)
export const GET = withBusinessAuth(async (_request, access) => {
  const productsList = await db
    .select()
    .from(products)
    .where(eq(products.businessId, access.businessId))
    .limit(500)

  return successResponse({ products: productsList })
})

// POST — create product (partners/owners only; employees are read-only)
export const POST = withBusinessAuth(async (request, access) => {
  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.PRODUCT_FORBIDDEN_NOT_MANAGER, 403)
  }

  const body = await request.json()
  const validation = createProductSchema.safeParse(body)
  if (!validation.success) {
    return validationError(validation)
  }

  // ... create product
  return successResponse({ product: newProduct })
})
```

### What `withBusinessAuth` Provides

The wrapper handles:

- Awaits and extracts `businessId` from the route's async params
- Calls `requireBusinessAccess(businessId)` which (cache-through) verifies the current user is an active member of this business
- Automatically applies `RateLimits.businessMutation` (200/min per user+business) to any non-GET/HEAD request — you do not need to add a rate-limit check to writes
- Routes error paths:
  - No session → **401 UNAUTHORIZED**
  - Valid session but no membership → **403 FORBIDDEN**
  - Resource not found (thrown by the handler) → **404 NOT_FOUND**
  - Anything else → **500 INTERNAL_ERROR**

The `access` object passed to the handler:

```typescript
interface BusinessAccess {
  businessId: string             // Verified against the caller's membership (NOT the URL)
  businessName: string
  businessType: 'food' | 'retail' | 'services' | 'wholesale' | 'manufacturing' | 'other' | null
  businessIcon: string | null
  businessLocale: string         // e.g. 'en-US', 'es-PE'
  businessCurrency: string       // e.g. 'USD', 'PEN'
  role: BusinessRole             // 'owner' | 'partner' | 'employee'
  userId: string                 // Current user's ID, from the better-auth session
}
```

> **Always use `access.businessId` in queries, not the URL param.** The wrapper verifies `access.businessId` is a business the caller actually belongs to; using the raw URL value re-opens the cross-tenant surface the wrapper is designed to close.

### Routes with Additional ID Parameter

For routes like `/api/businesses/[businessId]/products/[id]`:

```typescript
export const PATCH = withBusinessAuth(async (request, access, routeParams) => {
  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.PRODUCT_FORBIDDEN_NOT_MANAGER, 403)
  }

  const id = routeParams?.id
  if (!id) {
    return errorResponse(ApiMessageCode.PRODUCT_ID_REQUIRED, 400)
  }

  // .returning() handles the ownership check + result fetch in one round trip.
  // Empty returning = the UPDATE matched nothing (wrong id OR wrong business).
  const [updated] = await db
    .update(products)
    .set(updateData)
    .where(and(eq(products.id, id), eq(products.businessId, access.businessId)))
    .returning()

  if (!updated) {
    return errorResponse(ApiMessageCode.PRODUCT_NOT_FOUND, 404)
  }
  return successResponse({ product: updated })
})
```

### Non-Business Authenticated Routes

For routes like `/api/ai/*`, `/api/convert-heic`, or `/api/account/delete` — authenticated but not tied to a business — use the `withAuth` wrapper:

```typescript
import { withAuth, applyRateLimit, enforceMaxContentLength, errorResponse } from '@/lib/api-middleware'
import { RateLimits } from '@/lib/rate-limit'
import { ApiMessageCode } from '@kasero/shared/api-messages'

const MAX_BODY_BYTES = 2 * 1024 * 1024

export const POST = withAuth(async (request, user) => {
  // Reject oversized payloads BEFORE buffering the body. (withAuth already
  // enforces a 256 KB default cap — override with `{ maxBodyBytes: 2 * 1024 * 1024 }`
  // on the wrapper for upload-style routes that need a bigger budget.)
  const oversize = enforceMaxContentLength(request, MAX_BODY_BYTES)
  if (oversize) return oversize

  // Optional extra per-route rate limit on top of the per-user / per-IP
  // mutation caps withAuth applies automatically.
  const rateLimited = await applyRateLimit(`ai:${user.userId}`, RateLimits.ai)
  if (rateLimited) return rateLimited

  // ... handler body
  return successResponse({ /* ... */ })
})
```

`withAuth` calls `auth.api.getSession({ headers: request.headers })` (better-auth, DB-backed) and hands the handler an `AuthedUser`:

```typescript
interface AuthedUser {
  userId: string           // session.user.id, renamed for call-site ergonomics
  email: string
  emailVerified: boolean
  name: string
  language: string         // user's preferred UI language; defaults to 'en-US'
}
```

What the wrapper does, in order, on every call:

1. **CSRF defense-in-depth.** `enforceSameOrigin` rejects any non-GET/HEAD request whose `Origin` / `Referer` doesn't match the request's host (uses `X-Forwarded-Host` + `X-Forwarded-Proto` so it works behind Vercel and through Vite's dev proxy). Fires BEFORE the auth lookup so a cross-site request can't even probe for "is this cookie still valid?" via response timing.
2. **Body-size cap.** Default 256 KB; override with `{ maxBodyBytes }` on the wrapper for routes that legitimately need more (uploads, large AI payloads). Idempotent — safe to call `enforceMaxContentLength` again inside the handler.
3. **Session lookup.** `auth.api.getSession({ headers })`. No session → 401 `UNAUTHORIZED`.
4. **Email-verified gate.** Unverified emails → 403 `EMAIL_NOT_VERIFIED`. Pre-verification routes opt out via `withAuth(handler, { allowUnverified: true })`. **Use this sparingly** — only for routes that legitimately need to run before verification completes (e.g., resend-OTP, sign-out).
5. **Mutation caps (non-GET/HEAD).** Per-user `RateLimits.userMutation` (30/min) AND per-IP `RateLimits.ipMutation` (600/min). Opt out with `{ rateLimit: false }` if the route needs a custom bucket (the route then has to call `applyRateLimit` itself).

### Fully Public Routes (no auth)

The auth flows themselves (`/api/auth/[...all]`) are owned by better-auth and inherit its own rate-limiter (Upstash Redis via `secondaryStorage`, falls back to in-memory in dev without Upstash creds; per-path rules listed in `tech-stack.md`). Outside the auth surface, public routes like `/api/invite/validate` and `/api/geolocation` use no wrapper but still emit envelopes and rate-limit explicitly:

```typescript
import { NextRequest } from 'next/server'
import { getClientIp, RateLimits } from '@/lib/rate-limit'
import { errorResponse, successResponse, validationError, applyRateLimit } from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'

export async function POST(request: NextRequest) {
  try {
    const clientIp = getClientIp(request)
    const rateLimited = await applyRateLimit(`validate:${clientIp}`, RateLimits.codeValidation)
    if (rateLimited) return rateLimited

    const body = await request.json()
    const validation = schema.safeParse(body)
    if (!validation.success) return validationError(validation)

    // ... business logic
    return successResponse({ /* ... */ })
  } catch (error) {
    console.error('validate error:', error)
    return errorResponse(ApiMessageCode.INTERNAL_ERROR, 500)
  }
}
```

---

## Response Helpers

All responses go through the envelope helpers in `apps/api/src/lib/api-middleware.ts`. Never hand-roll `NextResponse.json({ error: '...' })` — the error paths must emit a server-side `messageCode` so the client can translate.

| Helper | Use for | Example |
|--------|---------|---------|
| `successResponse(data, code?, vars?)` | 2xx responses | `successResponse({ product }, ApiMessageCode.PRODUCT_CREATED)` |
| `errorResponse(code, status, vars?)` | Any 4xx/5xx | `errorResponse(ApiMessageCode.PRODUCT_NOT_FOUND, 404)` |
| `validationError(zodResult)` | 400 from a Zod `safeParse` | `validationError(schema.safeParse(body))` — maps Zod issues to concrete codes |
| `applyRateLimit(id, config)` | 429 inline | Returns a 429 `NextResponse` with `Retry-After`, or `null` if under the limit |
| `enforceMaxContentLength(req, max)` | 411/413 before body read | Rejects oversize uploads before buffering |

> See `i18n-system.md` for the full list of `ApiMessageCode` values and how they map to translation keys.

---

## Frontend API Calls

### Using the API Client

All hooks must use the centralized API client from `@/lib/api-client` (lives in `apps/web/src/lib/api-client.ts`). Never call `fetch()` directly for an API route.

```typescript
import {
  apiRequest,
  apiPost,
  apiPatch,
  apiDelete,
  apiPostForm,
  apiPatchForm,
  ApiError,
} from '@/lib/api-client'

// GET
const data = await apiRequest<{ products: Product[] }>(
  `/api/businesses/${businessId}/products`,
)

// POST with JSON
const data = await apiPost<{ product: Product }>(
  `/api/businesses/${businessId}/products`,
  { name, price },
)

// POST with FormData (file upload)
const data = await apiPostForm<{ product: Product }>(
  `/api/businesses/${businessId}/products`,
  formData,
)

// PATCH with JSON
await apiPatch(`/api/businesses/${businessId}/products/${id}`, updates)

// PATCH with FormData
await apiPatchForm(`/api/businesses/${businessId}/products/${id}`, formData)

// DELETE
await apiDelete(`/api/businesses/${businessId}/products/${id}`)
```

### Error Handling Pattern

`apiRequest` and its wrappers throw `ApiError` on non-2xx responses or `data.success === false`. Hooks should translate the server's envelope via `useApiMessage`:

```typescript
import { ApiError } from '@/lib/api-client'
import { useApiMessage } from '@/hooks/useApiMessage'

function useMyHook() {
  const translateApiMessage = useApiMessage()

  const save = async () => {
    try {
      await apiPost('/api/endpoint', data)
    } catch (err) {
      if (err instanceof ApiError && err.envelope) {
        setError(translateApiMessage(err.envelope))
      } else if (err instanceof ApiError) {
        setError(err.message)       // Legacy fallback
      } else {
        setError('Something went wrong')
      }
    }
  }
}
```

`ApiError` exposes `.statusCode`, `.messageCode`, `.messageVars`, `.envelope` (or `null`), `.message`, and `.data` (full response body, useful for routes that return extra data alongside errors — see `DeleteAccountModal`'s 409 `ownedBusinesses` handling).

### Offline failures

`apiRequest` wraps the underlying `fetch()` call in try/catch and converts network-layer `TypeError`s (Chrome's "Failed to fetch", Firefox's "NetworkError when attempting to fetch resource", Safari's "Load failed") into `new ApiError(0, { messageCode: 'OFFLINE_MUTATION_BLOCKED' })`. Consumers don't need any special handling — the existing `err.envelope` + `useApiMessage` branch translates it automatically. Other catch types (CORS errors, AbortError, etc.) propagate unchanged.

For background GET revalidations (e.g., context `ensureLoaded` paths), the offline `ApiError` is caught by the context's existing try/catch and the cached data stays in place — no error surfaced to the user. See `.claude/docs/performance-patterns.md` Section 11 for full details on offline detection and the `<OfflineBadge>` component (lives in `apps/web/src/components/layout/OfflineBadge.tsx`).

---

## Validation with Zod

### Using Shared Schemas

Always use `Schemas` from `@/lib/schemas` (server-side helpers defined in `apps/api/src/lib/schemas.ts`) for common field types:

```typescript
import { z } from 'zod'
import { Schemas } from '@/lib/schemas'

const mySchema = z.object({
  email: Schemas.email(),              // Validates + lowercases
  name: Schemas.name(),                // Min 1 char
  name: Schemas.name(2),               // Custom min
  id: Schemas.id(),                    // Required non-empty string
  code: Schemas.code(),                // Required + uppercases
  price: Schemas.amount(),             // ≥ 0, capped at 1B
  total: Schemas.positiveAmount(),     // > 0, capped at 1B
  phone: Schemas.phone(),              // Nullable optional
  active: Schemas.activeFlag(),        // 'true'/'false' → boolean
  role: Schemas.role(),                // 'owner' | 'partner' | 'employee'
  businessType: Schemas.businessType(),
  locale: Schemas.locale(),
  currency: Schemas.currency(),
  businessIcon: Schemas.businessIcon(), // Emoji or base64 data URL + size check
})
```

### Available Schemas

| Schema | Description | Example Valid Input |
|--------|-------------|---------------------|
| `Schemas.email()` | Email + lowercase | `"User@Email.com"` → `"user@email.com"` |
| `Schemas.name(min?, max?)` | Required string, length bounds | `"John"` |
| `Schemas.id()` | Required non-empty string | `"abc123"` |
| `Schemas.code()` | Required + uppercase | `"abc123"` → `"ABC123"` |
| `Schemas.amount()` | Number `[0, 1_000_000_000]` (coerces) | `"10.50"` → `10.5` |
| `Schemas.positiveAmount()` | Number `(0, 1_000_000_000]` (coerces) | `"5"` → `5` |
| `Schemas.phone()` | Optional nullable string | `"+1234567890"` or `null` |
| `Schemas.activeFlag()` | Boolean from string or bool, default true | `"true"` → `true` |
| `Schemas.role()` | Business role enum | `"partner"` |
| `Schemas.businessType()` | Business type enum | `"food"` |
| `Schemas.locale()` | Locale code e.g. `'en-US'` | `"es-PE"` |
| `Schemas.currency()` | ISO 4217 code, uppercased | `"USD"` |
| `Schemas.businessIcon()` | Emoji or `data:image/*;base64,...` ≤ 2MB | `"🧋"` or `"data:image/png;base64,..."` |

### Validation in Routes

```typescript
const validation = schema.safeParse(body)
if (!validation.success) return validationError(validation)
const { email, name, price } = validation.data
```

`validationError()` maps Zod issue codes (`too_small`, `invalid_format`, etc.) to concrete `ApiMessageCode` values and returns a 400 envelope. See `i18n-system.md` for the issue-to-code mapping and how to attach a custom code via `refine({ params: { apiMessageCode: 'YOUR_CODE' } })`.

---

## Authorization

### Role Matrix

| Role | Read | Create products / orders | Edit products / orders | Adjust stock | Manage team | Transfer business |
|------|------|--------------------------|------------------------|--------------|-------------|-------------------|
| owner | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| partner | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| employee | ✓ | — | — | — | — | — |

Employees are strictly read-only. `POST /products`, `POST /orders`, `POST /orders/[id]/receive`, and `PATCH /products/[id]/stock` all gate on `canManageBusiness`. `GET /team` is also restricted to managers so teammate emails aren't exposed to employees.

### Role Check Helpers

```typescript
import { canManageBusiness, isOwner } from '@/lib/business-auth'

// Manager = owner OR partner; used for most writes
if (!canManageBusiness(access.role)) {
  return errorResponse(ApiMessageCode.PRODUCT_FORBIDDEN_NOT_MANAGER, 403)
}

// Owner-only (transfers, delete business)
if (!isOwner(access.role)) {
  return errorResponse(ApiMessageCode.BUSINESS_ONLY_OWNER_CAN_DELETE, 403)
}
```

### Required Checks by Operation

| Operation | Check |
|-----------|-------|
| List / view business-scoped data | `withBusinessAuth` (already handled) |
| Create / update / delete products, orders, providers, categories | `canManageBusiness(access.role)` |
| Read team members | `canManageBusiness(access.role)` |
| Change role / toggle status / issue invite codes | `isOwner(access.role)` |
| Initiate / cancel / confirm ownership transfer | `isOwner(access.role)` |
| Delete business | `isOwner(access.role)` |

### Session Revocation

Sessions live in the `session` table (better-auth). Revocation works by deleting / expiring rows there — no JWT signature to worry about.

- **Change email** (`POST /api/account/change-email` with `phase: 'confirm'`) revokes every OTHER session for the user inside the same transaction that rewrites `users.email`. The current session stays alive so the user isn't kicked off the device that initiated the change.
- **Account deletion** (`POST /api/account/delete`) calls `auth.api.deleteUser`, which cascade-deletes every `session` row for the user along with the user record itself (`session.userId` has `onDelete: 'cascade'`).
- **Manual revocation** — call `authClient.revokeOtherSessions()` from the client (or `auth.api.revokeOtherSessions` from a route handler) to drop every session except the caller's.

Note that the 5-minute cookie cache (`session.cookieCache.maxAge`) means a revoked session may still satisfy a request for up to 5 minutes on the instance that cached it. For sensitive routes that need the DB-fresh view, better-auth exposes a `disableCookieCache` query option on `getSession` — use it sparingly.

---

## OTP Step-Up for Destructive Actions

The app is passwordless: there is no password to re-prompt for before a destructive mutation. To prove fresh mailbox control, the route requires the client to (a) request a 6-digit OTP via better-auth's email-OTP endpoint and (b) re-submit the value alongside the mutation body. better-auth's `verifyEmailOTP` consumes the verification row on success, so a captured code can't be replayed for a second mutation.

The standard wire shape:

1. Client calls `POST /api/auth/email-otp/send-verification-otp` with `{ email, type: 'email-verification' }`. The plugin writes a one-time row to the `verification` table (identifier `email-verification-otp-${email}`, value `${otp}:${attempts}`, 10 min TTL) and sends the code via Resend.
2. The user types the code into the modal step that gates the destructive action.
3. Client submits the destructive request with the OTP as a sibling field on the request body.
4. Server route validates Zod, verifies the OTP (either via `auth.api.verifyEmailOTP` or a direct read on the `verification` row for flows that don't fit the plugin's cross-account defense — see `change-email`), then runs the mutation. The verification row is deleted as part of the verify step; replay returns 401 `OTP_INVALID`.

The single-session freshness gate in better-auth (`session.freshAge`) is disabled in `auth.ts`. The OTP step-up is the sole freshness proof, intentionally — it tests "the user is at this mailbox right now" rather than "this session was minted in the last 24 hours".

### Routes using this pattern

| Route | Method | Step-up shape |
|-------|--------|---------------|
| `/api/account/delete` | POST | Body: `{ confirmEmail, otp }`. Verifies OTP against the signed-in user's mailbox via `auth.api.verifyEmailOTP`, blocks deletion if the user still actively owns a business (409 `USER_DELETE_OWNS_BUSINESSES`), then `auth.api.deleteUser` cascade-deletes everything. |
| `/api/account/change-email` | POST | Two-phase **dual** OTP. Phase 1 (`{ phase: 'initiate', newEmail }`) mints TWO independent OTPs — one to the current email, one to the new — and stores both verification rows. Phase 2 (`{ phase: 'confirm', newEmail, oldOtp, newOtp }`) verifies both codes in parallel, rewrites `users.email`, marks verified, and revokes every other session for this user. The handler bypasses the email-OTP plugin's cross-account defense hook by reading the `verification` rows directly (see the route comment for why). 409 `EMAIL_CHANGE_TARGET_TAKEN` if another user has claimed the new email between initiate and confirm. |
| `/api/businesses/[businessId]/transfer/initiate` | POST | Body: `{ recipientEmail, otp }`. The OTP is verified against the *current owner's* mailbox before the transfer row is created — proving the owner is at the keyboard, not someone who walked off with a logged-in laptop. |

---

## Rate Limiting

### When to Add Rate Limiting

- **Already covered automatically** by `withBusinessAuth` for non-GET/HEAD methods on `/api/businesses/[businessId]/**` (RateLimits.businessMutation, 200/min).
- **Already covered automatically** by `withAuth` for non-GET/HEAD methods (RateLimits.userMutation 30/min + RateLimits.ipMutation 600/min).
- **Already covered automatically** by better-auth's Redis-backed rate-limiter for every `/api/auth/*` endpoint (via `secondaryStorage`; rules in `apps/api/src/lib/auth.ts`).
- **Add explicitly** when a route needs a tighter or differently-shaped bucket on top of the wrapper's defaults (AI, HEIC, transfer/initiate, invite/validate), or when the route is fully public.

### Using Rate Limits

```typescript
import { applyRateLimit } from '@/lib/api-middleware'
import { RateLimits, getClientIp } from '@/lib/rate-limit'

// Authenticated, per-user (in addition to the wrapper's userMutation cap):
const rateLimited = await applyRateLimit(
  `transfer-decline:${user.userId}`,
  RateLimits.userMutation,
)
if (rateLimited) return rateLimited

// Unauthenticated, per-IP:
const clientIp = getClientIp(request)
const rateLimited = await applyRateLimit(
  `code-validate:${clientIp}`,
  RateLimits.codeValidation,
)
if (rateLimited) return rateLimited
```

> `applyRateLimit` and `checkRateLimit` are **async** — they may call Upstash Redis. Always `await` them.

### Available Rate Limit Presets

| Preset | Limit | Window | Use Case |
|--------|-------|--------|----------|
| `RateLimits.codeValidation` | 10 | 15 min | Invite / transfer code validation (per IP) |
| `RateLimits.ai` | 20 | 1 min | AI routes, shared per user (wallet protection) |
| `RateLimits.aiDaily` | 100 | 24 hr | Per-user daily AI ceiling |
| `RateLimits.aiGlobalDaily` | 10_000 | 24 hr | Global AI daily ceiling (cost circuit-breaker) |
| `RateLimits.heic` | 30 | 1 min | HEIC conversion per user |
| `RateLimits.transferInitiate` | 5 | 15 min | Enumeration protection on transfer/initiate |
| `RateLimits.businessMutation` | 200 | 1 min | Auto-applied by `withBusinessAuth` for writes |
| `RateLimits.userMutation` | 30 | 1 min | Auto-applied by `withAuth` for writes (per-user) |
| `RateLimits.ipMutation` | 600 | 1 min | Auto-applied by `withAuth` for writes (per-IP defense layer) |

The auth surface (`/api/auth/*` — `/email-otp/send-verification-otp`, `/email-otp/verify-email`, `/sign-in/email-otp`) is rate-limited by better-auth itself — those rules live in `apps/api/src/lib/auth.ts` `rateLimit.customRules` with `storage: 'secondary-storage'`, not in `RateLimits`.

### Backend

If `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set at runtime, rate limits live in Upstash Redis (shared across Vercel Lambdas). The same env vars feed BOTH code paths: `apps/api/src/lib/rate-limit.ts` (app-level limits, key prefix `kasero:`) and `apps/api/src/lib/auth.ts`'s `secondaryStorage` adapter (better-auth's auth-surface limits, key prefix `kasero:ba:`). Without the env vars, both paths fall back to in-memory — fine for dev, NOT appropriate for a multi-Lambda prod deploy. See `apps/api/src/lib/rate-limit.ts` for the app-level fail-open-on-outage semantics.

---

## Upload Validation

### Content-Length Pre-Check

Every multipart and base64-in-JSON upload route calls `enforceMaxContentLength` BEFORE reading the body. This rejects oversized requests at 411/413 without buffering the payload into Lambda memory.

```typescript
const oversize = enforceMaxContentLength(request, 5 * 1024 * 1024)
if (oversize) return oversize
```

Per-route caps:
- AI routes (JSON with base64 image): 2 MB
- Profile avatar (JSON with base64 image): 5 MB
- Product icon (multipart): 5 MB
- Business logo (multipart): 5 MB
- Order receipt (multipart): 15 MB
- HEIC conversion (multipart): 30 MB

### Magic-Byte Content Sniffing

`File.type` and `data:image/...;base64,...` MIME prefixes are client-declared and can be spoofed. For any upload stored in the DB and rendered through `<img src=...>`, sniff the decoded bytes against a known-image magic-byte list and store using the SNIFFED type (not the declared one). See `apps/api/src/lib/file-sniff.ts`:

```typescript
import { sniffImageMimeType } from '@/lib/file-sniff'

const buffer = Buffer.from(await logoFile.arrayBuffer())
const sniffed = sniffImageMimeType(buffer)
if (!sniffed) {
  return errorResponse(ApiMessageCode.BUSINESS_UPDATE_LOGO_INVALID_TYPE, 400)
}
update.icon = `data:${sniffed};base64,${buffer.toString('base64')}`
```

`sniffImageMimeType` recognises PNG / JPEG / WebP / GIF. It deliberately does NOT recognise SVG — SVG is disallowed for business logo and avatar uploads because SVG can carry `<script>` (stored-XSS vector via data-URL render). The companion `sniffDocumentMimeType` additionally accepts PDF for receipt-style uploads.

---

## Security Checklist

Before merging any API route, verify:

### Authentication
- [ ] Route is wrapped in `withBusinessAuth` (business-scoped), `withAuth` (user-scoped), or explicitly documents why it's public
- [ ] Unauthenticated requests return 401 (`withBusinessAuth` and `withAuth` handle this automatically)

### Authorization
- [ ] Writes check `canManageBusiness(access.role)` where appropriate
- [ ] Owner-only operations check `isOwner(access.role)`
- [ ] Resources queried by `access.businessId` (never the raw URL param)

### Input Validation
- [ ] All inputs validated with Zod schemas
- [ ] Uses `Schemas.*` for common fields
- [ ] Numeric schemas have `.max()` bounds (use `Schemas.amount()` / `Schemas.positiveAmount()` — they're capped at 1B)
- [ ] Validation failures go through `validationError()`

### Rate Limiting
- [ ] Auto-applied by `withBusinessAuth` for writes
- [ ] Explicit rate limit on every non-business authenticated mutation (invite/join, transfer/decline, AI, HEIC, etc.)
- [ ] Explicit rate limit on every public endpoint (invite/validate, geolocation, etc.) — auth flows under `/api/auth/*` get this from better-auth automatically

### Upload Routes
- [ ] `enforceMaxContentLength` BEFORE `request.formData()` / `request.arrayBuffer()` / `request.json()`
- [ ] Declared MIME type allowlisted (raster formats only for anything rendered via `<img>`)
- [ ] `sniffImageMimeType` (or `sniffDocumentMimeType`) after decoding; stored URL uses the sniffed type

### Response Security
- [ ] Passwords never returned
- [ ] `errorResponse` / `successResponse` for every exit — never raw `NextResponse.json({ error: '...' })`

### Database
- [ ] All queries include `businessId` filter for business-scoped data
- [ ] Use `.returning()` instead of UPDATE + SELECT
- [ ] Wrap multi-write flows in `db.batch([...])` or `db.transaction(async (tx) => {...})`

---

## Locale-Aware Formatting

Every business has a `locale` (e.g. `'en-US'`, `'es-PE'`) and `currency` (e.g. `'USD'`, `'PEN'`) stored in the `businesses` table. These flow through `withBusinessAuth` into `access.businessLocale` and `access.businessCurrency`.

### In API routes (server-side)

Server-side formatting is rarely needed — most formatting happens in the client. When it is needed, use the locale/currency from `access` directly with `Intl`:

```typescript
export const GET = withBusinessAuth(async (_request, access) => {
  const formatted = new Intl.NumberFormat(access.businessLocale, {
    style: 'currency',
    currency: access.businessCurrency,
  }).format(9.99)
  // ...
})
```

### In components (client-side)

**Always use `useBusinessFormat()`** — never hardcode `'en-US'` or `'USD'`:

```tsx
import { useBusinessFormat } from '@/hooks/useBusinessFormat'

const { formatCurrency, formatDate, formatTime } = useBusinessFormat()

formatCurrency(9.99)    // "$9.99" for en-US/USD, "S/ 9.99" for es-PE/PEN
formatDate(new Date())  // "04/10/2026" for en-US
formatTime(new Date())  // "2:30 PM" for en-US
```

### Price inputs

Use `<PriceInput>` from `@/components/ui` for any currency input field. It reads locale/currency from `useBusinessFormat()` automatically and handles decimal/thousand separators, currency symbol positioning, and zero-decimal currencies (CLP, COP, CRC, PYG):

```tsx
import { PriceInput } from '@/components/ui'

<PriceInput
  value={price}
  onValueChange={(value) => setPrice(value ?? '')}
  placeholder="0.00"
/>
```

---

## Route Index

All routes live under `apps/api/src/app/api/`. Write paths (POST/PATCH/DELETE) under `/api/businesses/[businessId]/**` are rate-limited automatically (200/min per user-business) by `withBusinessAuth`. Non-business mutations (invite/join, transfer/decline) are rate-limited inline via `applyRateLimit(..., RateLimits.userMutation)`.

The SPA reaches the API via `/api/*` — same-origin in production, via Vite's dev proxy in development. `apiRequest` always sends `credentials: 'include'`.

### Authentication (better-auth)

The `/api/auth/*` surface is owned by better-auth's `[...all]` catch-all route (`apps/api/src/app/api/auth/[...all]/route.ts`). Don't add or modify route directories under `/api/auth/` — they collide with the catch-all. Account-level operations that don't fit the better-auth surface live at sibling paths (`/api/account/*`).

| Route | Method | Description |
|-------|--------|-------------|
| `/api/auth/[...all]` | GET / POST | better-auth catch-all. The active surface is fully passwordless: `/email-otp/send-verification-otp`, `/email-otp/verify-email`, `/sign-in/email-otp`, `/sign-in/social` (Google), `/sign-out`, `/get-session`, `/update-user`, `/delete-user`, `/list-sessions`, `/revoke-other-sessions`. There are no `/sign-in/email`, `/sign-up/email`, `/change-password`, `/forget-password`, `/reset-password`, or `/two-factor/*` endpoints — the routes don't exist on this build. Rate-limit rules per path are in `apps/api/src/lib/auth.ts` (`/email-otp/send-verification-otp` 1/min, `/email-otp/verify-email` 5/min, `/sign-in/email-otp` 5/min). |
| `/api/account/delete` | POST | Account-deletion wrapper. `withAuth` + OTP step-up (`{ confirmEmail, otp }`) + business-ownership pre-check (rejects with 409 `USER_DELETE_OWNS_BUSINESSES` while the user is the active owner of any business), then delegates to `auth.api.deleteUser`. The OTP is the freshness proof — `session.freshAge` is disabled in `auth.ts`. |
| `/api/account/change-email` | POST | Dual-OTP email change. Phase 1 (`{ phase: 'initiate', newEmail }`) sends OTPs to BOTH the current email and the new email and returns success. Phase 2 (`{ phase: 'confirm', newEmail, oldOtp, newOtp }`) verifies both codes, atomically rewrites `users.email`, marks verified, and revokes every other session for this user. 409 `EMAIL_CHANGE_TARGET_TAKEN` if the new email is already owned by another user. See the OTP step-up section above for the rationale. |
| `/api/cron/cleanup-unverified` | POST | Vercel cron (daily 03:00 UTC). Bearer-token auth via `CRON_SECRET` (`timingSafeEqual`). Runs two cleanups on every invocation: (1) deletes users where `emailVerified = false` AND `createdAt < now - 7d` AND no active business membership; (2) prunes `verification` rows where `expiresAt < now - 1h` (1h buffer past the 10-minute OTP TTL — better-auth never deletes expired OTPs itself, so without this they accumulate). Response shape: `{ deletedCount, verificationsDeleted }`. |
| `/api/user/language` | PATCH | Update UI language preference (writes `users.language`). |

### Business Management

| Route | Method | Description |
|-------|--------|-------------|
| `/api/businesses/list` | GET | List user's active businesses |
| `/api/businesses/create` | POST | Create new business |
| `/api/businesses/[businessId]` | GET | Read full business record (any member) |
| `/api/businesses/[businessId]` | PATCH | Update business metadata + logo (manager) |
| `/api/businesses/[businessId]` | DELETE | Delete a business (owner only) |
| `/api/businesses/[businessId]/access` | GET | Validate user access to business |
| `/api/businesses/[businessId]/leave` | POST | Leave a business (non-owner) |

### Invite Codes (Global)

| Route | Method | Description |
|-------|--------|-------------|
| `/api/invite/validate` | POST | Validate invite or transfer code (rate-limited per IP) |
| `/api/invite/join` | POST | Join business with invite code (rate-limited per user) |

### Ownership Transfer (Incoming / User-Scoped)

| Route | Method | Description |
|-------|--------|-------------|
| `/api/transfer/incoming` | GET | Get the current user's pending incoming transfer |
| `/api/transfer/accept` | POST | Accept ownership transfer (rate-limited per IP) |
| `/api/transfer/decline` | POST | Decline ownership transfer (rate-limited per user) |

### Other

| Route | Method | Description |
|-------|--------|-------------|
| `/api/geolocation` | GET | Best-effort IP → locale/currency hint used by create-business |
| `/api/realtime` | GET | SSE stream — cookie auth, Sec-Fetch-Site CSRF, optional `?businessId`, replays critical stream on reconnect. Region-pinned to iad1. See `.claude/docs/realtime-system.md`. |

### AI Features (Authenticated, rate-limited)

All AI and HEIC routes require authentication (`withAuth` wrapper) and share a per-user budget so a single user can't spread-then-burst across routes.

| Route | Method | Description |
|-------|--------|-------------|
| `/api/ai/identify-product` | POST | Identify product from image (`RateLimits.ai`, 20/min/user) |
| `/api/ai/generate-icon` | POST | Generate emoji icon from image (`RateLimits.ai`) |
| `/api/ai/remove-background` | POST | Remove image background (`RateLimits.ai`) |
| `/api/convert-heic` | POST | Convert HEIC to JPEG (`RateLimits.heic`, 30/min/user) |

---

**Routes below are scoped to `/api/businesses/[businessId]/`.**

### Team Management

| Route | Method | Description |
|-------|--------|-------------|
| `/team` | GET | List team members and invite codes |
| `/invite/create` | POST | Create invite code |
| `/invite/delete` | POST | Delete invite code |
| `/invite/regenerate` | POST | Regenerate invite code |
| `/users/toggle-status` | POST | Toggle user active/disabled |
| `/users/change-role` | POST | Change user role |
| `/users/remove` | POST | Remove a member from the business |

### Ownership Transfer (Outgoing)

| Route | Method | Description |
|-------|--------|-------------|
| `/transfer/initiate` | POST | Initiate ownership transfer |
| `/transfer/pending` | GET | Get pending outgoing transfer |
| `/transfer/cancel` | POST | Cancel pending transfer |

### Products

| Route | Method | Description |
|-------|--------|-------------|
| `/products` | GET | List products (optional `?barcode=<value>` for exact-match lookup) |
| `/products` | POST | Create product (FormData) |
| `/products/[id]` | PATCH | Update product (FormData) |
| `/products/[id]` | DELETE | Delete product |
| `/products/[id]/stock` | PATCH | Adjust stock |
| `/product-settings` | GET | Get sort preferences (from businesses table) |
| `/product-settings` | PATCH | Update settings (on businesses table) |

### Categories

| Route | Method | Description |
|-------|--------|-------------|
| `/categories` | GET | List categories |
| `/categories` | POST | Create category |
| `/categories/[id]` | PATCH | Update category |
| `/categories/[id]` | DELETE | Delete category |
| `/categories/reorder` | POST | Reorder categories |

### Providers

| Route | Method | Description |
|-------|--------|-------------|
| `/providers` | GET | List providers |
| `/providers` | POST | Create provider |
| `/providers/[id]` | GET | Get provider detail + embedded stats + notes |
| `/providers/[id]` | PATCH | Update provider |
| `/providers/[id]` | DELETE | Delete provider (nulls dependent orders' providerId) |
| `/providers/[id]/notes` | POST | Create a note (max 5 per provider) |
| `/providers/[id]/notes/[noteId]` | PATCH | Update a note |
| `/providers/[id]/notes/[noteId]` | DELETE | Delete a note |

### Orders (Purchase Orders)

| Route | Method | Description |
|-------|--------|-------------|
| `/orders` | GET | List orders with items |
| `/orders` | POST | Create order (FormData) |
| `/orders/[id]` | PATCH | Update order (FormData) |
| `/orders/[id]` | DELETE | Delete order |
| `/orders/[id]/receive` | POST | Receive order, update stock |

### Sales Sessions (cash drawer / shift)

| Route | Method | Description |
|-------|--------|-------------|
| `/sales-sessions` | GET | List sales sessions |
| `/sales-sessions/current` | GET | Currently open session, if any |
| `/sales-sessions/open` | POST | Open a new session |
| `/sales-sessions/close` | POST | Close the open session |
| `/sales-sessions/[id]` | GET | Session detail |
| `/sales-sessions/[id]/sales` | GET | Sales recorded against the session |

### Sales (register)

| Route | Method | Description |
|-------|--------|-------------|
| `/sales` | GET | List sales |
| `/sales` | POST | Record a sale |
| `/sales/[id]` | GET / PATCH / DELETE | Read / update / void a sale |
| `/sales/aggregate` | GET | Daily / period aggregates |

---

## File Reference

| File | Purpose |
|------|---------|
| `apps/api/src/lib/api-middleware.ts` | `withBusinessAuth`, `withAuth` (with `allowUnverified` opt-out), `errorResponse`, `successResponse`, `validationError`, `applyRateLimit`, `enforceMaxContentLength`. CSRF defense via `enforceSameOrigin` (internal). |
| `apps/web/src/lib/api-client.ts` | `apiRequest`, `apiPost`, `apiPatch`, `apiDelete`, `apiPostForm`, `apiPatchForm`, `ApiError` |
| `packages/shared/src/api-messages.ts` | `ApiMessageCode` union + `ApiMessageEnvelope` shape + `hasMessageEnvelope` type guard |
| `apps/api/src/lib/schemas.ts` | `Schemas.*` — server-side Zod schema builders for common field types |
| `apps/api/src/lib/business-auth.ts` | `requireBusinessAccess` (DB session lookup + emailVerified gate), `canManageBusiness`, `isOwner`, `BusinessAccess`, `invalidateAccessCache*` |
| `apps/api/src/lib/rate-limit.ts` | `checkRateLimit`, `getClientIp`, `RateLimits` presets; Upstash-or-memory backend, key prefix `kasero:`. Independent of better-auth's `secondaryStorage` (different key prefix: `kasero:` vs `kasero:ba:`) |
| `apps/api/src/lib/auth.ts` | better-auth config — emailOTP plugin (sign-in mode), Google OAuth, cross-account verification hook, Redis-backed rate-limit rules via `secondaryStorage` (key prefix `kasero:ba:`), `trustedOrigins` (extended from `BETTER_AUTH_TRUSTED_ORIGINS`), cookie config |
| `apps/api/src/lib/email.ts` | Resend integration for email-OTP send; locale-aware via `i18n-server.ts` |
| `apps/api/src/lib/i18n-server.ts` | Server-side message bundle used by transactional emails |
| `apps/api/src/middleware.ts` | Edge middleware — cookie-presence-only session check, public-path allowlist (`/`, `/register`, `/join`) |
| `apps/web/src/lib/auth-client.ts` | better-auth React client with `emailOTPClient` + `inferAdditionalFields` plugins |
| `apps/web/src/contexts/auth-context.tsx` | Wraps `authClient.useSession()`; exposes `sendOtp`, `verifyOtp` (returns `isNewUser`), `setName`, `linkGoogle`, `logout`, `refreshUser`, `changeLanguage` |
| `apps/api/src/lib/file-sniff.ts` | `sniffImageMimeType`, `sniffDocumentMimeType` for magic-byte upload validation |
| `apps/web/src/lib/locale-config.ts` | `getCurrencyForLocale()`, `getLocalesByRegion()`, `REGIONS` |
| `apps/web/src/hooks/useBusinessFormat.ts` | `useBusinessFormat()` — locale-aware formatters for components |
| `apps/web/src/hooks/useApiMessage.ts` | `useApiMessage()` — translates an `ApiMessageEnvelope` to a localized string |
| `apps/web/src/components/ui/PriceInput.tsx` | Locale-aware currency input component |
| `packages/shared/src/business-role.ts` | `BusinessRole` enum + `canManageBusiness`/`canManageTeam`/`isOwner` helpers (consumed by both apps) |
