import { db, sales, saleItems } from '@/db'
import { eq, and } from 'drizzle-orm'
import { withBusinessAuth, errorResponse, successResponse } from '@/lib/api-middleware'
import { ApiMessageCode } from '@kasero/shared/api-messages'
import { roundToCurrencyDecimals } from '@kasero/shared/sales-helpers'

export const GET = withBusinessAuth(async (_request, access, params) => {
  const id = params.id
  if (!id) return errorResponse(ApiMessageCode.SALE_NOT_FOUND, 404)

  // Items are keyed by the URL id, so both selects can run concurrently —
  // one libSQL round trip of latency instead of two. If the sale doesn't
  // exist (or belongs to another business), items is just empty and we 404.
  const [sale, items] = await Promise.all([
    db
      .select()
      .from(sales)
      .where(and(eq(sales.id, id), eq(sales.businessId, access.businessId)))
      .get(),
    db.select().from(saleItems).where(eq(saleItems.saleId, id)),
  ])

  if (!sale) return errorResponse(ApiMessageCode.SALE_NOT_FOUND, 404)

  const currency = access.businessCurrency ?? 'USD'

  return successResponse({
    sale: {
      id: sale.id,
      saleNumber: sale.saleNumber,
      sessionId: sale.sessionId,
      date: sale.date.toISOString(),
      total: sale.total,
      paymentMethod: sale.paymentMethod,
      notes: sale.notes,
      status: sale.status,
      voidedAt: sale.voidedAt ? sale.voidedAt.toISOString() : null,
      voidedBy: sale.voidedBy,
      discountAmount: sale.discountAmount,
      taxRate: sale.taxRate,
      taxAmount: sale.taxAmount,
      taxMode: sale.taxMode,
      items: items.map((it) => ({
        productId: it.productId,
        productName: it.productName,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        subtotal: roundToCurrencyDecimals(it.quantity * it.unitPrice, currency),
      })),
      createdByUserId: sale.createdByUserId,
      createdAt: sale.createdAt.toISOString(),
    },
  })
})
