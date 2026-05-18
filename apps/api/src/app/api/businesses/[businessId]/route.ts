import { isOwner, invalidateAccessCacheForBusiness } from '@/lib/business-auth'
import { withBusinessAuth, errorResponse, successResponse, validationError, enforceMaxContentLength } from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import {
  db,
  businesses,
  businessUsers,
  products,
  productCategories,
  providers,
  providerNotes,
  orders,
  orderItems,
  sales,
  saleItems,
  salesSessions,
  inviteCodes,
  ownershipTransfers,
} from '@/db'
import { eq, inArray } from 'drizzle-orm'
import { getLocaleConfig } from '@kasero/shared/locale-config'
import { patchSchema } from './schema'
import { MAX_UPLOAD_SIZE } from '@/lib/storage'
import { sniffImageMimeType } from '@/lib/file-sniff'
import { logServerError } from '@/lib/server-logger'

/**
 * GET /api/businesses/[businessId]
 * Returns the full business record for the current user's business.
 * Any member (owner/partner/employee) can read.
 */
export const GET = withBusinessAuth(async (_request, access) => {
  const [row] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, access.businessId))
    .limit(1)

  if (!row) {
    return errorResponse(ApiMessageCode.BUSINESS_NOT_FOUND, 404)
  }

  return successResponse({
    business: {
      id: row.id,
      name: row.name,
      icon: row.icon,
      locale: row.locale,
      currency: row.currency,
    },
  })
})

/**
 * PATCH /api/businesses/[businessId]
 * Update business details. Owner or partner only.
 * Accepts FormData with any subset of: name, locale, logo (File), removeLogo=true.
 * Currency is derived server-side from locale.
 */
// Business logo is capped at MAX_UPLOAD_SIZE (2 MB decoded); 5 MB Content-Length
// allows for multipart boundary, the logo, and the handful of metadata fields.
const PATCH_MAX_BODY_BYTES = 5 * 1024 * 1024

