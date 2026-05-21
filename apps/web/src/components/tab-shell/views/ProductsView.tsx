'use client';
import { useIntl } from 'react-intl';

import { useState, useEffect, useCallback, useRef } from 'react'
import dynamic from '@/lib/next-dynamic-shim'
import { useRouter, useSearchParams } from '@/lib/next-navigation-shim'
import { useBusiness } from '@/contexts/business-context'
import { useProductFilters, useProductSettings } from '@/hooks'
import { TabContainer, PageSpinner } from '@/components/ui'
// Tabs render on mount so they stay static. Add/edit/settings modals are
// closed by default and open on user action; dynamic import keeps their
// bundle (plus framer-motion's Reorder in ProductSettingsModal) out of
// the initial products-page chunk.
import {
  ProductsTab,
  type ProductFormData,
  type StockAdjustmentData,
} from '@/components/products'
import { InventoryView } from '@/components/inventory/InventoryView'

const AddProductModal = dynamic(
  () => import('@/components/products/AddProductModal').then(m => m.AddProductModal),
  { ssr: false },
)
const EditProductModal = dynamic(
  () => import('@/components/products/EditProductModal').then(m => m.EditProductModal),
  { ssr: false },
)
const ProductSettingsModal = dynamic(
  () => import('@/components/products/ProductSettingsModal').then(m => m.ProductSettingsModal),
  { ssr: false },
)
const ProductInfoDrawer = dynamic(
  () => import('@/components/products/ProductInfoDrawer').then(m => m.ProductInfoDrawer),
  { ssr: false },
)
// Form-context provider is mounted inside AddProductModal /
// EditProductModal now (so it directly wraps IonNav). ProductsView
// no longer consumes form context here.
import type { PipelineStep } from '@/hooks'
import {
  type PageTab,
  type SortOption,
} from '@/lib/products'
// getProductIconUrl no longer needed at this level — populateFromProduct
// lives inside EditProductModal now and imports it directly.
import { useAiProductPipeline, useImageCompression, useBusinessFormat } from '@/hooks'
import { useProducts } from '@/contexts/products-context'
import { useBarcodeScan } from '@/hooks/useBarcodeScan'
import { useApiMessage } from '@/hooks/useApiMessage'
import type { Product, SortPreference, ProductCategory } from '@kasero/shared/types'
import {
  ApiError,
  apiDelete,
  apiPatch,
  apiPatchForm,
  apiPostForm,
  apiRequest,
} from '@/lib/api-client'

// ============================================
// PRODUCT MODAL WRAPPER
// Syncs pipeline state to context and populates form on edit
// ============================================

// ============================================
// ADD PRODUCT MODAL WRAPPER
// ============================================

interface AddProductModalWrapperProps {
  isOpen: boolean
  onClose: () => void
  categories: ProductCategory[]
  pipelineState: {
    step: PipelineStep
    result?: {
      name: string
      categoryId: string | null
      suggestedNewCategoryName: string | null
      price: number | null
      iconPreview: string
      iconBlob: Blob
    } | null
    error?: string | null
  }
  isCompressing: boolean
  onSubmit: (data: ProductFormData, editingProductId: string | null) => Promise<Product | null>
  onAbortAiProcessing: () => void
  onPipelineReset: () => void
  onAiPhotoCapture: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>
  onStartAiPipeline: () => void
  onCreateCategory: (name: string) => Promise<string | null>
  onOpenSettings: () => void
  onClearPendingPhoto: () => void
  checkBarcodeExists: (barcode: string) => Promise<string | null>
  defaultCategoryId?: string | null
}

