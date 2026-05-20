import { db, products, businesses } from '@/db'
import { eq, and, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { uploadProductIcon, validateIconSize } from '@/lib/storage'
import { sniffImageMimeType, type ImageMimeType } from '@/lib/file-sniff'
import { logServerError } from '@/lib/server-logger'
import { withBusinessAuth, validationError, errorResponse, successResponse, enforceMaxContentLength } from '@/lib/api-middleware'
import { canManageBusiness, assertCategoryInBusiness } from '@/lib/business-auth'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import {
  computeCanonicalGtin,
  detectBarcodeFormat,
  normalizeBarcodeValue,
  validateBarcodeSourcePrefix,
} from '@kasero/shared/barcodes'
import { Schemas } from '@/lib/schemas'
import { publishToBusiness, getOriginDeviceId } from '@/lib/realtime'

const createProductSchema = z.object({
  name: Schemas.name(),
  // FormData input — `formData.get('price')` is always a string.
  price: Schemas.amountFromString(),
  categoryId: Schemas.id().optional(),
  active: Schemas.activeFlag(),
  barcode: z.string().optional(),
  barcodeSource: z.enum(['scanned', 'generated', 'manual']).optional(),
  // Initial stock — surfaced from the Add wizard's CategoryStockStep.
  // FormData strings parse to nullable integers; cap at the same ceiling
  // the stock-adjust route uses so a typoed value can't exceed the
  // catalog's invariant.
  initialStock: z.preprocess(
    (v) => (typeof v === 'string' && v.length > 0 ? parseInt(v, 10) : undefined),
    z.number().int().min(0).max(999_999).optional(),
  ),
})

/**
 * GET /api/businesses/[businessId]/products
 *
 * List all products for the specified business. Accepts an optional
 * ?barcode=<value> query param for exact-match lookup.
 */
export const GET = withBusinessAuth(async (request, access) => {
  const url = new URL(request.url)
  // Normalize the lookup query the same way we normalize on write so case
  // and whitespace differences don't cause silent misses.
  const rawBarcodeParam = url.searchParams.get('barcode')
  const barcodeParam = rawBarcodeParam ? normalizeBarcodeValue(rawBarcodeParam) : null

  const conditions = [
    eq(products.businessId, access.businessId),
  ]

  if (barcodeParam) {
    conditions.push(eq(products.barcode, barcodeParam))
  }

  // Defensive cap — a small business never legitimately exposes 500+
  // products on one list call; pathological inserts (malicious or bugged)
  // can't drag the bandwidth / parse cost past this ceiling.
  const productsList = await db
    .select()
    .from(products)
    .where(and(...conditions))
    .limit(500)

  return successResponse({ products: productsList })
})

/**
 * POST /api/businesses/[businessId]/products
 *
 * Create a new product. Accepts FormData with optional icon file.
 */
// Product icon is capped at MAX_ICON_SIZE (100 KB); 5 MB Content-Length is
// generous headroom for the multipart envelope plus the other fields.
const POST_MAX_BODY_BYTES = 5 * 1024 * 1024

export const POST = withBusinessAuth(async (request, access) => {
  // Only partners and owners can create products. PATCH/DELETE on
  // products already required canManageBusiness; POST was the last
  // mutation employees could still perform.
  if (!canManageBusiness(access.role)) {
    return errorResponse(ApiMessageCode.PRODUCT_FORBIDDEN_NOT_MANAGER, 403)
  }

  const originDeviceId = getOriginDeviceId(request)

  const oversize = enforceMaxContentLength(request, POST_MAX_BODY_BYTES)
  if (oversize) return oversize

  const formData = await request.formData()
  const name = formData.get('name') as string
  const price = formData.get('price') as string
  const categoryId = formData.get('categoryId') as string | null
  const active = formData.get('active') as string
  const iconFile = formData.get('icon') as File | null
  const presetIcon = formData.get('presetIcon') as string | null
  const barcodeValue = normalizeBarcodeValue(formData.get('barcode') as string | null)
  // Source is an enum (lowercase). Trim only — don't run through the
  // barcode-value normalizer or it would uppercase and fail enum validation.
  const barcodeSourceValue = (formData.get('barcodeSource') as string | null)?.trim() || ''

  const validation = createProductSchema.safeParse({
    name,
    price,
    categoryId: categoryId || undefined,
    active,
    barcode: barcodeValue || undefined,
    // Format is derived server-side from the value, so we don't accept it from
    // the client. The field is omitted from validation entirely.
    barcodeSource: barcodeSourceValue || undefined,
    initialStock: formData.get('initialStock') ?? undefined,
  })

  if (!validation.success) {
    return validationError(validation)
  }

  const {
    name: validName,
    price: validPrice,
    categoryId: validCategoryId,
    active: validActive,
    barcodeSource: validBarcodeSource,
    initialStock: validInitialStock,
  } = validation.data

  // Cross-tenant guard: when a category is supplied it must belong to
  // THIS business. Without this a partner can attach a foreign business's
  // categoryId to their product; the row then dangles when the foreign
  // business deletes that category and the cascade nulls only its own
  // products.
  if (validCategoryId && !(await assertCategoryInBusiness(validCategoryId, access.businessId))) {
    return errorResponse(ApiMessageCode.CATEGORY_NOT_FOUND, 404)
  }

  // Derive format from value via the cascade. Format is never trusted from
  // the client. If the value is non-empty but the cascade can't classify it,
  // reject as a malformed barcode.
  const barcodeFormat = barcodeValue ? detectBarcodeFormat(barcodeValue) : null
  if (barcodeValue && !barcodeFormat) {
    return errorResponse(ApiMessageCode.BARCODE_UNRECOGNIZED, 400)
  }

  const barcodeSource = validBarcodeSource ?? null

  // The KSR- namespace and the source field must agree. See the helper for
  // the full matrix of allowed combinations.
  const sourcePrefixError = validateBarcodeSourcePrefix(barcodeValue, barcodeSource)
  if (sourcePrefixError) {
    return errorResponse(ApiMessageCode.BARCODE_SOURCE_INVALID, 400)
  }
  const barcodeGtin = computeCanonicalGtin(barcodeValue, barcodeFormat)

  if (!barcodeValue && barcodeSource) {
    return errorResponse(ApiMessageCode.BARCODE_SOURCE_REQUIRES_VALUE, 400)
  }

  if (barcodeValue) {
    const duplicateBarcode = await db
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          eq(products.businessId, access.businessId),
          eq(products.barcode, barcodeValue)
        )
      )
      .get()

    if (duplicateBarcode) {
      return errorResponse(ApiMessageCode.BARCODE_DUPLICATE, 400)
    }
  }

  const productId = nanoid()

  // Resolve icon: custom upload, preset emoji, or null.
  // Content-sniff the buffer before storing — File.type is client-
  // declared and spoofable. Without this, an SVG with
  // Content-Type: image/png would land in the DB (data URL) or on dev
  // disk (.svg with image/svg+xml served by Next), opening a stored-
  // XSS surface the moment any UI surface renders the icon outside
  // <img src=...>. SVG is rejected unconditionally — sniffImageMimeType
  // never returns it.
  const ICON_ALLOWED_TYPES: ReadonlyArray<ImageMimeType> = [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
  ]
  let iconData: string | null = null
  if (iconFile && iconFile.size > 0) {
    try {
      const buffer = Buffer.from(await iconFile.arrayBuffer())
      const sniffed = sniffImageMimeType(buffer)
      if (!sniffed || !ICON_ALLOWED_TYPES.includes(sniffed)) {
        return errorResponse(ApiMessageCode.PRODUCT_ICON_INVALID_TYPE, 400)
      }
      // Build the data URL with the sniffed MIME so size validation
      // matches what'll actually be stored in production.
      const base64DataUrl = `data:${sniffed};base64,${buffer.toString('base64')}`
      const { valid } = validateIconSize(base64DataUrl)
      if (!valid) {
        return errorResponse(ApiMessageCode.PRODUCT_ICON_TOO_LARGE, 400)
      }
      iconData = await uploadProductIcon(buffer, productId, sniffed)
    } catch (err) {
      logServerError('products.icon-upload', err)
      return errorResponse(ApiMessageCode.PRODUCT_ICON_UPLOAD_FAILED, 500)
    }
  } else if (presetIcon) {
    iconData = presetIcon
  }

  // Per-business sequential reference (productNumber). Pulled from a
  // monotonic counter on the businesses row via atomic UPDATE ... RETURNING,
  // so numbers are stable across deletes and safe under concurrent inserts.
  // Mirrors the pattern used for orders.orderNumber and sales.saleNumber.
  const reservation = await db
    .update(businesses)
    .set({ nextProductNumber: sql`${businesses.nextProductNumber} + 1` })
    .where(eq(businesses.id, access.businessId))
    .returning({ reserved: sql<number>`${businesses.nextProductNumber} - 1` })
  const productNumber = Number(reservation[0]?.reserved ?? 1)

  const [newProduct] = await db.insert(products).values({
    id: productId,
    businessId: access.businessId,
    productNumber,
    name: validName,
    price: validPrice,
    categoryId: validCategoryId || null,
    icon: iconData,
    barcode: barcodeValue || null,
    barcodeFormat,
    barcodeSource,
    barcodeGtin,
    active: validActive,
    stock: validInitialStock ?? 0,
  }).returning()

  // Fail-open realtime hint to every device in the business. The publisher
  // swallows Upstash errors internally; the response is unaffected.
  await publishToBusiness(
    access.businessId,
    { type: 'product.created', productId: newProduct.id },
    originDeviceId,
  )

  return successResponse({ product: newProduct })
}, { maxBodyBytes: POST_MAX_BODY_BYTES })
