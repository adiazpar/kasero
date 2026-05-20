import { db, providers, providerNotes, orders } from '@/db'
import { eq, and, desc, sql } from 'drizzle-orm'
import { z } from 'zod'
import { canManageBusiness } from '@/lib/business-auth'
import { withBusinessAuth, validationError, errorResponse, successResponse } from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { Schemas } from '@/lib/schemas'
import { publishToBusiness, getOriginDeviceId } from '@/lib/realtime'

const updateProviderSchema = z.object({
  name: Schemas.name().optional(),
  phone: Schemas.phone(),
  email: Schemas.email().nullable().optional(),
  active: z.boolean().optional(),
})

/**
 * GET /api/businesses/[businessId]/providers/[id]
 *
 * Return one provider with aggregated stats: total orders, total spent,
 * most recent order date. Used by the provider detail page.
 */
export const GET = withBusinessAuth(async (_request, access, routeParams) => {
  const id = routeParams?.id
  if (!id) {
    return errorResponse(ApiMessageCode.PROVIDER_NOT_FOUND, 404)
  }

  const [provider] = await db
    .select()
    .from(providers)
    .where(and(eq(providers.id, id), eq(providers.businessId, access.businessId)))
    .limit(1)

  if (!provider) {
    return errorResponse(ApiMessageCode.PROVIDER_NOT_FOUND, 404)
  }

  const [stats] = await db
    .select({
      totalOrders: sql<number>`count(${orders.id})`,
      totalSpent: sql<number>`coalesce(sum(${orders.total}), 0)`,
      lastOrderDate: sql<number | null>`max(${orders.date})`,
    })
    .from(orders)
    .where(and(eq(orders.providerId, id), eq(orders.businessId, access.businessId)))

  // Notes list is embedded in the provider-detail response so a single
  // fetch hydrates everything the detail page renders. Newest-first by
  // createdAt — list order is stable across edits. The POST route caps
  // at MAX_PROVIDER_NOTES (5); the 50 limit here is belt-and-braces in
  // case the cap was ever bypassed.
  const notes = await db
    .select()
    .from(providerNotes)
    .where(and(
      eq(providerNotes.providerId, id),
      eq(providerNotes.businessId, access.businessId),
    ))
    .orderBy(desc(providerNotes.createdAt))
    .limit(50)

  return successResponse({
    provider: { ...provider, notes },
    stats: {
      totalOrders: Number(stats?.totalOrders ?? 0),
      totalSpent: Number(stats?.totalSpent ?? 0),
      lastOrderDate: stats?.lastOrderDate ? new Date(Number(stats.lastOrderDate) * 1000).toISOString() : null,
    },
  })
})

/**
 * PATCH /api/businesses/[businessId]/providers/[id]
 *
 * Update a provider. All fields optional — provide only what changes.
 */
export const PATCH = withBusinessAuth(async (request, access, routeParams) => {
  const originDeviceId = getOriginDeviceId(request)

  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.PROVIDER_FORBIDDEN_NOT_MANAGER, 403)
  }

  const id = routeParams?.id
  if (!id) {
    return errorResponse(ApiMessageCode.PROVIDER_NOT_FOUND, 404)
  }

  const [existing] = await db
    .select()
    .from(providers)
    .where(and(eq(providers.id, id), eq(providers.businessId, access.businessId)))
    .limit(1)

  if (!existing) {
    return errorResponse(ApiMessageCode.PROVIDER_NOT_FOUND, 404)
  }

  const body = await request.json()
  const validation = updateProviderSchema.safeParse(body)
  if (!validation.success) {
    return validationError(validation)
  }

  const { name, phone, email, active } = validation.data
  const updateData: Record<string, unknown> = {}
  const changedFields: Array<'name' | 'phone' | 'email' | 'active'> = []
  if (name !== undefined) { updateData.name = name; changedFields.push('name') }
  if (phone !== undefined) { updateData.phone = phone || null; changedFields.push('phone') }
  if (email !== undefined) { updateData.email = email || null; changedFields.push('email') }
  if (active !== undefined) { updateData.active = active; changedFields.push('active') }

  const [updated] = await db
    .update(providers)
    .set(updateData)
    .where(eq(providers.id, id))
    .returning()

  // Return the provider with its notes embedded (same shape as GET) so the
  // client's setProvider(result.provider) keeps the notes list intact.
  const notes = await db
    .select()
    .from(providerNotes)
    .where(and(
      eq(providerNotes.providerId, id),
      eq(providerNotes.businessId, access.businessId),
    ))
    .orderBy(desc(providerNotes.createdAt))
    .limit(50)

  if (changedFields.length > 0) {
    await publishToBusiness(access.businessId, {
      type: 'provider.updated',
      providerId: id,
      fields: changedFields,
    }, originDeviceId)
  }

  return successResponse({ provider: { ...updated, notes } })
})

/**
 * DELETE /api/businesses/[businessId]/providers/[id]
 *
 * Hard-delete the provider. The orders table has a nullable providerId FK
 * with no onDelete cascade declared, so we null it out on dependent orders
 * first. Product name snapshots on each order item are unaffected.
 */
export const DELETE = withBusinessAuth(async (request, access, routeParams) => {
  const originDeviceId = getOriginDeviceId(request)

  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.PROVIDER_FORBIDDEN_NOT_MANAGER, 403)
  }

  const id = routeParams?.id
  if (!id) {
    return errorResponse(ApiMessageCode.PROVIDER_NOT_FOUND, 404)
  }

  const [existing] = await db
    .select()
    .from(providers)
    .where(and(eq(providers.id, id), eq(providers.businessId, access.businessId)))
    .limit(1)

  if (!existing) {
    return errorResponse(ApiMessageCode.PROVIDER_NOT_FOUND, 404)
  }

  // Atomic: null out any orders pointing at this provider, then delete
  // the provider. Previously sequential, so a failure between the two
  // steps could orphan orders referencing a non-existent provider.
  await db.batch([
    db
      .update(orders)
      .set({ providerId: null })
      .where(and(eq(orders.providerId, id), eq(orders.businessId, access.businessId))),
    db.delete(providers).where(eq(providers.id, id)),
  ])

  await publishToBusiness(access.businessId, {
    type: 'provider.deleted',
    providerId: id,
  }, originDeviceId)

  return successResponse({})
})
