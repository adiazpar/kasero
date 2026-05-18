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
    role: access.role,
  })
})
