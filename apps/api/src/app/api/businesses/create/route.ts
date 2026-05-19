import { db, businesses, businessUsers } from '@/db'
import { nanoid } from 'nanoid'
import { eq, and, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  validationError,
  errorResponse,
  successResponse,
  withAuth,
  enforceMaxContentLength,
} from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { Schemas } from '@/lib/schemas'
import { getCurrencyForLocale } from '@kasero/shared/locale-config'
import { logServerError } from '@/lib/server-logger'
import { publishToUser, getOriginDeviceId } from '@/lib/realtime'

const createBusinessSchema = z.object({
  name: Schemas.name().max(100),
  locale: Schemas.locale(),
  currency: Schemas.currency().optional(), // Auto-set from locale if not provided
  icon: Schemas.businessIcon(),
})

// Icon is the only large field; Schemas.businessIcon caps at 2 MB
// decoded base64. 3 MB on the JSON envelope leaves headroom for the
// other fields without letting an attacker stream multi-megabyte
// payloads into Lambda memory pre-validation.
const MAX_BODY_BYTES = 3 * 1024 * 1024

// Per-user cap on owned businesses. Mitigates cost-amplification via
// rapid create-then-delete loops that would otherwise burn DB write
// metering on Turso. A small business operator with > 50 owned
// businesses is unrealistic; if support hears a real complaint the
// cap can be lifted on a case-by-case basis.
const MAX_OWNED_BUSINESSES_PER_USER = 50

/**
 * POST /api/businesses/create
 *
 * Creates a new business and adds the current user as owner.
 * Any authenticated user can create a business.
 *
 * Wrapped in withAuth so the per-user-mutation + per-IP guardrails
 * fire automatically. Body capped at MAX_BODY_BYTES; per-user owned
 * count capped at MAX_OWNED_BUSINESSES_PER_USER.
 */
export const POST = withAuth(async (request, user) => {
  try {
    const oversize = enforceMaxContentLength(request, MAX_BODY_BYTES)
    if (oversize) return oversize

    // Per-user business cap. Cheap COUNT — uses the existing
    // (userId, businessId) composite index on business_users.
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(businessUsers)
      .where(
        and(
          eq(businessUsers.userId, user.userId),
          eq(businessUsers.role, 'owner'),
          eq(businessUsers.status, 'active'),
        ),
      )
    if (Number(count) >= MAX_OWNED_BUSINESSES_PER_USER) {
      return errorResponse(ApiMessageCode.BUSINESS_OWNED_CAP_REACHED, 409, {
        max: MAX_OWNED_BUSINESSES_PER_USER,
      })
    }

    const body = await request.json()
    const validation = createBusinessSchema.safeParse(body)

    if (!validation.success) {
      return validationError(validation)
    }

    const { name, locale, currency, icon } = validation.data
    const now = new Date()

    // Auto-derive currency from locale if the client didn't specify it.
    const finalCurrency = currency || getCurrencyForLocale(locale)

    // Create business + owner membership atomically
    const businessId = nanoid()
    const membershipId = nanoid()
    await db.batch([
      db.insert(businesses).values({
        id: businessId,
        name: name.trim(),
        locale,
        currency: finalCurrency,
        icon: icon || null,
      }),
      db.insert(businessUsers).values({
        id: membershipId,
        userId: user.userId,
        businessId,
        role: 'owner',
        status: 'active',
        createdAt: now,
      }),
    ])

    await publishToUser(user.userId, {
      type: 'business.list.changed',
      reason: 'added',
    }, getOriginDeviceId(request))

    return successResponse({
      business: {
        id: businessId,
        name: name.trim(),
      },
    })
  } catch (error) {
    logServerError('businesses.create', error)
    return errorResponse(ApiMessageCode.BUSINESS_CREATE_FAILED, 500)
  }
}, { maxBodyBytes: MAX_BODY_BYTES })