function AddProductModalWrapper({
  isOpen,
  onClose,
  categories,
  pipelineState,
  isCompressing,
  onSubmit,
  onAbortAiProcessing,
  onPipelineReset,
  onAiPhotoCapture,
  onStartAiPipeline,
  onCreateCategory,
  onOpenSettings,
  onClearPendingPhoto,
  checkBarcodeExists,
  defaultCategoryId,
}: AddProductModalWrapperProps) {
  const pendingActionRef = useRef<(() => void) | null>(null)

  // Pipeline-sync useEffects, the resetForm-on-close timer, and the
  // barcode-uniqueness pre-check all moved INSIDE AddProductModal so
  // they live inside the form-context provider (which now also lives
  // inside the modal — the previous "provider above the modal" setup
  // had context-propagation issues through IonNav, leaving Review
  // step blank). The wrapper's only remaining job is the
  // pendingActionRef shuffle for "open Settings after I close" and
  // surfacing the AI suggested-category name out of pipelineState.
  const handleExitComplete = useCallback(() => {
    if (pendingActionRef.current) {
      pendingActionRef.current()
      pendingActionRef.current = null
    }
  }, [])

  const handleOpenSettings = useCallback(() => {
    pendingActionRef.current = onOpenSettings
    onClose()
  }, [onOpenSettings, onClose])

  const suggestedCategoryName = pipelineState.result?.suggestedNewCategoryName ?? null

  return (
    <AddProductModal
      isOpen={isOpen}
      onClose={onClose}
      onExitComplete={handleExitComplete}
      categories={categories}
      pipelineState={pipelineState}
      isCompressing={isCompressing}
      onSubmit={onSubmit}
      onAbortAiProcessing={onAbortAiProcessing}
      onPipelineReset={onPipelineReset}
      onAiPhotoCapture={onAiPhotoCapture}
      onOpenSettings={handleOpenSettings}
      suggestedCategoryName={suggestedCategoryName}
      onCreateCategory={onCreateCategory}
      onStartAiPipeline={onStartAiPipeline}
      onClearPendingPhoto={onClearPendingPhoto}
      checkBarcodeExists={checkBarcodeExists}
      defaultCategoryId={defaultCategoryId}
    />
  )
}

// ============================================
// EDIT PRODUCT MODAL WRAPPER
// ============================================

interface EditProductModalWrapperProps {
  isOpen: boolean
  onClose: () => void
  onExitCleanup: () => void
  categories: ProductCategory[]
  editingProduct: Product | null
  onSubmit: (data: ProductFormData, editingProductId: string | null) => Promise<Product | null>
  onDelete: (productId: string) => Promise<boolean>
  onSaveAdjustment: (data: StockAdjustmentData) => Promise<void>
  canDelete: boolean
  defaultCategoryId?: string | null
  initialStep?: number
}

function EditProductModalWrapper({
  isOpen,
  onClose,
  onExitCleanup,
  categories,
  editingProduct,
  onSubmit,
  onDelete,
  onSaveAdjustment,
  canDelete,
  defaultCategoryId,
  initialStep,
}: EditProductModalWrapperProps) {
  // Form-context concerns (populateFromProduct on open, resetForm on
  // close) all live INSIDE EditProductModal now, alongside the form
  // provider. The wrapper just forwards onExitCleanup so ProductsView
  // can clear its own editingProduct state when the modal fully closes.
  return (
    <EditProductModal
      isOpen={isOpen}
      onClose={onClose}
      onExitComplete={onExitCleanup}
      categories={categories}
      editingProduct={editingProduct}
      onSubmit={onSubmit}
      onDelete={onDelete}
      onSaveAdjustment={onSaveAdjustment}
      canDelete={canDelete}
      defaultCategoryId={defaultCategoryId}
      initialStep={initialStep}
    />
  )
}

