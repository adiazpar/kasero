// ============================================
// USER TYPES
// ============================================

export type UserRole = 'owner' | 'partner' | 'employee'

export interface User {
  id: string
  email: string
  name: string
  avatar?: string | null
  language: string
  emailVerified: boolean
  phoneNumber?: string | null
  phoneNumberVerified: boolean
}

// ============================================
// INVITE CODE TYPES
// ============================================

export type InviteRole = 'partner' | 'employee'

export interface InviteCode {
  id: string
  code: string // 6 uppercase alphanumeric chars
  role: InviteRole
  createdBy: string
  usedBy?: string
  expiresAt: Date | string
  expand?: {
    createdBy?: User
    usedBy?: User
  }
}

// ============================================
// PRODUCT CATEGORY TYPES
// ============================================

/** Custom product category */
export interface ProductCategory {
  id: string
  businessId: string
  name: string
  sortOrder: number
}

// ============================================
// PRODUCT SETTINGS TYPES
// ============================================

export type SortPreference = 'name_asc' | 'name_desc' | 'price_asc' | 'price_desc' | 'category' | 'stock_asc' | 'stock_desc'

export interface ProductSettings {
  defaultCategoryId?: string | null
  sortPreference: SortPreference
}

// ============================================
// PRODUCT TYPES
// ============================================

export type BarcodeFormat =
  | 'CODABAR'
  | 'CODE_39'
  | 'CODE_93'
  | 'CODE_128'
  | 'ITF'
  | 'EAN_13'
  | 'EAN_8'
  | 'UPC_A'
  | 'UPC_E'
  | 'UPC_EAN_EXTENSION'

export type BarcodeSource = 'scanned' | 'generated' | 'manual'

export interface Product {
  id: string
  businessId: string
  /** Per-business sequential counter set on insert. Nullable for rows
   *  that predated the column; the API backfills missing values to 0
   *  but consumers should treat null as "no number assigned". */
  productNumber?: number | null
  name: string
  price: number
  costPrice?: number | null
  active: boolean
  categoryId?: string | null
  icon?: string | null
  barcode?: string | null
  barcodeFormat?: BarcodeFormat | null
  barcodeSource?: BarcodeSource | null
  stock?: number | null
  lowStockThreshold?: number | null
  /** Derived at read time by the products list route (LEFT JOIN +
   *  COUNT against sale_items). True when ≥1 sale_items row references
   *  this product. Used by the Products list to distinguish a brand-new
   *  product at zero stock (READY · SET STOCK, calm) from a depleted SKU
   *  that has sold before (OUT OF STOCK, saffron). Optional because other
   *  routes that return a Product (single GET, PATCH response, POST
   *  response) don't compute it. */
  hasSold?: boolean
  /** Audit timestamps. Set on insert; updatedAt bumped on every PATCH
   *  that mutates a product row (PATCH /products/:id, /stock). */
  createdAt?: Date | string | null
  updatedAt?: Date | string | null
}

// ============================================
// PROVIDER TYPES
// ============================================

export interface ProviderNote {
  id: string
  providerId: string
  businessId: string
  title: string
  body: string
  createdAt: Date | string
  updatedAt: Date | string
}

export interface Provider {
  id: string
  businessId: string
  name: string
  phone?: string | null
  email?: string | null
  active: boolean
  createdAt?: Date | string | null
  /**
   * Notes embedded on the provider-detail response. Newest-first by
   * createdAt. Omitted from list responses.
   */
  notes?: ProviderNote[]
}

// ============================================
// ORDER TYPES (purchases from suppliers)
// ============================================

type OrderStatus = 'pending' | 'received'

export interface Order {
  id: string
  businessId: string
  providerId?: string | null
  // User who created the order. Nullable for legacy rows.
  createdByUserId?: string | null
  // User who received the order. Null until the order is received.
  receivedByUserId?: string | null
  // Human-readable, per-business sequential reference ("#47"). Nullable
  // to tolerate rows that pre-date the backfill.
  orderNumber?: number | null
  date: Date | string
  receivedDate?: Date | string | null
  total: number
  status: OrderStatus
  estimatedArrival?: Date | string | null
}

export interface OrderItem {
  id: string
  orderId: string
  productId?: string | null
  productName: string
  quantity: number
  unitCost?: number | null
  subtotal?: number | null
  receivedQuantity?: number | null
}

export * from './expense'
export * from './inventory'


