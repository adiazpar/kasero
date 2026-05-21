// Productos components barrel export.
//
// AddProductModal, EditProductModal, ProductSettingsModal, and
// ProductInfoDrawer are intentionally NOT re-exported here. They're
// lazy-loaded via `dynamic(import(...))` from ProductsView.tsx, and
// having them in this barrel would defeat the code-splitting (Vite's
// `INEFFECTIVE_DYNAMIC_IMPORT` warning). Import them directly from
// their source files when needed.

export { ProductsTab } from './ProductsTab'
export type { ProductsTabProps } from './ProductsTab'

export type { ProductFormData, StockAdjustmentData } from './ProductModal'
