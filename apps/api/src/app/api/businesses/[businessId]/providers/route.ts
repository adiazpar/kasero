import { db, providers } from '@/db'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { canManageBusiness } from '@/lib/business-auth'
import { withBusinessAuth, validationError, errorResponse, successResponse } from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { Schemas } from '@/lib/schemas'
import { publishToBusiness, getOriginDeviceId } from '@/lib/realtime'

const createProviderSchema = z.object({
  name: Schemas.name(),
  phone: Schemas.phone(),
  email: Schemas.email().nullable().optional(),
  active: z.boolean().default(true),
})

/**
 * GET /api/businesses/[businessId]/providers
 *
 * List all providers for the specified business.
 */
export const GET = withBusinessAuth(async (request, access) => {
  const { searchParams } = new URL(request.url)
  const activeOnly = searchParams.get('active') === 'true'

  // Defensive cap. Real businesses maintain tens of providers; 500 gives
  // ample headroom while bounding the response shape.
  const providersList = await db
    .select()
    .from(providers)
    .where(eq(providers.businessId, access.businessId))
    .limit(500)

  const filtered = activeOnly
    ? providersList.filter(p => p.active)
    : providersList

  return successResponse({ providers: filtered })
})

/**
 * POST /api/businesses/[businessId]/providers
 *
 * Create a new provider.
 */
export const POST = withBusinessAuth(async (request, access) => {
  const originDeviceId = getOriginDeviceId(request)

  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.PROVIDER_FORBIDDEN_NOT_MANAGER, 403)
  }

  const body = await request.json()
  const validation = createProviderSchema.safeParse(body)

  if (!validation.success) {
    return validationError(validation)
  }

  const { name, phone, email, active } = validation.data

  const providerId = nanoid()

  const [newProvider] = await db.insert(providers).values({
    id: providerId,
    businessId: access.businessId,
    name,
    phone: phone || null,
    email: email || null,
    active,
    createdAt: new Date(),
  }).returning()

  await publishToBusiness(access.businessId, {
    type: 'provider.created',
    providerId: providerId,
  }, originDeviceId)

  // Fresh providers have no notes yet; include the empty array so the
  // client sees the same shape as the GET response.
  return successResponse({ provider: { ...newProvider, notes: [] } })
})
