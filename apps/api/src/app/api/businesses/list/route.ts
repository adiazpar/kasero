import { NextRequest } from 'next/server'
import { db, businesses, businessUsers } from '@/db'
import { eq, and, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
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
    //
    // memberCount is a correlated subquery so the whole list is one round
    // trip on the libSQL HTTP driver. The inner scan is aliased away, so
    // the unaliased business_users reference resolves to the outer join row.
    const memberRows = alias(businessUsers, 'member_rows')
    const activeMemberships = await db
      .select({
        businessId: businessUsers.businessId,
        role: businessUsers.role,
        status: businessUsers.status,
        businessName: businesses.name,
        businessIcon: businesses.icon,
        businessLocale: businesses.locale,
        businessCurrency: businesses.currency,
        businessTaxRate: businesses.taxRate,
        businessTaxMode: businesses.taxMode,
        plan: businesses.plan,
        planExpiresAt: businesses.planExpiresAt,
        memberCount: sql<number>`(SELECT COUNT(*) FROM ${businessUsers} AS ${memberRows} WHERE ${memberRows.businessId} = ${businessUsers.businessId} AND ${memberRows.status} = 'active')`,
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

    return successResponse({
      businesses: activeMemberships.map(m => ({
        id: m.businessId,
        name: m.businessName,
        role: m.role,
        isOwner: m.role === 'owner',
        memberCount: Number(m.memberCount) || 1,
        icon: m.businessIcon,
        locale: m.businessLocale ?? 'en-US',
        currency: m.businessCurrency ?? 'USD',
        taxRate: m.businessTaxRate ?? 0,
        taxMode: m.businessTaxMode ?? 'none',
        // Raw tier — clients derive entitlement via isPro() from
        // @kasero/shared/entitlements. Seeds the business shell cache so
        // a cache-hit entry into a business doesn't lose the plan.
        plan: m.plan ?? 'free',
        planExpiresAt: m.planExpiresAt,
      })),
    })
  } catch (error) {
    logServerError('businesses.list', error)
    return errorResponse(ApiMessageCode.BUSINESS_LIST_FAILED, 500)
  }
}
