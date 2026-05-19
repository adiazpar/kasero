import { db, inviteCodes } from '@/db'
import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { canManageBusiness } from '@/lib/business-auth'
import { withBusinessAuth, validationError, errorResponse, successResponse } from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { isExpiryWithinBounds } from '@/lib/invite-expiry'
import { Schemas } from '@/lib/schemas'
import { generateInviteCode } from '@kasero/shared/auth'
import { logServerError } from '@/lib/server-logger'
import { publishToBusiness, getOriginDeviceId } from '@/lib/realtime'

// Same rationale as invite/create: code is server-generated. Client
// no longer sends `newCode`.
const regenerateInviteSchema = z.object({
  oldCodeId: Schemas.id(),
  role: z.enum(['partner', 'employee']),
  expiresAt: z.iso.datetime(),
})

const CODE_GENERATION_ATTEMPTS = 5

/**
 * POST /api/businesses/[businessId]/invite/regenerate
 *
 * Delete old invite code and create a new one with a server-generated
 * 6-char value. The per-business active-code cap is NOT re-checked
 * here because we delete the old code first — the active count is
 * unchanged across the operation.
 */
export const POST = withBusinessAuth(async (request, access) => {
  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.TEAM_FORBIDDEN_NOT_MANAGER, 403)
  }

  const body = await request.json()
  const validation = regenerateInviteSchema.safeParse(body)

  if (!validation.success) {
    return validationError(validation)
  }

  const { oldCodeId, role, expiresAt } = validation.data

  if (!isExpiryWithinBounds(new Date(expiresAt))) {
    return errorResponse(ApiMessageCode.INVITE_EXPIRY_OUT_OF_RANGE, 400)
  }

  // Delete old code
  await db
    .delete(inviteCodes)
    .where(
      and(
        eq(inviteCodes.id, oldCodeId),
        eq(inviteCodes.businessId, access.businessId)
      )
    )

  // Create new code, retrying on unique-index collision (same shape
  // as invite/create).
  let newCodeId = ''
  let newCode = ''
  let lastError: unknown = null
  for (let attempt = 0; attempt < CODE_GENERATION_ATTEMPTS; attempt++) {
    newCodeId = nanoid()
    newCode = generateInviteCode()
    try {
      await db.insert(inviteCodes).values({
        id: newCodeId,
        businessId: access.businessId,
        code: newCode,
        role,
        expiresAt: new Date(expiresAt),
      })
      lastError = null
      break
    } catch (err) {
      lastError = err
      const message = err instanceof Error ? err.message.toLowerCase() : ''
      if (!message.includes('unique')) throw err
    }
  }
  if (lastError) {
    logServerError('invite.regenerate.exhausted-retries', lastError)
    return errorResponse(ApiMessageCode.INTERNAL_ERROR, 500)
  }

  await publishToBusiness(
    access.businessId,
    { type: 'team.invite.regenerated', inviteId: newCodeId },
    getOriginDeviceId(request),
  )

  return successResponse({ id: newCodeId, code: newCode })
})