export const PATCH = withBusinessAuth(async (request, access) => {
  // Identity edits (name, icon, locale, currency) are owner-only.
  // Functional settings (defaultCategoryId, sortPreference) live on a
  // separate route and remain manager-level.
  if (!isOwner(access.role)) {
    return errorResponse(ApiMessageCode.BUSINESS_UPDATE_FORBIDDEN, 403)
  }

  const oversize = enforceMaxContentLength(request, PATCH_MAX_BODY_BYTES)
  if (oversize) return oversize

  const formData = await request.formData()

  // Extract logo File separately (Zod can't validate File)
  const logoEntry = formData.get('logo')
  const logoFile = logoEntry instanceof File && logoEntry.size > 0 ? logoEntry : null

  // Build plain object for Zod validation
  const plain: Record<string, string> = {}
  for (const [k, v] of formData.entries()) {
    if (k === 'logo') continue
    if (typeof v === 'string') plain[k] = v
  }

  const validation = patchSchema.safeParse(plain)
  if (!validation.success) {
    return validationError(validation)
  }

  const { name, locale, removeLogo } = validation.data

  // Validate locale — getLocaleConfig returns undefined for unknown locales
  let currency: string | undefined
  if (locale !== undefined) {
    const localeConfig = getLocaleConfig(locale)
    if (!localeConfig) {
      return errorResponse(ApiMessageCode.BUSINESS_UPDATE_INVALID_LOCALE, 400)
    }
    currency = localeConfig.currency
  }

  // Validate logo file. Allowlist raster formats only — SVG is
  // intentionally rejected because the logo is stored as a base64 data
  // URL and rendered via <img src=...>; permitting SVG would open a
  // stored-XSS surface through embedded <script> tags. HEIC/HEIF are
  // converted to JPEG client-side before upload, so they shouldn't
  // arrive here either.
  const ACCEPTED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
  let logoBuffer: Buffer | null = null
  // TS union matches the runtime allowlist (audit L-16). The previous
  // declaration included 'image/gif' but the allowlist rejected it,
  // misleading future contributors who might extend the union and
  // accidentally enable GIF storage.
  let sniffedLogoType: typeof ACCEPTED_LOGO_TYPES[number] | null = null
  if (logoFile) {
    if (!(ACCEPTED_LOGO_TYPES as ReadonlyArray<string>).includes(logoFile.type)) {
      return errorResponse(ApiMessageCode.BUSINESS_UPDATE_LOGO_INVALID_TYPE, 400)
    }
    if (logoFile.size > MAX_UPLOAD_SIZE) {
      return errorResponse(ApiMessageCode.BUSINESS_UPDATE_LOGO_TOO_LARGE, 400)
    }
    // Content-sniff the decoded bytes. File.type is client-declared
    // and spoofable; without this, an attacker could send an SVG (or
    // anything else) with Content-Type: image/png and have it stored
    // under a <img> surface. Store the data URL using the SNIFFED
    // type so the prefix can never disagree with the payload.
    logoBuffer = Buffer.from(await logoFile.arrayBuffer())
    const sniffed = sniffImageMimeType(logoBuffer)
    if (
      !sniffed ||
      !(ACCEPTED_LOGO_TYPES as ReadonlyArray<string>).includes(sniffed)
    ) {
      return errorResponse(ApiMessageCode.BUSINESS_UPDATE_LOGO_INVALID_TYPE, 400)
    }
    // Narrow to the runtime allowlist so the assignment satisfies
    // the tightened union (audit L-16).
    sniffedLogoType = sniffed as typeof ACCEPTED_LOGO_TYPES[number]
  }

  // Build update object
  const update: Partial<typeof businesses.$inferInsert> = {}
  if (name !== undefined) update.name = name
  if (locale !== undefined) { update.locale = locale; update.currency = currency }
  if (removeLogo === 'true') update.icon = null
  if (logoFile && logoBuffer && sniffedLogoType) {
    update.icon = `data:${sniffedLogoType};base64,${logoBuffer.toString('base64')}`
  }

  if (Object.keys(update).length === 0) {
    // Nothing to update — treat as success (idempotent)
    const [row] = await db.select().from(businesses).where(eq(businesses.id, access.businessId)).limit(1)
    if (!row) return errorResponse(ApiMessageCode.BUSINESS_NOT_FOUND, 404)
    return successResponse({
      business: {
        id: row.id, name: row.name, icon: row.icon,
        locale: row.locale, currency: row.currency,
      },
    }, ApiMessageCode.BUSINESS_UPDATE_SUCCESS)
  }

  try {
    const [row] = await db
      .update(businesses)
      .set(update)
      .where(eq(businesses.id, access.businessId))
      .returning()
    if (!row) return errorResponse(ApiMessageCode.BUSINESS_NOT_FOUND, 404)
    invalidateAccessCacheForBusiness(access.businessId)
    return successResponse({
      business: {
        id: row.id, name: row.name, icon: row.icon,
        locale: row.locale, currency: row.currency,
      },
    }, ApiMessageCode.BUSINESS_UPDATE_SUCCESS)
  } catch (err) {
    logServerError('business.update', err)
    return errorResponse(ApiMessageCode.BUSINESS_UPDATE_FAILED, 500)
  }
}, { maxBodyBytes: PATCH_MAX_BODY_BYTES })

