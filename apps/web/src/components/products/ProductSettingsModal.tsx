'use client'

import { useIntl } from 'react-intl'
import { useState, useEffect, useRef } from 'react'
import { Check, ChevronRight, GripVertical, Plus, X } from 'lucide-react'
import { Reorder, useDragControls } from 'framer-motion'
import { IonSpinner } from '@ionic/react'
import { ModalShell } from '@/components/ui/modal-shell'
import { SORT_OPTIONS } from '@/lib/products'
import type { ProductCategory, SortPreference } from '@kasero/shared/types'

// ============================================
// PROPS
// ============================================

export interface ProductSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  onExitComplete?: () => void

  // Categories
  categories: ProductCategory[]
  isCreatingCategory: boolean
  isUpdatingCategory: boolean
  isDeletingCategory: boolean
  onCreateCategory: (name: string) => Promise<ProductCategory | null>
  onUpdateCategory: (id: string, name: string) => Promise<ProductCategory | null>
  onDeleteCategory: (id: string) => Promise<boolean>
  onReorderCategories: (categoryIds: string[]) => Promise<boolean>

  // Settings
  defaultCategoryId: string | null
  sortPreference: SortPreference
  isSavingSettings: boolean
  onUpdateSettings: (updates: { defaultCategoryId?: string | null; sortPreference?: SortPreference }) => Promise<unknown>

  // Error
  error: string
  onClearError: () => void
}

// ============================================
// CATEGORY ROW
// ============================================

interface CategoryRowProps {
  category: ProductCategory
  isDefault: boolean
  isEditing: boolean
  editingValue: string
  onEditingValueChange: (v: string) => void
  isPendingDelete: boolean
  isCommittingEdit: boolean
  isCommittingDelete: boolean
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onStartDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
  onDragEnd: () => void
}

function CategoryRow({
  category,
  isDefault,
  isEditing,
  editingValue,
  onEditingValueChange,
  isPendingDelete,
  isCommittingEdit,
  isCommittingDelete,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onStartDelete,
  onCancelDelete,
  onConfirmDelete,
  onDragEnd,
}: CategoryRowProps) {
  const intl = useIntl()
  // dragListener=false + manual controls means only the grip starts a drag —
  // taps anywhere else on the row behave as normal clicks.
  const controls = useDragControls()

  return (
    <Reorder.Item
      as="div"
      value={category}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDragEnd}
      className="settings-category-row"
    >
      <div className="settings-category-row__main">
        <button
          type="button"
          onPointerDown={(e) => controls.start(e)}
          className="settings-category-row__grip"
          aria-label={intl.formatMessage({ id: 'productSettings.drag_to_reorder_aria' })}
        >
          <GripVertical style={{ width: 14, height: 14 }} />
        </button>

        {isEditing ? (
          <input
            type="text"
            value={editingValue}
            onChange={(e) => onEditingValueChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (editingValue.trim() && editingValue.trim() !== category.name) onSaveEdit()
              }
              if (e.key === 'Escape') onCancelEdit()
            }}
            className="settings-category-row__input"
            autoFocus
            autoComplete="off"
            placeholder={intl.formatMessage({ id: 'productSettings.category_name_placeholder' })}
          />
        ) : (
          <span className="settings-category-row__name">{category.name}</span>
        )}

        {isDefault && !isEditing && !isPendingDelete && (
          <span className="settings-tag settings-tag--default">
            {intl.formatMessage({ id: 'productSettings.tag_default' })}
          </span>
        )}

        {isEditing && (
          <span className="settings-tag settings-tag--editing">
            {intl.formatMessage({ id: 'productSettings.tag_editing' })}
          </span>
        )}

        {!isEditing && !isPendingDelete && (
          <div className="settings-category-row__actions">
            <button
              type="button"
              onClick={onStartEdit}
              className="settings-link"
              aria-label={intl.formatMessage({ id: 'productSettings.edit_category_aria' })}
            >
              {intl.formatMessage({ id: 'productSettings.action_edit' })}
            </button>
            <span className="settings-link__sep" aria-hidden="true">·</span>
            <button
              type="button"
              onClick={onStartDelete}
              className="settings-link settings-link--danger"
              aria-label={intl.formatMessage({ id: 'productSettings.delete_category_aria' })}
            >
              {intl.formatMessage({ id: 'productSettings.action_delete' })}
            </button>
          </div>
        )}

        {isEditing && (
          <div className="settings-category-row__actions">
            <button
              type="button"
              onClick={onCancelEdit}
              className="settings-link"
              disabled={isCommittingEdit}
            >
              {intl.formatMessage({ id: 'common.cancel' })}
            </button>
            <span className="settings-link__sep" aria-hidden="true">·</span>
            <button
              type="button"
              onClick={onSaveEdit}
              className="settings-link settings-link--primary"
              disabled={
                isCommittingEdit ||
                !editingValue.trim() ||
                editingValue.trim() === category.name
              }
            >
              {isCommittingEdit
                ? <IonSpinner name="dots" style={{ width: 18, height: 12 }} />
                : intl.formatMessage({ id: 'productSettings.action_save' })}
            </button>
          </div>
        )}
      </div>

      {isPendingDelete && (
        <div className="settings-category-row__confirm" role="alert">
          <span className="settings-category-row__confirm-prompt">
            {intl.formatMessage(
              { id: 'productSettings.delete_inline_prompt' },
              { name: category.name },
            )}
          </span>
          <div className="settings-category-row__confirm-actions">
            <button
              type="button"
              className="settings-pill settings-pill--ghost"
              onClick={onCancelDelete}
              disabled={isCommittingDelete}
            >
              {intl.formatMessage({ id: 'common.cancel' })}
            </button>
            <button
              type="button"
              className="settings-pill settings-pill--danger"
              onClick={onConfirmDelete}
              disabled={isCommittingDelete}
            >
              {isCommittingDelete
                ? <IonSpinner name="crescent" style={{ width: 14, height: 14 }} />
                : intl.formatMessage({ id: 'productSettings.action_delete_confirm' })}
            </button>
          </div>
        </div>
      )}
    </Reorder.Item>
  )
}

