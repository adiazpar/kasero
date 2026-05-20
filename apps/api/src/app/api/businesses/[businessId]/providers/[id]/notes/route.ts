import { db, providers, providerNotes } from '@/db'
import { eq, and, desc, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { canManageBusiness } from '@/lib/business-auth'
import { withBusinessAuth, validationError, errorResponse, successResponse } from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { MAX_PROVIDER_NOTES, NOTE_TITLE_MAX, NOTE_BODY_MAX } from '@kasero/shared/provider-notes'
import { publishToBusiness, getOriginDeviceId } from '@/lib/realtime'

const createNoteSchema = z.object({
  title: z.string().min(1).max(NOTE_TITLE_MAX),
  body: z.string().min(1).max(NOTE_BODY_MAX),
})

/**
 * POST /api/businesses/[businessId]/providers/[id]/notes
 *
 * Create a new note on a provider. Caps at MAX_PROVIDER_NOTES per provider.
 */
export const POST = withBusinessAuth(async (request, access, routeParams) => {
  const originDeviceId = getOriginDeviceId(request)

  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.PROVIDER_FORBIDDEN_NOT_MANAGER, 403)
  }

  const providerId = routeParams?.id
  if (!providerId) {
    return errorResponse(ApiMessageCode.PROVIDER_NOT_FOUND, 404)
  }

  const [existingProvider] = await db
    .select({ id: providers.id })
    .from(providers)
    .where(and(eq(providers.id, providerId), eq(providers.businessId, access.businessId)))
    .limit(1)

  if (!existingProvider) {
    return errorResponse(ApiMessageCode.PROVIDER_NOT_FOUND, 404)
  }

  const body = await request.json()
  const validation = createNoteSchema.safeParse(body)
  if (!validation.success) {
    return validationError(validation)
  }

  const now = new Date()
  // provider_notes.{created_at,updated_at} use Drizzle's `mode: 'timestamp'`
  // which serializes as Unix SECONDS (Math.floor(ms / 1000)). When we
  // bypass Drizzle's ORM-level insert and write via raw `sql`, we must
  // perform the same conversion ourselves or the column ends up holding
  // a millisecond value that reads back as ~50000-year-future dates.
  const nowSec = Math.floor(now.getTime() / 1000)
  const noteId = nanoid()
  const titleTrimmed = validation.data.title.trim()
  const bodyTrimmed = validation.data.body.trim()

  // Atomic 5-cap enforcement via CTE-style INSERT...SELECT...WHERE.
  // The previous flow ran a separate COUNT then INSERT — under N
  // concurrent POSTs each request observed count=4 and inserted, ending
  // with N+1 notes. Doing the count INSIDE the INSERT statement makes
  // the gate atomic with the row creation: SQLite evaluates the
  // sub-SELECT and the row materialization as a single statement under
  // the write lock, so concurrent inserts serialize correctly.
  // RETURNING gives us the row back without a follow-up SELECT; an
  // empty result means the cap was hit.
  const inserted = await db.all<{
    id: string
    provider_id: string
    business_id: string
    title: string
    body: string
    created_at: number
    updated_at: number
  }>(sql`
    INSERT INTO provider_notes (id, provider_id, business_id, title, body, created_at, updated_at)
    SELECT
      ${noteId},
      ${providerId},
      ${access.businessId},
      ${titleTrimmed},
      ${bodyTrimmed},
      ${nowSec},
      ${nowSec}
    WHERE (
      SELECT COUNT(*) FROM provider_notes
      WHERE provider_id = ${providerId}
        AND business_id = ${access.businessId}
    ) < ${MAX_PROVIDER_NOTES}
    RETURNING *
  `)

  if (inserted.length === 0) {
    return errorResponse(ApiMessageCode.PROVIDER_NOTES_LIMIT_REACHED, 400, {
      max: MAX_PROVIDER_NOTES,
    })
  }

  // Re-fetch the inserted row through Drizzle so the response uses the
  // same shape as GET (Date objects, camelCase keys) without manual
  // mapping of the raw row above.
  const newNote = await db
    .select()
    .from(providerNotes)
    .where(eq(providerNotes.id, noteId))
    .get()

  // Return the fresh list so the client can replace state in one shot — no
  // extra round-trip to re-sort.
  const notes = await db
    .select()
    .from(providerNotes)
    .where(and(
      eq(providerNotes.providerId, providerId),
      eq(providerNotes.businessId, access.businessId),
    ))
    .orderBy(desc(providerNotes.createdAt))

  await publishToBusiness(access.businessId, {
    type: 'provider.updated',
    providerId: providerId,
    fields: ['notes'],
  }, originDeviceId)

  return successResponse({ note: newNote, notes }, ApiMessageCode.PROVIDER_NOTE_CREATED)
})
