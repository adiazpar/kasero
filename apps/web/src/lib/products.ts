/**
 * Product-related constants and types for the products page.
 */

import type { ProductCategory, Product, Order, OrderItem, Provider } from '@kasero/shared/types'

// ============================================
// FILTER CONFIGURATION
// ============================================

/** Filter category type - now uses category IDs or special filters */
export type FilterCategory = 'all' | 'low_stock' | string

/**
 * Get filter config for a category
 * Now dynamically builds filter options based on actual categories
 */
export function getFilterLabel(filter: FilterCategory, categories: ProductCategory[]): string {
  if (filter === 'all') return 'All'
  if (filter === 'low_stock') return 'Low Stock'
  const category = categories.find(c => c.id === filter)
  return category?.name || 'Unknown'
}

// ============================================
// SORT OPTIONS
// ============================================

export type SortOption = 'name_asc' | 'name_desc' | 'price_asc' | 'price_desc' | 'category' | 'stock_asc' | 'stock_desc'

export const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'name_asc', label: 'Name (A-Z)' },
  { value: 'name_desc', label: 'Name (Z-A)' },
  { value: 'price_asc', label: 'Price (low to high)' },
  { value: 'price_desc', label: 'Price (high to low)' },
  { value: 'stock_asc', label: 'Stock (low to high)' },
  { value: 'stock_desc', label: 'Stock (high to low)' },
  { value: 'category', label: 'Category' },
]

/**
 * Sort a product list by the given SortOption. Returns a new array (does not
 * mutate). `categories` is only needed for `'category'` sort; for other
 * sorts it can be omitted.
 *
 * Shared between the Products tab (useProductFilters) and the new-order
 * modal's product picker (useOrderFlows) so a single source of truth
 * defines how products are ordered wherever the user sees them.
 */
export function sortProducts(
  products: Product[],
  sortBy: SortOption,
  categories?: ProductCategory[],
): Product[] {
  const categoryOrderMap = categories
    ? new Map(categories.map((c, i) => [c.id, c.sortOrder ?? i]))
    : new Map<string, number>()
  return [...products].sort((a, b) => {
    switch (sortBy) {
      case 'name_asc':
        return a.name.localeCompare(b.name)
      case 'name_desc':
        return b.name.localeCompare(a.name)
      case 'price_asc':
        return a.price - b.price
      case 'price_desc':
        return b.price - a.price
      case 'stock_asc': {
        const stockA = a.stock ?? 0
        const stockB = b.stock ?? 0
        if (stockA !== stockB) return stockA - stockB
        return a.name.localeCompare(b.name)
      }
      case 'stock_desc': {
        const stockA = a.stock ?? 0
        const stockB = b.stock ?? 0
        if (stockA !== stockB) return stockB - stockA
        return a.name.localeCompare(b.name)
      }
      case 'category': {
        const catA = a.categoryId ? (categoryOrderMap.get(a.categoryId) ?? 99) : 99
        const catB = b.categoryId ? (categoryOrderMap.get(b.categoryId) ?? 99) : 99
        if (catA !== catB) return catA - catB
        return a.name.localeCompare(b.name)
      }
      default:
        return a.name.localeCompare(b.name)
    }
  })
}

// ============================================
// TAB TYPES
// ============================================

export type PageTab = 'products' | 'inventory'

// ============================================
// EXPANDED ORDER TYPE
// ============================================

/** Order with expanded relations for display */
export interface ExpandedOrder extends Order {
  expand?: {
    'order_items(order)'?: (OrderItem & {
      expand?: {
        product?: Product
      }
    })[]
    provider?: Provider
    /** The user who created the order. Slim shape (no sensitive fields). */
    createdByUser?: { id: string; name: string; email: string }
    /** The user who received the order. Only present once the order is received. */
    receivedByUser?: { id: string; name: string; email: string }
  }
}

// ============================================
// ORDER ITEM FOR FORM
// ============================================

export interface OrderFormItem {
  product: Product
  quantity: number
}

// ============================================
// ORDER VIEW MODE
// ============================================

/**
 * Top-level split for the orders UI. "active" shows pending + overdue;
 * "completed" shows received. Held in component state, never persisted.
 */
export type OrderViewMode = 'active' | 'completed'

// ============================================
// ORDER STATUS FILTER
// ============================================

export type OrderStatusFilter = 'all' | 'pending' | 'received' | 'overdue'

/**
 * Determine the display status of an order.
 * An order is "overdue" when it is still pending and its estimated arrival
 * date has passed.
 */
export function getOrderDisplayStatus(order: { status: string; estimatedArrival?: Date | string | null }): 'pending' | 'received' | 'overdue' {
  if (order.status === 'received') return 'received'
  if (order.estimatedArrival) {
    const arrival = new Date(order.estimatedArrival)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (arrival < today) return 'overdue'
  }
  return 'pending'
}

// ============================================
// ORDER SORT OPTIONS
// ============================================

export type OrderSortOption = 'date_desc' | 'date_asc' | 'total_desc' | 'total_asc'

export const ORDER_SORT_OPTIONS: { value: OrderSortOption }[] = [
  { value: 'date_desc' },
  { value: 'date_asc' },
  { value: 'total_desc' },
  { value: 'total_asc' },
]