// ============================================
// CATEGORY LIST (with reorder)
// ============================================

interface CategoryListProps {
  categories: ProductCategory[]
  defaultCategoryId: string | null
  editingId: string | null
  editingValue: string
  onEditingValueChange: (v: string) => void
  pendingDeleteId: string | null
  isCommittingEdit: boolean
  isCommittingDelete: boolean
  onReorder: (ids: string[]) => Promise<boolean>
  onStartEdit: (c: ProductCategory) => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onStartDelete: (c: ProductCategory) => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
}

function CategoryList({
  categories,
  defaultCategoryId,
  editingId,
  editingValue,
  onEditingValueChange,
  pendingDeleteId,
  isCommittingEdit,
  isCommittingDelete,
  onReorder,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onStartDelete,
  onCancelDelete,
  onConfirmDelete,
}: CategoryListProps) {
  const [items, setItems] = useState(categories)
  const itemsRef = useRef(items)

  useEffect(() => {
    setItems(categories)
    itemsRef.current = categories
  }, [categories])

  const handleReorder = (newItems: ProductCategory[]) => {
    setItems(newItems)
    itemsRef.current = newItems
  }

  const handleDragEnd = () => {
    onReorder(itemsRef.current.map((c) => c.id))
  }

  return (
    <Reorder.Group
      as="div"
      axis="y"
      values={items}
      onReorder={handleReorder}
      className="settings-category-list"
    >
      {items.map((category) => (
        <CategoryRow
          key={category.id}
          category={category}
          isDefault={defaultCategoryId === category.id}
          isEditing={editingId === category.id}
          editingValue={editingId === category.id ? editingValue : ''}
          onEditingValueChange={onEditingValueChange}
          isPendingDelete={pendingDeleteId === category.id}
          isCommittingEdit={isCommittingEdit && editingId === category.id}
          isCommittingDelete={isCommittingDelete && pendingDeleteId === category.id}
          onStartEdit={() => onStartEdit(category)}
          onCancelEdit={onCancelEdit}
          onSaveEdit={onSaveEdit}
          onStartDelete={() => onStartDelete(category)}
          onCancelDelete={onCancelDelete}
          onConfirmDelete={onConfirmDelete}
          onDragEnd={handleDragEnd}
        />
      ))}
    </Reorder.Group>
  )
}

// ============================================
// MAIN COMPONENT
// ============================================

