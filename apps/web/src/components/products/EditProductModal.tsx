'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ModalShell } from '@/components/ui'
import { useDismissOnDelete } from '@/hooks/useDismissOnDelete'
import type { Product, ProductCategory } from '@kasero/shared/types'
import type { ProductFormData, StockAdjustmentData } from './ProductModal'
import {
  ProductFormProvider,
  useProductForm,
} from '@/contexts/product-form-context'
import { getProductIconUrl } from '@/lib/utils'
import {
  EditProductNavContext,
  EditProductCallbacksContext,
  type EditProductCallbacks,
  type ProductNav,
} from './steps/ProductNavContext'
import { ReviewStep } from './steps/ReviewStep'
import { AdjustInventoryStep } from './steps/AdjustInventoryStep'
import { DeleteConfirmStep } from './steps/DeleteConfirmStep'
import { NameStep } from './steps/NameStep'
import { PriceStep } from './steps/PriceStep'
import { CategoryStockStep } from './steps/CategoryStockStep'
import { BarcodeStep } from './steps/BarcodeStep'
import { EditSuccessStep } from './steps/EditSuccessStep'
import { DeleteSuccessStep } from './steps/DeleteSuccessStep'

type Step =
  | 'review'
  | 'adjust-inventory'
  | 'delete-confirm'
  | 'name-edit'
  | 'price-edit'
  | 'category-stock-edit'
  | 'barcode-edit'
  | 'edit-success'
  | 'delete-success'

export interface EditProductModalProps {
  isOpen: boolean
  onClose: () => void
  onExitComplete: () => void
  categories: ProductCategory[]
  /** The product to edit. Must be present when the modal opens. */
  editingProduct: Product | null
  onSubmit: (data: ProductFormData, editingProductId: string | null) => Promise<Product | null>
  onDelete: (productId: string) => Promise<boolean>
  onSaveAdjustment: (data: StockAdjustmentData) => Promise<void>
  canDelete: boolean
  /** Default category for resetForm (after modal closes). */
  defaultCategoryId?: string | null
  /** Step the modal opens to. Defaults to 0 (Review). 1 = Adjust inventory, 2 = Delete confirm. */
  initialStep?: number
}

const ROOT_FOR_STEP_INDEX: Record<number, Step> = {
  0: 'review',
  1: 'adjust-inventory',
  2: 'delete-confirm',
}

/**
 * Outer wrapper that mounts ProductFormProvider INSIDE the modal so it
 * wraps the step subtree directly. See AddProductModal for the
 * propagation problem this fixes.
 */
export function EditProductModal(props: EditProductModalProps) {
  return (
    <ProductFormProvider defaultCategoryId={props.defaultCategoryId}>
      <EditProductModalInner {...props} />
    </ProductFormProvider>
  )
}

function EditProductModalInner({
  isOpen,
  onClose,
  onExitComplete,
  categories,
  editingProduct,
  onSubmit,
  onDelete,
  onSaveAdjustment,
  canDelete,
  defaultCategoryId,
  initialStep = 0,
}: EditProductModalProps) {
  const rootStep = ROOT_FOR_STEP_INDEX[initialStep] ?? 'review'
  const [stack, setStack] = useState<Step[]>([rootStep])
  const { populateFromProduct, resetForm } = useProductForm()

  const stableDismiss = useCallback(() => onClose(), [onClose])
  useDismissOnDelete('product', editingProduct?.id ?? null, stableDismiss)

  // Reset the stack to the configured root every time the modal opens.
  // The same modal component is reused across consecutive edit flows; if
  // we don't reset, a prior session's deeper stack would persist.
  useEffect(() => {
    if (isOpen) setStack([rootStep])
  }, [isOpen, rootStep])

  // Populate form context when the modal opens with a product.
  useEffect(() => {
    if (isOpen && editingProduct) {
      populateFromProduct(editingProduct, getProductIconUrl)
    }
  }, [isOpen, editingProduct, populateFromProduct])

  // Delayed form reset — runs ~250ms after the modal animates closed so
  // the parent's onExitComplete (clears editingProduct) and our resetForm
  // don't race the dismiss animation. Pattern matches NewOrderModal.
  useEffect(() => {
    if (isOpen) return
    const timer = window.setTimeout(() => {
      resetForm(defaultCategoryId)
      onExitComplete()
    }, 250)
    return () => window.clearTimeout(timer)
  }, [isOpen, resetForm, defaultCategoryId, onExitComplete])

  const push = useCallback((step: string) => {
    setStack((s) => [...s, step as Step])
  }, [])
  const pop = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))
  }, [])

  const nav: ProductNav = useMemo(
    () => ({ push, pop, depth: stack.length }),
    [push, pop, stack.length],
  )

  const callbacks: EditProductCallbacks = {
    onClose,
    onExitComplete,
    categories,
    onSubmit,
    onDelete,
    onSaveAdjustment,
    canDelete,
    entryStep: initialStep,
  }

  const current = stack[stack.length - 1]

  return (
    <EditProductCallbacksContext.Provider value={callbacks}>
      <EditProductNavContext.Provider value={nav}>
        <ModalShell rawContent isOpen={isOpen} onClose={onClose}>
          {current === 'review' && <ReviewStep />}
          {current === 'adjust-inventory' && <AdjustInventoryStep />}
          {current === 'delete-confirm' && <DeleteConfirmStep />}
          {current === 'name-edit' && <NameStep mode="edit" />}
          {current === 'price-edit' && <PriceStep mode="edit" />}
          {current === 'category-stock-edit' && <CategoryStockStep mode="edit" />}
          {current === 'barcode-edit' && <BarcodeStep mode="edit" />}
          {current === 'edit-success' && <EditSuccessStep />}
          {current === 'delete-success' && <DeleteSuccessStep />}
        </ModalShell>
      </EditProductNavContext.Provider>
    </EditProductCallbacksContext.Provider>
  )
}
