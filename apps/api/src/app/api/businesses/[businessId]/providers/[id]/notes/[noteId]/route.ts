import { db, providerNotes } from '@/db'
import { eq, and, desc } from 'drizzle-orm'
import { z } from 'zod'
import { canManageBusiness } from '@/lib/business-auth'
import { withBusinessAuth, validationError, errorResponse, successResponse } from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { NOTE_TITLE_MAX, NOTE_BODY_MAX } from '@kasero/shared/provider-notes'
import { publishToBusiness, getOriginDeviceId } from '@/lib/realtime'

const updateNoteSchema = z.object({
  title: z.string().min(1).max(NOTE_TITLE_MAX).optional(),
  body: z.string().min(1).max(NOTE_BODY_MAX).optional(),
})

async function fetchNotesList(providerId: string, businessId: string) {
  return db
    .select()
    .from(providerNotes)
    .where(and(
      eq(providerNotes.providerId, providerId),
      eq(providerNotes.businessId, businessId),
    ))
    .orderBy(desc(providerNotes.createdAt))
}

/**
 * PATCH /api/businesses/[businessId]/providers/[id]/notes/[noteId]
 *
 * Update a single note. Title and body are independently optional.
 */
export const PATCH = withBusinessAuth(async (request, access, routeParams) => {
  const originDeviceId = getOriginDeviceId(request)

  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.PROVIDER_FORBIDDEN_NOT_MANAGER, 403)
  }

  const providerId = routeParams?.id
  const noteId = routeParams?.noteId
  if (!providerId || !noteId) {
    return errorResponse(ApiMessageCode.PROVIDER_NOTE_NOT_FOUND, 404)
  }

  const [existing] = await db
    .select()
    .from(providerNotes)
    .where(and(
      eq(providerNotes.id, noteId),
      eq(providerNotes.providerId, providerId),
      eq(providerNotes.businessId, access.businessId),
    ))
    .limit(1)

  if (!existing) {
    return errorResponse(ApiMessageCode.PROVIDER_NOTE_NOT_FOUND, 404)
  }

  const body = await request.json()
  const validation = updateNoteSchema.safeParse(body)
  if (!validation.success) {
    return validationError(validation)
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() }
  if (validation.data.title !== undefined) updateData.title = validation.data.title.trim()
  if (validation.data.body !== undefined) updateData.body = validation.data.body.trim()

  const [updated] = await db
    .update(providerNotes)
    .set(updateData)
    .where(eq(providerNotes.id, noteId))
    .returning()

  const notes = await fetchNotesList(providerId, access.businessId)

  await publishToBusiness(access.businessId, {
    type: 'provider.updated',
    providerId: providerId,
    fields: ['notes'],
  }, originDeviceId)

  return successResponse({ note: updated, notes }, ApiMessageCode.PROVIDER_NOTE_UPDATED)
})

/**
 * DELETE /api/businesses/[businessId]/providers/[id]/notes/[noteId]
 */
export const DELETE = withBusinessAuth(async (request, access, routeParams) => {
  const originDeviceId = getOriginDeviceId(request)

  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.PROVIDER_FORBIDDEN_NOT_MANAGER, 403)
  }

  const providerId = routeParams?.id
  const noteId = routeParams?.noteId
  if (!providerId || !noteId) {
    return errorResponse(ApiMessageCode.PROVIDER_NOTE_NOT_FOUND, 404)
  }

  const [existing] = await db
    .select({ id: providerNotes.id })
    .from(providerNotes)
    .where(and(
      eq(providerNotes.id, noteId),
      eq(providerNotes.providerId, providerId),
      eq(providerNotes.businessId, access.businessId),
    ))
    .limit(1)

  if (!existing) {
    return errorResponse(ApiMessageCode.PROVIDER_NOTE_NOT_FOUND, 404)
  }

  await db.delete(providerNotes).where(eq(providerNotes.id, noteId))

  const notes = await fetchNotesList(providerId, access.businessId)

  await publishToBusiness(access.businessId, {
    type: 'provider.updated',
    providerId: providerId,
    fields: ['notes'],
  }, originDeviceId)

  return successResponse({ notes }, ApiMessageCode.PROVIDER_NOTE_DELETED)
})
