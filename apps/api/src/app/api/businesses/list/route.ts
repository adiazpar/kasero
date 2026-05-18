import { NextRequest } from 'next/server'
import { db, businesses, businessUsers } from '@/db'
import { eq, and, sql } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { errorResponse, successResponse } from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { logServerError } from '@/lib/server-logger'

/**
 * GET /api/businesses/list
 *
 * List all businesses the current user belongs to.
 * Uses the business_users join table for multi-business support.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: request.headers })
    if (!session) {
      return errorResponse(ApiMessageCode.UNAUTHORIZED, 401)
    }
    if (!session.user.emailVerified) {
      return errorResponse(ApiMessageCode.EMAIL_NOT_VERIFIED, 403)
    }

    // Query business_users joined with businesses for this user.
    // Status filter lives in SQL (indexed) so we don't pull disabled
    // / pending rows across the wire just to drop them client-side.
    // LIMIT 100 is a defensive ceiling — real users have single-digit
    // memberships.
    const activeMemberships = await db
      .select({
        businessId: businessUsers.businessId,
        role: businessUsers.role,
        status: businessUsers.status,
        businessName: businesses.name,
        businessIcon: businesses.icon,
        businessLocale: businesses.locale,
        businessCurrency: businesses.currency,
      })
      .from(businessUsers)
      .innerJoin(businesses, eq(businessUsers.businessId, businesses.id))
      .where(
        and(
          eq(businessUsers.userId, session.user.id),
          eq(businessUsers.status, 'active'),
        ),
      )
      .limit(100)

    // Get member counts for each business
    const businessIds = activeMemberships.map(m => m.businessId)
    const memberCounts: Record<string, number> = {}

    if (businessIds.length > 0) {
      const counts = await db
        .select({
          businessId: businessUsers.businessId,
          count: sql<number>`count(*)`.as('count'),
        })
        .from(businessUsers)
        .where(and(
          sql`${businessUsers.businessId} IN (${sql.join(businessIds.map(id => sql`${id}`), sql`, `)})`,
          eq(businessUsers.status, 'active')
        ))
        .groupBy(businessUsers.businessId)

      for (const row of counts) {
        memberCounts[row.businessId] = Number(row.count)
      }
    }

    return successResponse({
      businesses: activeMemberships.map(m => ({
        id: m.businessId,
        name: m.businessName,
        role: m.role,
        isOwner: m.role === 'owner',
        memberCount: memberCounts[m.businessId] || 1,
        icon: m.businessIcon,
        locale: m.businessLocale ?? 'en-US',
        currency: m.businessCurrency ?? 'USD',
      })),
    })
  } catch (error) {
    logServerError('businesses.list', error)
    return errorResponse(ApiMessageCode.BUSINESS_LIST_FAILED, 500)
  }
}
