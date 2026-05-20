import { db, salesSessions } from '@/db'
import { nanoid } from 'nanoid'
import {
  withBusinessAuth,
  enforceMaxContentLength,
  errorResponse,
  successResponse,
  validationError,
} from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { canManageBusiness } from '@kasero/shared/business-role'
import { openSessionSchema } from '../schema'
import { publishToBusiness, getOriginDeviceId } from '@/lib/realtime'
import type { SalesSession } from '@kasero/shared/types/sale'

const POST_MAX_BODY_BYTES = 1024  // tiny: { startingCash: number }

/**
 * POST /api/businesses/[businessId]/sales-sessions/open
 *
 * Open a cash-drawer session. Fails with SESSION_ALREADY_OPEN (409) if
 * the partial unique index detects an existing open session for this
 * business. Any active member may open.
 */
export const POST = withBusinessAuth(async (request, access) => {
  const originDeviceId = getOriginDeviceId(request)
  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.SESSION_FORBIDDEN_NOT_MANAGER, 403)
  }

  const oversize = enforceMaxContentLength(request, POST_MAX_BODY_BYTES)
  if (oversize) return oversize

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return errorResponse(ApiMessageCode.VALIDATION_GENERIC, 400)
  }

  const parsed = openSessionSchema.safeParse(raw)
  if (!parsed.success) return validationError(parsed)

  const id = nanoid()
  const openedAt = new Date()

  try {
    await db.insert(salesSessions).values({
      id,
      businessId: access.businessId,
      openedAt,
      openedByUserId: access.userId,
      startingCash: parsed.data.startingCash,
      closedAt: null,
      closedByUserId: null,
      countedCash: null,
      salesCount: null,
      salesTotal: null,
      cashSalesTotal: null,
      expectedCash: null,
      variance: null,
      notes: null,
    })
  } catch (err) {
    // Partial unique index `idx_unique_sales_sessions_open_per_business`
    // raises a SQLite UNIQUE constraint violation when another session is
    // already open for this business.
    if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) {
      return errorResponse(ApiMessageCode.SESSION_ALREADY_OPEN, 409)
    }
    throw err
  }

  await publishToBusiness(
    access.businessId,
    { type: 'sales_session.opened', sessionId: id },
    originDeviceId,
  )

  const session: SalesSession = {
    id,
    openedAt: openedAt.toISOString(),
    openedByUserId: access.userId,
    startingCash: parsed.data.startingCash,
    closedAt: null,
    closedByUserId: null,
    countedCash: null,
    salesCount: null,
    salesTotal: null,
    cashSalesTotal: null,
    expectedCash: null,
    variance: null,
    notes: null,
  }
  return successResponse({ session })
})
