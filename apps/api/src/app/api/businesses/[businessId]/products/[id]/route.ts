import { NextResponse } from 'next/server'
import { db, products, orderItems, orders } from '@/db'
import { eq, and, ne } from 'drizzle-orm'
import { uploadProductIcon, deleteProductIcon, validateIconSize } from '@/lib/storage'
import { sniffImageMimeType, type ImageMimeType } from '@/lib/file-sniff'
import { logServerError } from '@/lib/server-logger'
import { withBusinessAuth, errorResponse, successResponse, validationError, enforceMaxContentLength } from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { canManageBusiness, assertCategoryInBusiness } from '@/lib/business-auth'
import {
  computeCanonicalGtin,
  detectBarcodeFormat,
  normalizeBarcodeValue,
  validateBarcodeSourcePrefix,
} from '@kasero/shared/barcodes'
import { Schemas } from '@/lib/schemas'
import { publishToBusiness, getOriginDeviceId } from '@/lib/realtime'
import type { BusinessRealtimeEvent } from '@kasero/shared/realtime'

// Narrow alias for the `fields` literal type on product.updated so the
// caller can build the array with full type-checking instead of casting.
type ProductUpdatedField = Extract<
  BusinessRealtimeEvent,
  { type: 'product.updated' }
>['fields'][number]

/**
 * PATCH /api/businesses/[businessId]/products/[id]
 *
 * Update a product. Accepts FormData with optional icon file.
 */
// Mirrors the POST cap — icons are small but the multipart envelope is generous.
const PATCH_MAX_BODY_BYTES = 5 * 1024 * 1024

