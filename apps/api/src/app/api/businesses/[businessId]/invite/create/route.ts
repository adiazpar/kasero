import { db, inviteCodes } from '@/db'
import { nanoid } from 'nanoid'
import { eq, and, gt, sql, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { canManageBusiness } from '@/lib/business-auth'
import { withBusinessAuth, validationError, errorResponse, successResponse } from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { isExpiryWithinBounds } from '@/lib/invite-expiry'
import { generateInviteCode } from '@kasero/shared/auth'
import { logServerError } from '@/lib/server-logger'
import { publishToBusiness, getOriginDeviceId } from '@/lib/realtime'

// Server-supplied codes only — the client used to send `code` in the
// payload, which let a malicious manager pick a memorable string
// (`AAAAAA`, `123456`) and collapse the brute-force keyspace from
// 32^6 ≈ 1B to "obvious patterns". Now the server generates via
// crypto.getRandomValues from a no-confusable alphabet (see
// generateInviteCode in lib/auth.ts) and ignores any client value.
const createInviteSchema = z.object({
  role: z.enum(['partner', 'employee']),
  expiresAt: z.iso.datetime(),
})

// Cap on simultaneously-active invite codes per business. Without a
// cap a malicious manager could create 100k codes to pollute the
// keyspace (raises the per-attempt brute-force probability from
// ~1/1B to ~1/10000). 10 covers the realistic UX of "I have a few
// codes for different roles or onboarding waves".
const MAX_ACTIVE_INVITE_CODES_PER_BUSINESS = 10

// Up to 5 collision retries when generating the random code. The
// effective per-attempt collision probability against ~10k codes
// in the table is ~10000/1B = 0.001%, so the loop almost never
// exceeds one iteration in practice.
const CODE_GENERATION_ATTEMPTS = 5

/**
 * POST /api/businesses/[businessId]/invite/create
 *
 * Create a new invite code with a server-generated 6-char value.
 */
export const POST = withBusinessAuth(async (request, access) => {
  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.TEAM_FORBIDDEN_NOT_MANAGER, 403)
  }

  const body = await request.json()
  const validation = createInviteSchema.safeParse(body)

  if (!validation.success) {
    return validationError(validation)
  }

  const { role, expiresAt } = validation.data

  if (!isExpiryWithinBounds(new Date(expiresAt))) {
    return errorResponse(ApiMessageCode.INVITE_EXPIRY_OUT_OF_RANGE, 400)
  }

  // Per-business cap. "Active" means: not yet redeemed AND not
  // expired. Expired/used codes don't count toward the limit (the
  // operator has already committed those slots to history).
  const now = new Date()
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(inviteCodes)
    .where(
      and(
        eq(inviteCodes.businessId, access.businessId),
        isNull(inviteCodes.usedBy),
        gt(inviteCodes.expiresAt, now),
      ),
    )
  if (Number(count) >= MAX_ACTIVE_INVITE_CODES_PER_BUSINESS) {
    return errorResponse(ApiMessageCode.INVITE_CAP_REACHED, 409, {
      max: MAX_ACTIVE_INVITE_CODES_PER_BUSINESS,
    })
  }

  // Generate the code server-side and retry on the (vanishingly
  // small) chance of unique-index collision. The unique index on
  // inviteCodes.code is a hard constraint; generating then trying
  // is cheaper than pre-checking.
  let inviteId = ''
  let code = ''
  let lastError: unknown = null
  for (let attempt = 0; attempt < CODE_GENERATION_ATTEMPTS; attempt++) {
    inviteId = nanoid()
    code = generateInviteCode()
    try {
      await db.insert(inviteCodes).values({
        id: inviteId,
        businessId: access.businessId,
        code,
        role,
        expiresAt: new Date(expiresAt),
      })
      lastError = null
      break
    } catch (err) {
      lastError = err
      // Retry only on what looks like a unique-index collision; any
      // other DB error (FK, NOT NULL, etc.) bubbles immediately.
      const message = err instanceof Error ? err.message.toLowerCase() : ''
      if (!message.includes('unique')) throw err
    }
  }
  if (lastError) {
    logServerError('invite.create.exhausted-retries', lastError)
    return errorResponse(ApiMessageCode.INTERNAL_ERROR, 500)
  }

  await publishToBusiness(
    access.businessId,
    { type: 'team.invite.created', inviteId },
    getOriginDeviceId(request),
  )

  return successResponse({ id: inviteId, code })
})