/**
 * DELETE /api/businesses/[businessId]
 *
 * Delete a business and every child row that references it. Only the
 * owner can delete.
 *
 * IMPORTANT — child cleanup is explicit, not FK-cascade. The schema
 * declares onDelete:'cascade' on `business_users` and `provider_notes`
 * only. Every other child table (`products`, `product_categories`,
 * `providers`, `orders`, `order_items`, `sales`, `sale_items`,
 * `sales_sessions`, `invite_codes`, `ownership_transfers`) declares its
 * `business_id` FK without onDelete. libsql/Turso also runs with FK
 * enforcement OFF by default — `src/db/index.ts` never issues
 * `PRAGMA foreign_keys = ON`. Without explicit deletes, the prior
 * implementation silently left orphan rows for every business that was
 * ever deleted (GDPR-relevant data retention bug).
 *
 * Order matters because of FK dependencies:
 *   - sale_items must go before sales (FK saleId)
 *   - order_items must go before orders (FK orderId)
 *   - sales must go before sales_sessions (FK sessionId, restrict)
 *   - products must go before product_categories (FK categoryId, set null)
 *   - business_users last (cascades from users in some flows; the
 *     access cache is invalidated AFTER the transaction commits)
 *
 * The whole operation runs in `db.transaction` so a mid-flight failure
 * either commits all rows gone, or rolls back to the pre-delete state.
 * No half-deleted business is possible.
 */
export const DELETE = withBusinessAuth(async (_request, access) => {
  if (!isOwner(access.role)) {
    return errorResponse(ApiMessageCode.BUSINESS_ONLY_OWNER_CAN_DELETE, 403)
  }

  try {
    const existing = await db
      .select({ id: businesses.id })
      .from(businesses)
      .where(eq(businesses.id, access.businessId))
      .get()

    if (!existing) {
      return errorResponse(ApiMessageCode.BUSINESS_NOT_FOUND, 404)
    }

    await db.transaction(async (tx) => {
      // 1. sale_items — fetch parent sale ids first (no businessId on
      //    sale_items, so we go via the join).
      const saleIds = await tx
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.businessId, access.businessId))
      if (saleIds.length > 0) {
        await tx
          .delete(saleItems)
          .where(inArray(saleItems.saleId, saleIds.map((s) => s.id)))
      }

      // 2. sales (must be after sale_items; sales_sessions FK is
      //    declared restrict so sales must go before sales_sessions).
      await tx.delete(sales).where(eq(sales.businessId, access.businessId))

      // 3. sales_sessions
      await tx
        .delete(salesSessions)
        .where(eq(salesSessions.businessId, access.businessId))

      // 4. order_items — same pattern as sale_items.
      const orderIds = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.businessId, access.businessId))
      if (orderIds.length > 0) {
        await tx
          .delete(orderItems)
          .where(inArray(orderItems.orderId, orderIds.map((o) => o.id)))
      }

      // 5. orders
      await tx.delete(orders).where(eq(orders.businessId, access.businessId))

      // 6. provider_notes (denormalized businessId; cleanest direct delete).
      await tx
        .delete(providerNotes)
        .where(eq(providerNotes.businessId, access.businessId))

      // 7. providers
      await tx
        .delete(providers)
        .where(eq(providers.businessId, access.businessId))

      // 8. products before product_categories (categoryId FK)
      await tx
        .delete(products)
        .where(eq(products.businessId, access.businessId))

      // 9. product_categories
      await tx
        .delete(productCategories)
        .where(eq(productCategories.businessId, access.businessId))

      // 10. invite_codes
      await tx
        .delete(inviteCodes)
        .where(eq(inviteCodes.businessId, access.businessId))

      // 11. ownership_transfers (in-flight transfers for this business
      //     are abandoned — they cannot be honored once the business
      //     is gone).
      await tx
        .delete(ownershipTransfers)
        .where(eq(ownershipTransfers.businessId, access.businessId))

      // 12. business_users — would cascade via FK if enforcement were
      //     on, but we delete explicitly to be FK-off-safe.
      await tx
        .delete(businessUsers)
        .where(eq(businessUsers.businessId, access.businessId))

      // 13. businesses (the row itself)
      await tx.delete(businesses).where(eq(businesses.id, access.businessId))
    })

    // Business is gone — every cached BusinessAccess that references it
    // is now invalid (every member, not just the deleting owner).
    invalidateAccessCacheForBusiness(access.businessId)

    return successResponse({}, ApiMessageCode.BUSINESS_DELETE_SUCCESS)
  } catch (error) {
    logServerError('business.delete', error)
    return errorResponse(ApiMessageCode.BUSINESS_DELETE_FAILED, 500)
  }
})