export const PATCH = withBusinessAuth(async (request, access, routeParams) => {
  // Only partners and owners can modify products
  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.PRODUCT_FORBIDDEN_NOT_MANAGER, 403)
  }

  const id = routeParams?.id
  if (!id) {
    return errorResponse(ApiMessageCode.PRODUCT_ID_REQUIRED, 400)
  }

  const originDeviceId = getOriginDeviceId(request)

  const oversize = enforceMaxContentLength(request, PATCH_MAX_BODY_BYTES)
  if (oversize) return oversize

  const formData = await request.formData()
  const name = formData.get('name') as string | null
  const price = formData.get('price') as string | null
  const categoryId = formData.get('categoryId') as string | null
  const active = formData.get('active') as string | null
  const iconFile = formData.get('icon') as File | null
  const presetIcon = formData.get('presetIcon') as string | null
  const clearIconFlag = formData.get('clearIcon') as string | null
  const barcodeValue = normalizeBarcodeValue(formData.get('barcode') as string | null)
  // Source is an enum (lowercase). Trim only — don't run through the
  // barcode-value normalizer or it would uppercase and fail enum validation.
  const barcodeSourceValue = (formData.get('barcodeSource') as string | null)?.trim() || ''

  const updateData: Record<string, unknown> = {}

  if (name !== null) {
    const nameValidation = Schemas.name().safeParse(name)
    if (!nameValidation.success) {
      return validationError(nameValidation)
    }
    updateData.name = nameValidation.data
  }

  if (price !== null) {
    // `formData.get('price')` is always a string — use the
    // string-input variant of the amount schema.
    const priceValidation = Schemas.amountFromString().safeParse(price)
    if (!priceValidation.success) {
      return validationError(priceValidation)
    }
    updateData.price = priceValidation.data
  }

  if (categoryId !== null) {
    if (categoryId === '') {
      updateData.categoryId = null
    } else {
      // Cross-tenant guard: same justification as the POST route. A
      // partner could otherwise plant a foreign categoryId.
      if (!(await assertCategoryInBusiness(categoryId, access.businessId))) {
        return errorResponse(ApiMessageCode.CATEGORY_NOT_FOUND, 404)
      }
      updateData.categoryId = categoryId
    }
  }

  if (active !== null) {
    updateData.active = active === 'true'
  }

  const hasBarcodeValue = formData.has('barcode')
  const hasBarcodeSource = formData.has('barcodeSource')

  // Format is no longer accepted from the client — it's derived from the
  // value via the cascade. Any `barcodeFormat` field in the request is
  // silently ignored.

  if (hasBarcodeSource) {
    if (barcodeSourceValue && !['scanned', 'generated', 'manual'].includes(barcodeSourceValue)) {
      return errorResponse(ApiMessageCode.BARCODE_UNSUPPORTED_SOURCE, 400)
    }
    updateData.barcodeSource = barcodeSourceValue || null
  }

  if (hasBarcodeValue) {
    // Derive format from the new value via the cascade. If the value is
    // non-empty but the cascade can't classify it, reject as malformed.
    const derivedFormat = barcodeValue ? detectBarcodeFormat(barcodeValue) : null
    if (barcodeValue && !derivedFormat) {
      return errorResponse(ApiMessageCode.BARCODE_UNRECOGNIZED, 400)
    }

    // The KSR- namespace and the source field must agree. We only run the
    // check when this request explicitly includes a barcodeSource — if the
    // source isn't being updated, we don't read the existing row from the
    // DB just to validate against it (defense in depth at this layer isn't
    // worth the extra query).
    if (hasBarcodeSource) {
      const source = (barcodeSourceValue || null) as
        | 'scanned'
        | 'generated'
        | 'manual'
        | null
      const sourcePrefixError = validateBarcodeSourcePrefix(barcodeValue, source)
      if (sourcePrefixError) {
        return errorResponse(ApiMessageCode.BARCODE_SOURCE_INVALID, 400)
      }
    }

    if (barcodeValue) {
      const duplicateBarcode = await db
        .select({ id: products.id })
        .from(products)
        .where(
          and(
            eq(products.businessId, access.businessId),
            eq(products.barcode, barcodeValue),
            ne(products.id, id)
          )
        )
        .get()

      if (duplicateBarcode) {
        return errorResponse(ApiMessageCode.BARCODE_DUPLICATE, 400)
      }
    }

    updateData.barcode = barcodeValue || null
    updateData.barcodeFormat = derivedFormat
    updateData.barcodeGtin = computeCanonicalGtin(barcodeValue || null, derivedFormat)

    // Clearing the barcode also clears source unless source was explicitly
    // included in the same request.
    if (!barcodeValue && !hasBarcodeSource) {
      updateData.barcodeSource = null
    }
  }

  if (hasBarcodeValue && !barcodeValue && barcodeSourceValue) {
    return errorResponse(ApiMessageCode.BARCODE_SOURCE_REQUIRES_VALUE, 400)
  }

  // Handle icon changes. Same content-sniff guard as the POST route —
  // File.type is client-declared; trusting it would let an SVG land
  // under a <img> surface and become stored-XSS the moment any future
  // render path uses unsafe-HTML / iframe.
  const ICON_ALLOWED_TYPES: ReadonlyArray<ImageMimeType> = [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
  ]
  if (iconFile && iconFile.size > 0) {
    // Custom icon upload (AI-generated or user-uploaded)
    try {
      const buffer = Buffer.from(await iconFile.arrayBuffer())
      const sniffed = sniffImageMimeType(buffer)
      if (!sniffed || !ICON_ALLOWED_TYPES.includes(sniffed)) {
        return errorResponse(ApiMessageCode.PRODUCT_ICON_INVALID_TYPE, 400)
      }
      const base64DataUrl = `data:${sniffed};base64,${buffer.toString('base64')}`
      const { valid } = validateIconSize(base64DataUrl)
      if (!valid) {
        return errorResponse(ApiMessageCode.PRODUCT_ICON_TOO_LARGE, 400)
      }
      // uploadProductIcon deletes any existing file at this id before writing.
      updateData.icon = await uploadProductIcon(buffer, id, sniffed)
    } catch (err) {
      logServerError('products.icon-upload', err)
      return errorResponse(ApiMessageCode.PRODUCT_ICON_UPLOAD_FAILED, 500)
    }
  } else if (presetIcon) {
    // Preset emoji icon - store the emoji string directly
    await deleteProductIcon(null, id)
    updateData.icon = presetIcon
  } else if (clearIconFlag === 'true') {
    // Icon was cleared
    await deleteProductIcon(null, id)
    updateData.icon = null
  }

  if (Object.keys(updateData).length === 0) {
    return errorResponse(ApiMessageCode.PRODUCT_NO_DATA_TO_UPDATE, 400)
  }

  // One round trip: the ownership check lives in the WHERE clause and
  // .returning() hands back the updated row directly. If the row didn't
  // match (wrong id or wrong businessId) the returning array is empty,
  // which collapses to a 404.
  const [updatedProduct] = await db
    .update(products)
    .set({ ...updateData, updatedAt: new Date() })
    .where(and(eq(products.id, id), eq(products.businessId, access.businessId)))
    .returning()

  if (!updatedProduct) {
    return errorResponse(ApiMessageCode.PRODUCT_NOT_FOUND, 404)
  }

  // Compute the set of fields that actually changed on the wire. Maps the
  // route's internal updateData keys to the realtime event's `fields`
  // literal so the discriminated-union type catches drift if the column
  // surface area changes.
  const changedFields: ProductUpdatedField[] = []
  if ('name' in updateData) changedFields.push('name')
  if ('price' in updateData) changedFields.push('price')
  if ('categoryId' in updateData) changedFields.push('categoryId')
  if ('active' in updateData) changedFields.push('active')
  if ('icon' in updateData) changedFields.push('icon')
  if ('barcode' in updateData) changedFields.push('barcode')

  // Fail-open. Even when nothing changed (the route returned NO_DATA_TO_UPDATE
  // above and we never reach here) the publish is guarded against an empty
  // fields array — handlers don't care, but smaller payloads are nicer.
  if (changedFields.length > 0) {
    await publishToBusiness(
      access.businessId,
      { type: 'product.updated', productId: id, fields: changedFields },
      originDeviceId,
    )
  }

  return successResponse({ product: updatedProduct })
}, { maxBodyBytes: PATCH_MAX_BODY_BYTES })