export function ProductsView() {
  const t = useIntl()
  const tProductForm = t
  const translateApiMessage = useApiMessage()
  const { canManage, businessId } = useBusiness()
  const { locale, currency } = useBusinessFormat()
  const searchParams = useSearchParams()
  const router = useRouter()

  // Tab state — initialized from the URL so browser back/forward and
  // router.back() restore the tab the user was on.
  const [activeTab, setActiveTab] = useState<PageTab>(() =>
    searchParams?.get('tab') === 'inventory' ? 'inventory' : 'products'
  )

  const urlTab = searchParams?.get('tab') ?? null

  useEffect(() => {
    // Sync local activeTab when the URL changes (e.g. browser back/forward).
    // ProductsView no longer unmounts on tab switch (it's mounted persistently
    // by TabShell), so without this sync the local state drifts from the URL.
    // Mirrors the lazy-initializer logic so behavior is identical on first
    // mount and on URL change. No infinite loop: setState bails out on equal
    // values, and the sub-tab click handlers update both URL and state in the
    // same render cycle.
    setActiveTab(urlTab === 'inventory' ? 'inventory' : 'products')
  }, [urlTab])

  // Build the canonical URL for a given tab so we can keep the URL in sync
  // with tab state. Products is the default and carries no query param.
  const urlForTab = useCallback(
    (tab: PageTab) =>
      tab === 'products' ? `/${businessId}/products` : `/${businessId}/products?tab=inventory`,
    [businessId]
  )

  // Products live in a shared context so every mutation anywhere in the
  // app updates this single source of truth.
  const {
    products,
    setProducts,
    isLoaded: productsLoaded,
    error: productsError,
    ensureLoaded: ensureProductsLoaded,
  } = useProducts()
  const [isLoading, setIsLoading] = useState(() => !productsLoaded)
  const [error, setError] = useState('')

  // Surface the context's fetch error through the page's error banner.
  useEffect(() => {
    if (productsError) setError(productsError)
  }, [productsError])

  // Flip the page-level loading flag off once the context finishes its
  // initial fetch (isLoaded stays true for the rest of the session).
  useEffect(() => {
    if (productsLoaded) setIsLoading(false)
  }, [productsLoaded])

  // Product settings (shared across all pages via ProductSettingsProvider)
  const productSettings = useProductSettings()
  const {
    categories,
    settings,
    createCategory,
    updateCategory,
    deleteCategory,
    reorderCategories,
    updateSettings,
    isCreating: isCreatingCategory,
    isUpdating: isUpdatingCategory,
    isDeleting: isDeletingCategory,
    isSavingSettings,
    error: settingsError,
    clearError: clearSettingsError,
  } = productSettings

  // Handler to update sort preference in settings
  const handleSortChange = useCallback(async (sort: SortOption) => {
    await updateSettings({ sortPreference: sort as SortPreference })
  }, [updateSettings])

  // Product filters
  const {
    searchQuery,
    setSearchQuery,
    selectedFilter,
    setSelectedFilter,
    sortBy,
    setSortBy,
    filteredProducts,
    availableFilters,
  } = useProductFilters({
    products,
    categories,
    sortPreference: settings?.sortPreference,
    onSortChange: handleSortChange,
  })

  const urlFilter = searchParams?.get('filter') ?? null

  // Deep-link from Home's alerts:
  //   ?filter=low_stock  → Products sub-tab + low_stock filter category
  // Subsequent in-app filter changes (user clicking pills) supersede.
  useEffect(() => {
    if (urlFilter === 'low_stock') {
      setSelectedFilter('low_stock')
    }
    // Intentional: react only to the URL value. Once applied, in-app
    // selectedFilter changes are not echoed back to the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlFilter])

  // Sort sheet state
  const [isSortSheetOpen, setIsSortSheetOpen] = useState(false)

  // Product settings modal state
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false)

  // Product modal state
  const [isModalOpen, setIsModalOpen] = useState(false)

  // AI Pipeline (needed by page for photo capture handler)
  const pipeline = useAiProductPipeline()
  const compression = useImageCompression()

  // Permission check
  const canDelete = canManage

  // Prime products eagerly on mount — idempotent and lazy.
  useEffect(() => {
    if (!businessId) return
    ensureProductsLoaded()
  }, [businessId, ensureProductsLoaded])

  // Track which product is being edited (for passing to modal wrapper)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [editInitialStep, setEditInitialStep] = useState(0)

  // Read-only product view used by employees — managers tap rows into the
  // edit modal; non-managers land here.
  const [viewingProduct, setViewingProduct] = useState<Product | null>(null)

  // Product handlers - now receive data from modal context
  const handleSubmitProduct = useCallback(async (
    formData: ProductFormData,
    editingProductId: string | null
  ): Promise<Product | null> => {
    if (!formData.name.trim()) {
      return null
    }

    const priceNum = parseFloat(formData.price)
    if (isNaN(priceNum) || priceNum < 0) {
      return null
    }

    try {
      const data = new FormData()
      data.append('name', formData.name.trim())
      data.append('price', priceNum.toString())
      data.append('categoryId', formData.categoryId || '')
      data.append('active', formData.active.toString())
      data.append('barcode', formData.barcode || '')
      data.append('barcodeFormat', formData.barcodeFormat || '')
      data.append('barcodeSource', formData.barcodeSource || '')
      if (formData.generatedIconBlob) {
        data.append('icon', formData.generatedIconBlob, 'icon.png')
      } else if (formData.iconType === 'preset' && formData.presetEmoji) {
        data.append('presetIcon', formData.presetEmoji)
      } else if (formData.iconType === null) {
        // Icon was cleared
        data.append('clearIcon', 'true')
      }
      // Initial stock only on Add — Edit path uses AdjustInventoryStep
      // and a different endpoint. The PATCH route ignores it; only the
      // POST route reads `initialStock` when validating + inserting.
      if (
        !editingProductId &&
        typeof formData.initialStock === 'number' &&
        formData.initialStock > 0
      ) {
        data.append('initialStock', formData.initialStock.toString())
      }

      const url = editingProductId
        ? `/api/businesses/${businessId}/products/${editingProductId}`
        : `/api/businesses/${businessId}/products`

      const result = editingProductId
        ? await apiPatchForm<{ product: Product }>(url, data)
        : await apiPostForm<{ product: Product }>(url, data)

      const record: Product = result.product
      if (editingProductId) {
        setProducts(prev => prev.map(p => p.id === record.id ? record : p))
      } else {
        setProducts(prev => [...prev, record].sort((a, b) => a.name.localeCompare(b.name)))
      }

      return record
    } catch (err) {
      console.warn('Error saving product:', err)
      if (err instanceof ApiError) {
        // Use the structured envelope message when available (e.g.
        // PRODUCT_FORBIDDEN_NOT_MANAGER) so the user sees the real reason,
        // not a generic fallback.
        if (err.envelope) {
          throw new Error(translateApiMessage(err.envelope))
        }
        throw new Error(err.data.error || tProductForm.formatMessage({ id: 'productForm.failed_to_save' }))
      }
      if (err instanceof Error) {
        throw err
      }
      throw new Error(tProductForm.formatMessage({ id: 'productForm.failed_to_save' }))
    }
  }, [businessId, setProducts, translateApiMessage, tProductForm])

  const handleDeleteProduct = useCallback(async (productId: string): Promise<boolean> => {
    try {
      await apiDelete(`/api/businesses/${businessId}/products/${productId}`)
      setProducts(prev => prev.filter(p => p.id !== productId))
      return true
    } catch (err) {
      console.error('Error deleting product:', err)
      if (err instanceof ApiError && err.envelope) {
        throw new Error(translateApiMessage(err.envelope))
      }
      throw new Error(tProductForm.formatMessage({
        id: 'productForm.failed_to_delete'
      }))
    }
  }, [businessId, setProducts, translateApiMessage, tProductForm])

  const handleSaveAdjustment = useCallback(async (data: StockAdjustmentData) => {
    try {
      // Optimistic-locked write: the server compares `expectedStock`
      // to the row's current value and refuses with 409 if another
      // manager edited it in the meantime. Without this guard the
      // last write silently won and the earlier edit was lost.
      //
      // Called from ReviewStep's Save changes flow, BEFORE the regular
      // product save. We don't close the modal here — the caller is
      // mid-flow and will navigate to the success step on its own.
      await apiPatch(`/api/businesses/${businessId}/products/${data.productId}/stock`, {
        stock: data.newStockValue,
        expectedStock: data.expectedStockValue,
      })
      setProducts(prev => prev.map(p => p.id === data.productId ? { ...p, stock: data.newStockValue } : p))
    } catch (err) {
      console.error('Error adjusting stock:', err)
      // Re-throw so the modal can surface the envelope (e.g.
      // STOCK_CONCURRENCY_CONFLICT prompts the user to refresh).
      throw err
    }
  }, [businessId, setProducts])

  const handleCloseModal = useCallback(() => {
    if (pipeline.state.step !== 'idle') {
      pipeline.cancel()
    }
    if (compression.state.isProcessing) {
      compression.cancel()
    }
    setPendingAiImage(null)
    setIsModalOpen(false)
  }, [pipeline, compression])

  const handleOpenAdd = useCallback(() => {
    if (pipeline.state.step !== 'idle') {
      pipeline.reset()
    }
    if (compression.state.isProcessing) {
      compression.cancel()
    }
    setEditingProduct(null)
    setIsModalOpen(true)
  }, [pipeline, compression])

  const handleOpenEdit = useCallback((product: Product) => {
    if (pipeline.state.step !== 'idle') {
      pipeline.reset()
    }
    if (compression.state.isProcessing) {
      compression.cancel()
    }
    setEditInitialStep(0)
    setEditingProduct(product)
    setIsModalOpen(true)
  }, [pipeline, compression])

  const handleAdjustInventory = useCallback((product: Product) => {
    if (pipeline.state.step !== 'idle') {
      pipeline.reset()
    }
    if (compression.state.isProcessing) {
      compression.cancel()
    }
    setEditInitialStep(1)
    setEditingProduct(product)
    setIsModalOpen(true)
  }, [pipeline, compression])

  // Swipe-row delete entry — open the edit modal directly at the
  // DeleteConfirmStep root. Mirrors how Orders surfaces a swipe delete:
  // user keeps the full destructive-action confirm screen, just skips
  // the Review detour.
  const handleOpenDelete = useCallback((product: Product) => {
    if (pipeline.state.step !== 'idle') {
      pipeline.reset()
    }
    if (compression.state.isProcessing) {
      compression.cancel()
    }
    setEditInitialStep(2)
    setEditingProduct(product)
    setIsModalOpen(true)
  }, [pipeline, compression])

  const handleBarcodeScanResult = useCallback(async ({ value }: { value: string }) => {
    setError('')
    try {
      const data = await apiRequest<{ products?: Product[] }>(
        `/api/businesses/${businessId}/products?barcode=${encodeURIComponent(value)}`
      )

      const matched: Product[] = data.products || []
      if (matched.length > 0) {
        handleOpenEdit(matched[0])
      } else {
        setSearchQuery(value)
      }
    } catch {
      setError(t.formatMessage({
        id: 'products.scan_lookup_error'
      }))
    }
  }, [businessId, handleOpenEdit, setError, setSearchQuery, t])

  const {
    open: openBarcodeScan,
    busy: barcodeScanBusy,
    hiddenInput: barcodeScanInput,
  } = useBarcodeScan({
    onResult: handleBarcodeScanResult,
    onError: setError,
  })

  const [pendingAiImage, setPendingAiImage] = useState<string | null>(null)

  const handleAiPhotoCapture = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const compressedBase64 = await compression.compressImage(file)

    if (compression.state.error || !compressedBase64) {
      return
    }

    setPendingAiImage(compressedBase64)
  }, [compression])

  const handleStartAiPipeline = useCallback(() => {
    if (!pendingAiImage) return
    pipeline.startPipeline(pendingAiImage, {
      categories: categories.map((c) => ({ id: c.id, name: c.name })),
      locale,
      currency,
    }).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to start AI pipeline')
    })
  }, [pendingAiImage, pipeline, categories, locale, currency])

  const handleCreateCategory = useCallback(async (name: string): Promise<string | null> => {
    const created = await createCategory(name)
    return created?.id ?? null
  }, [createCategory])

  const handleClearPendingPhoto = useCallback(() => {
    setPendingAiImage(null)
  }, [])

  const checkBarcodeExists = useCallback(async (value: string): Promise<string | null> => {
    try {
      const data = await apiRequest<{ products?: Product[] }>(
        `/api/businesses/${businessId}/products?barcode=${encodeURIComponent(value)}`
      )
      const matched: Product[] = data.products || []
      return matched.length > 0 ? matched[0].name : null
    } catch {
      return null
    }
  }, [businessId])


  if (isLoading) {
    return (
      <PageSpinner />
    )
  }

  const handleSegmentChange = (tab: PageTab) => {
    setActiveTab(tab)
    setError('')
    router.replace(urlForTab(tab), { scroll: false })
  }

  return (
    <>
      <div className="products-page">
        {/* Custom pill segmented control — matches the mono uppercase
            tracked vocabulary used elsewhere (tab-bar labels, eyebrows,
            stamp chips). Replaces IonSegment to keep the chrome on-brand.

            Hidden when both products and orders are empty: on a brand-new
            business the user has no signal that orders even exist, so a
            "PRODUCTS / ORDERS" toggle on an empty page reads as a stub.
            The empty state below carries its own primary CTA. */}
        {products.length > 0 && (
          <div role="tablist" aria-label={t.formatMessage({ id: 'products.tab_switcher_aria' })} className="products-segment">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'products'}
              className="products-segment__button"
              onClick={() => handleSegmentChange('products')}
            >
              {t.formatMessage({ id: 'products.tab_products' })}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'inventory'}
              className="products-segment__button"
              onClick={() => handleSegmentChange('inventory')}
            >
              {t.formatMessage({ id: 'products.tab_inventory' })}
            </button>
          </div>
        )}

        <TabContainer
          activeTab={activeTab}
          onTabChange={(id) => {
            const tab = id as PageTab
            setActiveTab(tab)
            setError('')
            router.replace(urlForTab(tab), { scroll: false })
          }}
          swipeable
          fitActiveHeight
          preserveScrollOnChange
        >
          <TabContainer.Tab id="products">
            <ProductsTab
              products={products}
              filteredProducts={filteredProducts}
              categories={categories}
              availableFilters={availableFilters}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              selectedFilter={selectedFilter}
              onFilterChange={setSelectedFilter}
              sortBy={sortBy}
              onSortChange={setSortBy}
              isSortSheetOpen={isSortSheetOpen}
              onSortSheetOpenChange={setIsSortSheetOpen}
              onAddProduct={handleOpenAdd}
              onEditProduct={handleOpenEdit}
              onViewProduct={setViewingProduct}
              onAdjustInventory={handleAdjustInventory}
              onDeleteProduct={canDelete ? handleOpenDelete : undefined}
              canManage={canManage}
              canModify={canManage}
              onOpenSettings={() => setIsSettingsModalOpen(true)}
              error={error}
              isModalOpen={isModalOpen}
              onScanClick={openBarcodeScan}
              scanBusy={barcodeScanBusy}
              scanHiddenInput={barcodeScanInput}
            />
          </TabContainer.Tab>
          <TabContainer.Tab id="inventory">
            <InventoryView />
          </TabContainer.Tab>
        </TabContainer>
      </div>
      {/*
        Product modals — each modal mounts its OWN ProductFormProvider
        internally (wrapping IonNav). The form context used to live
        here, wrapping both modals — but pushed views inside IonNav
        weren't seeing it (Review surface rendered blank values even
        after the user filled them in upstream). Provider-inside-modal
        guarantees every step's React tree is inside the provider.
      */}
      <AddProductModalWrapper
        isOpen={isModalOpen && !editingProduct}
        onClose={handleCloseModal}
        categories={categories}
        pipelineState={pipeline.state}
        isCompressing={compression.state.isProcessing}
        onSubmit={handleSubmitProduct}
        onAbortAiProcessing={() => {
          pipeline.cancel()
          compression.cancel()
        }}
        onPipelineReset={() => {
          pipeline.reset()
          setPendingAiImage(null)
        }}
        onAiPhotoCapture={handleAiPhotoCapture}
        onStartAiPipeline={handleStartAiPipeline}
        onCreateCategory={handleCreateCategory}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        onClearPendingPhoto={handleClearPendingPhoto}
        checkBarcodeExists={checkBarcodeExists}
        defaultCategoryId={settings?.defaultCategoryId}
      />
      <EditProductModalWrapper
        isOpen={isModalOpen && !!editingProduct}
        onClose={handleCloseModal}
        onExitCleanup={() => setEditingProduct(null)}
        categories={categories}
        editingProduct={editingProduct}
        onSubmit={handleSubmitProduct}
        onDelete={handleDeleteProduct}
        onSaveAdjustment={handleSaveAdjustment}
        canDelete={canDelete}
        defaultCategoryId={settings?.defaultCategoryId}
        initialStep={editInitialStep}
      />
      <ProductInfoDrawer
        isOpen={!!viewingProduct}
        onClose={() => setViewingProduct(null)}
        onExitComplete={() => setViewingProduct(null)}
        product={viewingProduct}
        categories={categories}
      />
      {/* Product Settings Modal */}
      <ProductSettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        categories={categories}
        isCreatingCategory={isCreatingCategory}
        isUpdatingCategory={isUpdatingCategory}
        isDeletingCategory={isDeletingCategory}
        onCreateCategory={createCategory}
        onUpdateCategory={updateCategory}
        onDeleteCategory={async (id: string) => {
          const success = await deleteCategory(id)
          if (success) {
            setProducts(prev => prev.map(p => p.categoryId === id ? { ...p, categoryId: null } : p))
          }
          return success
        }}
        onReorderCategories={reorderCategories}
        defaultCategoryId={settings?.defaultCategoryId || null}
        sortPreference={settings?.sortPreference || 'name_asc'}
        isSavingSettings={isSavingSettings}
        onUpdateSettings={updateSettings}
        error={settingsError}
        onClearError={clearSettingsError}
      />
    </>
  );
}
