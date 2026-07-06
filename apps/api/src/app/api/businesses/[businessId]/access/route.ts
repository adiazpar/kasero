import { withBusinessAuth, successResponse } from '@/lib/api-middleware'

/**
 * GET /api/businesses/[businessId]/access
 *
 * Validate that the current user has access to the specified business.
 * Returns the user's role and business info.
 */
export const GET = withBusinessAuth(async (_request, access) => {
  return successResponse({
    businessId: access.businessId,
    businessName: access.businessName,
    businessIcon: access.businessIcon,
    businessLocale: access.businessLocale,
    businessCurrency: access.businessCurrency,
    businessTaxRate: access.businessTaxRate,
    businessTaxMode: access.businessTaxMode,
    // Raw tier + expiry. Clients must derive entitlement via
    // isPro(plan, planExpiresAt) from @kasero/shared/entitlements.
    plan: access.plan,
    planExpiresAt: access.planExpiresAt,
    role: access.role,
  })
})