/**
 * DELETE /api/businesses/[businessId]/products/[id]
 *
 * Hard-delete a product. Blocked if the product is referenced in any
 * pending order — the user must receive or cancel that order first.
 * Received orders don't block deletion: stock was already adjusted, and
 * order_items.productName snapshots preserve historical display after
 * the FK is set to NULL via cascade.
 */
export const DELETE = withBusinessAuth(async (request, access, routeParams) => {
  // Only partners and owners can delete products
  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.PRODUCT_FORBIDDEN_NOT_MANAGER, 403)
  }

  const id = routeParams?.id
  if (!id) {
    return errorResponse(ApiMessageCode.PRODUCT_ID_REQUIRED, 400)
  }

  const originDeviceId = getOriginDeviceId(request)

  // Verify product exists and belongs to business
  const [existingProduct] = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.id, id),
        eq(products.businessId, access.businessId)
      )
    )
    .limit(1)

  if (!existingProduct) {
    return errorResponse(ApiMessageCode.PRODUCT_NOT_FOUND, 404)
  }

  // Block delete if the product is referenced in any pending order
  const [blockingOrder] = await db
    .select({ id: orders.id })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(
      and(
        eq(orderItems.productId, id),
        eq(orders.status, 'pending'),
        eq(orders.businessId, access.businessId)
      )
    )
    .limit(1)

  if (blockingOrder) {
    // 409 with the envelope plus the blocking order id so the client can
    // navigate to it.
    return NextResponse.json(
      {
        messageCode: ApiMessageCode.PRODUCT_PENDING_ORDER_BLOCK,
        blockingOrderId: blockingOrder.id,
      },
      { status: 409 }
    )
  }

  // Delete the icon file (if any) before removing the row
  await deleteProductIcon(existingProduct.icon, id)

  // Hard delete. order_items.productId has ON DELETE SET NULL and
  // preserves its productName snapshot for historical display.
  await db.delete(products).where(eq(products.id, id))

  await publishToBusiness(
    access.businessId,
    { type: 'product.deleted', productId: id },
    originDeviceId,
  )

  return successResponse({})
})