export function ProductSettingsModal({
  isOpen,
  onClose,
  onExitComplete,
  categories,
  isCreatingCategory,
  isUpdatingCategory,
  isDeletingCategory,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
  onReorderCategories,
  defaultCategoryId,
  sortPreference,
  isSavingSettings,
  onUpdateSettings,
  error,
  onClearError,
}: ProductSettingsModalProps) {
  const intl = useIntl()

  // Optimistic local state — these update immediately so the check mark
  // moves on tap; the API fires in the background. Re-sync if the prop
  // changes externally (eg. saved successfully or another window).
  const [localDefaultCategoryId, setLocalDefaultCategoryId] = useState<string | null>(defaultCategoryId)
  const [localSortPreference, setLocalSortPreference] = useState<SortPreference>(sortPreference)

  useEffect(() => setLocalDefaultCategoryId(defaultCategoryId), [defaultCategoryId])
  useEffect(() => setLocalSortPreference(sortPreference), [sortPreference])

  // Inline add-new-category form
  const [newCategoryName, setNewCategoryName] = useState('')
  // Ref on the add-category input so an empty-state submit can focus it
  // rather than silently no-oping. Without this, the button was reading
  // as "permission-gated faded" when really it just needed input.
  const newCategoryInputRef = useRef<HTMLInputElement | null>(null)
  const [createCelebrating, setCreateCelebrating] = useState(false)

  // Inline edit-in-place
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')

  // Inline delete confirmation row
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  // Reset local state once the modal has fully closed so the next open
  // shows a fresh sheet.
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setNewCategoryName('')
        setCreateCelebrating(false)
        setEditingCategoryId(null)
        setEditingValue('')
        setPendingDeleteId(null)
        setLocalDefaultCategoryId(defaultCategoryId)
        setLocalSortPreference(sortPreference)
        onClearError()
        onExitComplete?.()
      }, 250)
      return () => clearTimeout(timer)
    }
  }, [isOpen, onClearError, onExitComplete, defaultCategoryId, sortPreference])

  // ----- Sort labels (translation lookup) -----
  const sortLabels: Record<SortPreference, string> = {
    name_asc: intl.formatMessage({ id: 'products.sort_name_asc' }),
    name_desc: intl.formatMessage({ id: 'products.sort_name_desc' }),
    price_asc: intl.formatMessage({ id: 'products.sort_price_asc' }),
    price_desc: intl.formatMessage({ id: 'products.sort_price_desc' }),
    stock_asc: intl.formatMessage({ id: 'products.sort_stock_asc' }),
    stock_desc: intl.formatMessage({ id: 'products.sort_stock_desc' }),
    category: intl.formatMessage({ id: 'products.sort_category' }),
  }

  // ----- Handlers -----
  const handleSelectSort = (next: SortPreference) => {
    if (next === localSortPreference) return
    setLocalSortPreference(next)
    onUpdateSettings({ sortPreference: next })
  }

  const handleSelectDefault = (next: string | null) => {
    if (next === localDefaultCategoryId) return
    setLocalDefaultCategoryId(next)
    onUpdateSettings({ defaultCategoryId: next })
  }

  const handleCreateCategory = async () => {
    if (isCreatingCategory) return
    const name = newCategoryName.trim()
    // Empty submit (e.g. tapping the Add pill before typing): focus the
    // input rather than no-oping. Tells the user the button works and
    // they just need to type a name — no permission gate involved.
    if (!name) {
      newCategoryInputRef.current?.focus()
      return
    }
    const created = await onCreateCategory(name)
    if (created) {
      setNewCategoryName('')
      setCreateCelebrating(true)
      // brief celebration ping; cleared by the timeout below
      setTimeout(() => setCreateCelebrating(false), 1100)
    }
  }

  const handleStartEdit = (c: ProductCategory) => {
    setPendingDeleteId(null)
    setEditingCategoryId(c.id)
    setEditingValue(c.name)
  }

  const handleCancelEdit = () => {
    setEditingCategoryId(null)
    setEditingValue('')
  }

  const handleSaveEdit = async () => {
    if (!editingCategoryId) return
    const name = editingValue.trim()
    if (!name) return
    const target = categories.find((c) => c.id === editingCategoryId)
    if (target && name === target.name) {
      handleCancelEdit()
      return
    }
    const updated = await onUpdateCategory(editingCategoryId, name)
    if (updated) handleCancelEdit()
  }

  const handleStartDelete = (c: ProductCategory) => {
    setEditingCategoryId(null)
    setEditingValue('')
    setPendingDeleteId(c.id)
  }

  const handleCancelDelete = () => setPendingDeleteId(null)

  const handleConfirmDelete = async () => {
    if (!pendingDeleteId) return
    const ok = await onDeleteCategory(pendingDeleteId)
    if (ok) {
      // If we just deleted the current default, the parent will null it
      // out via the prop sync; nothing else to do here.
      setPendingDeleteId(null)
    }
  }

  // Two-step flow inside the modal (Pattern 1 from ModalShell): the main
  // surface holds sort + default category and a CTA into the second step,
  // which is the dedicated category-management surface (add, rename,
  // reorder, delete). Keeping creation + reorganization on the same step
  // means the user can add a category and immediately drop it where they
  // want it without bouncing back and forth.
  const [step, setStep] = useState<'main' | 'manage'>('main')

  // Bring the modal back to the main step on close so the next open is
  // never mid-flow. Step state wipes immediately rather than after the
  // 250ms exit animation (the body would otherwise flicker between steps).
  useEffect(() => {
    if (!isOpen) setStep('main')
  }, [isOpen])

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={intl.formatMessage({
        id: step === 'manage'
          ? 'productSettings.manage_step_title'
          : 'productSettings.title',
      })}
      onBack={step === 'manage' ? () => setStep('main') : undefined}
      noSwipeDismiss
    >
      <div className="settings-sheet">
        {/* ---------- Hero ---------- */}
        <header className="pm-hero">
          <span className="pm-hero__eyebrow">
            {intl.formatMessage({
              id: step === 'manage'
                ? 'productSettings.manage_eyebrow'
                : 'productSettings.eyebrow',
            })}
          </span>
          <h1 className="pm-hero__title">
            {intl.formatMessage(
              {
                id: step === 'manage'
                  ? 'productSettings.manage_hero_title'
                  : 'productSettings.hero_title',
              },
              { em: (chunks) => <em key="em">{chunks}</em> },
            )}
          </h1>
          <p className="pm-hero__subtitle">
            {intl.formatMessage({
              id: step === 'manage'
                ? 'productSettings.manage_hero_subtitle'
                : 'productSettings.hero_subtitle',
            })}
          </p>
        </header>

        {/* ---------- Inline error banner ---------- */}
        {error && (
          <div className="settings-error" role="alert">
            <span className="settings-error__rule" aria-hidden="true" />
            <span className="settings-error__text">{error}</span>
            <button
              type="button"
              className="settings-error__dismiss"
              onClick={onClearError}
              aria-label={intl.formatMessage({ id: 'common.dismiss' })}
            >
              <X style={{ width: 14, height: 14 }} />
            </button>
          </div>
        )}

        {step === 'main' && (
          <>
        {/* ---------- Section 1: Default sort ---------- */}
        <section className="settings-section">
          <div className="settings-section__head">
            <span className="settings-section__label">
              {intl.formatMessage({ id: 'productSettings.section_default_sort' })}
            </span>
            <span className="settings-section__hint">
              {intl.formatMessage({ id: 'productSettings.sort_preference_hint' })}
            </span>
          </div>
          <div className="settings-radio-group" role="radiogroup">
            {SORT_OPTIONS.map((option) => {
              const selected = option.value === localSortPreference
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => handleSelectSort(option.value)}
                  className={`sort-sheet-row${selected ? ' sort-sheet-row--selected' : ''}`}
                  disabled={isSavingSettings && selected}
                >
                  <span className="sort-sheet-row__label">{sortLabels[option.value]}</span>
                  <span className="settings-radio-row__trail">
                    {selected && (
                      <>
                        <span className="settings-tag settings-tag--current">
                          {intl.formatMessage({ id: 'productSettings.tag_current' })}
                        </span>
                        <span className="sort-sheet-row__check" aria-hidden="true">
                          <Check style={{ width: 16, height: 16, strokeWidth: 2.5 }} />
                        </span>
                      </>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        {/* ---------- Section 2: Default category ---------- */}
        <section className="settings-section">
          <div className="settings-section__head">
            <span className="settings-section__label">
              {intl.formatMessage({ id: 'productSettings.section_default_category' })}
            </span>
            <span className="settings-section__hint">
              {intl.formatMessage({ id: 'productSettings.default_category_hint' })}
            </span>
          </div>
          <div className="settings-radio-group" role="radiogroup">
            <button
              type="button"
              role="radio"
              aria-checked={localDefaultCategoryId === null}
              onClick={() => handleSelectDefault(null)}
              className={`sort-sheet-row${localDefaultCategoryId === null ? ' sort-sheet-row--selected' : ''}`}
            >
              <span className="sort-sheet-row__label settings-default-row__none-label">
                {intl.formatMessage({ id: 'productSettings.default_category_none' })}
              </span>
              <span className="settings-radio-row__trail">
                {localDefaultCategoryId === null && (
                  <>
                    <span className="settings-tag settings-tag--current">
                      {intl.formatMessage({ id: 'productSettings.tag_current' })}
                    </span>
                    <span className="sort-sheet-row__check" aria-hidden="true">
                      <Check style={{ width: 16, height: 16, strokeWidth: 2.5 }} />
                    </span>
                  </>
                )}
              </span>
            </button>
            {categories.length === 0 ? (
              <p className="settings-default-row__empty">
                {intl.formatMessage({ id: 'productSettings.default_category_none_to_pick' })}
              </p>
            ) : (
              categories.map((c) => {
                const selected = c.id === localDefaultCategoryId
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => handleSelectDefault(c.id)}
                    className={`sort-sheet-row${selected ? ' sort-sheet-row--selected' : ''}`}
                  >
                    <span className="sort-sheet-row__label">{c.name}</span>
                    <span className="settings-radio-row__trail">
                      {selected && (
                        <>
                          <span className="settings-tag settings-tag--current">
                            {intl.formatMessage({ id: 'productSettings.tag_current' })}
                          </span>
                          <span className="sort-sheet-row__check" aria-hidden="true">
                            <Check style={{ width: 16, height: 16, strokeWidth: 2.5 }} />
                          </span>
                        </>
                      )}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </section>

        {/* ---------- Section 3: Categories entrypoint ---------- */}
        <section className="settings-section settings-section--categories">
          <div className="settings-section__head">
            <span className="settings-section__label">
              {intl.formatMessage({ id: 'productSettings.section_your_categories' })}
            </span>
            <span className="settings-section__count">
              {intl.formatMessage(
                { id: 'productSettings.categories_count' },
                { count: categories.length },
              )}
            </span>
          </div>

          {/* CTA into the dedicated manage step. Everything category-shaped
              (add, rename, reorder, delete) lives there so this surface
              stays focused on sort + default selection. */}
          <button
            type="button"
            className="settings-add-cta"
            onClick={() => setStep('manage')}
          >
            <span className="settings-add-cta__label">
              {intl.formatMessage({ id: 'productSettings.manage_categories_cta' })}
            </span>
            <span className="settings-add-cta__chev" aria-hidden="true">
              <ChevronRight style={{ width: 16, height: 16 }} />
            </span>
          </button>
        </section>
          </>
        )}

        {step === 'manage' && (
          <section className="settings-section settings-section--manage">
            {/* Add-new inline form */}
            <form
              className="settings-add-row"
              onSubmit={(e) => {
                e.preventDefault()
                handleCreateCategory()
              }}
            >
              <input
                ref={newCategoryInputRef}
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                className="settings-add-row__input"
                placeholder={intl.formatMessage({ id: 'productSettings.category_name_placeholder' })}
                autoComplete="off"
                maxLength={64}
              />
              <button
                type="submit"
                className="settings-add-row__button"
                disabled={isCreatingCategory}
              >
                {isCreatingCategory ? (
                  <IonSpinner name="crescent" style={{ width: 14, height: 14 }} />
                ) : (
                  <Plus style={{ width: 14, height: 14, strokeWidth: 2.5 }} />
                )}
                <span>{intl.formatMessage({ id: 'productSettings.add_category_button' })}</span>
              </button>
              {createCelebrating && (
                <span className="settings-add-row__ping" role="status">
                  <Check style={{ width: 12, height: 12, strokeWidth: 2.5 }} />
                  {intl.formatMessage({ id: 'productSettings.category_created' })}
                </span>
              )}
            </form>

            {/* List */}
            {categories.length === 0 ? (
              <div className="settings-empty">
                <span className="settings-empty__rule" aria-hidden="true" />
                <p className="settings-empty__title">
                  {intl.formatMessage({ id: 'productSettings.no_categories' })}
                </p>
                <p className="settings-empty__desc">
                  {intl.formatMessage({ id: 'productSettings.no_categories_hint' })}
                </p>
              </div>
            ) : (
              <CategoryList
                categories={categories}
                defaultCategoryId={localDefaultCategoryId}
                editingId={editingCategoryId}
                editingValue={editingValue}
                onEditingValueChange={setEditingValue}
                pendingDeleteId={pendingDeleteId}
                isCommittingEdit={isUpdatingCategory}
                isCommittingDelete={isDeletingCategory}
                onReorder={onReorderCategories}
                onStartEdit={handleStartEdit}
                onCancelEdit={handleCancelEdit}
                onSaveEdit={handleSaveEdit}
                onStartDelete={handleStartDelete}
                onCancelDelete={handleCancelDelete}
                onConfirmDelete={handleConfirmDelete}
              />
            )}
          </section>
        )}

        {/* Saving indicator stamp — quiet ledger feedback while a
            settings PATCH is in flight. */}
        {isSavingSettings && (
          <div className="settings-saving-stamp" role="status">
            <IonSpinner name="dots" style={{ width: 18, height: 12 }} />
            <span className="settings-saving-stamp__text">
              {intl.formatMessage({ id: 'productSettings.saving' })}
            </span>
          </div>
        )}
      </div>
    </ModalShell>
  )
}
