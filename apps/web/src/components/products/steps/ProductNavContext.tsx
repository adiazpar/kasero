import { createContext, useContext } from 'react'
import type { Product, ProductCategory } from '@kasero/shared/types'
import type { ProductFormData, StockAdjustmentData } from '../ProductModal'

// ---------------------------------------------------------------------------
// Generic nav surface — each product modal owns a step stack and exposes it
// via this context. Steps call push(stepKey) / pop() instead of pushing
// IonNav children. The IonNav-based version registered each step's own
// <IonPage> against the surrounding IonRouterOutlet's StackManager from
// inside the IonModal portal, which corrupted the outlet's view-stack
// tracking — the next push/pop on the outer outlet (e.g. drill from Manage
// into Team and back) surfaced the wrong cached IonPage under the correct
// URL. Same fix the order modals adopted (see order-steps/OrderNavContext).
// ---------------------------------------------------------------------------

export interface ProductNav {
  push: (step: string) => void
  pop: () => void
  /** Total entries in the back stack. Steps use this to decide whether the
   *  toolbar shows a back chevron (depth > 1) or a close X (depth === 1,
   *  the modal's entry step). */
  depth: number
}

export const AddProductNavContext = createContext<ProductNav | null>(null)
export const EditProductNavContext = createContext<ProductNav | null>(null)

/**
 * Resolves whichever nav context is mounted. Steps that work in both flows
 * (NameStep, PriceStep, etc.) consume this and don't need to know which
 * modal hosts them — they just push the step key for their flow.
 */
export function useProductNav(): ProductNav {
  const addNav = useContext(AddProductNavContext)
  const editNav = useContext(EditProductNavContext)
  const nav = addNav ?? editNav
  if (!nav) {
    throw new Error('useProductNav must be used inside AddProductModal or EditProductModal')
  }
  return nav
}

// ---------------------------------------------------------------------------
// Shared modal callbacks context — steps call close / exitComplete.
// ---------------------------------------------------------------------------

export interface ProductModalCallbacks {
  onClose: () => void
  onExitComplete: () => void
  categories: ProductCategory[]
  /** Returns the saved Product on success (with productNumber, updatedAt,
   *  etc. populated by the server) or null on validation/network failure.
   *  Step components capture the return value so the success step can
   *  render the per-business sequential stamp. */
  onSubmit: (data: ProductFormData, editingProductId: string | null) => Promise<Product | null>
}

export interface AddProductCallbacks extends ProductModalCallbacks {
  onAbortAiProcessing: () => void
  onAiPhotoCapture: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>
  onOpenSettings: () => void
  suggestedCategoryName: string | null
  onCreateCategory: (name: string) => Promise<string | null>
  onStartAiPipeline: () => void
  onClearPendingPhoto: () => void
}

export interface EditProductCallbacks extends ProductModalCallbacks {
  onDelete: (productId: string) => Promise<boolean>
  onSaveAdjustment: (data: StockAdjustmentData) => Promise<void>
  /**
   * Requests opening the AdjustStockModal for the currently-editing
   * product. Called by ReviewStep when the user taps the stock row in
   * EDIT mode. The host (EditProductModalWrapper in ProductsView) is
   * expected to close this Edit modal and open AdjustStockModal so
   * stock adjustment lives in ONE place across the app.
   */
  onRequestAdjustStock: () => void
  canDelete: boolean
  /** Step the modal opened to. Steps pushed deeper into the stack always
   *  show a back button; the root step (matching this index) is the entry
   *  point and shows the modal-level close X instead, since there is
   *  nothing to navigate back to. */
  entryStep: number
}

export const AddProductCallbacksContext = createContext<AddProductCallbacks | null>(null)

export function useAddProductCallbacks(): AddProductCallbacks {
  const ctx = useContext(AddProductCallbacksContext)
  if (!ctx) throw new Error('useAddProductCallbacks must be used inside AddProductModal')
  return ctx
}

export const EditProductCallbacksContext = createContext<EditProductCallbacks | null>(null)

export function useEditProductCallbacks(): EditProductCallbacks {
  const ctx = useContext(EditProductCallbacksContext)
  if (!ctx) throw new Error('useEditProductCallbacks must be used inside EditProductModal')
  return ctx
}

export function useProductOnClose(): () => void {
  const addCtx = useContext(AddProductCallbacksContext)
  const editCtx = useContext(EditProductCallbacksContext)
  const onClose = addCtx?.onClose ?? editCtx?.onClose
  if (!onClose) {
    throw new Error('useProductOnClose must be used inside AddProductModal or EditProductModal')
  }
  return onClose
}
