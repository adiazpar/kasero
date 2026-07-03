export type PaymentMethod = 'cash' | 'card' | 'other'

export type SaleStatus = 'completed' | 'voided'

/**
 * Business tax mode.
 *   'none'      — no tax collected
 *   'inclusive' — prices already include tax; taxAmount is display-only
 *   'exclusive' — tax is added on top of the discounted subtotal
 */
export type TaxMode = 'none' | 'inclusive' | 'exclusive'

export interface SaleItem {
  productId: string | null
  productName: string
  quantity: number
  unitPrice: number
  subtotal: number  // computed: quantity * unitPrice
}

export interface Sale {
  id: string
  saleNumber: number
  sessionId: string         // FK to sales_sessions.id (NOT NULL on the wire)
  date: string              // ISO timestamp
  total: number
  paymentMethod: PaymentMethod
  notes: string | null
  status: SaleStatus
  voidedAt: string | null   // ISO timestamp, set when status === 'voided'
  voidedBy: string | null   // user id of the manager who voided
  discountAmount: number    // cart-level discount snapshot (absolute amount)
  taxRate: number           // percent snapshot at commit time
  taxAmount: number         // absolute amount snapshot at commit time
  taxMode: TaxMode          // mode snapshot at commit time
  items: SaleItem[]
  createdByUserId: string
  createdAt: string         // ISO timestamp
}

export interface SalesStats {
  todayRevenue: number
  todayCount: number
  todayAvgTicket: number | null
  yesterdayRevenue: number
  vsYesterdayPct: number | null
}

/**
 * Cash-drawer session. Either open (closedAt === null and all close-time
 * fields are null) or closed (closedAt set + denormalized totals stamped).
 */
export interface SalesSession {
  id: string
  openedAt: string                   // ISO timestamp
  openedByUserId: string
  startingCash: number
  closedAt: string | null
  closedByUserId: string | null
  countedCash: number | null
  salesCount: number | null
  salesTotal: number | null
  cashSalesTotal: number | null
  expectedCash: number | null
  variance: number | null
  notes: string | null
}
