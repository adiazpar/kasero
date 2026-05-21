'use client'

import { useIntl } from 'react-intl'
import { Check, Plus } from 'lucide-react'
import { useExpenseCategories } from '@/contexts/expense-categories-context'

interface ExpenseCategoryPickerProps {
  value: string | null
  onChange: (categoryId: string | null) => void
  onRequestAdd: () => void
}

/**
 * Category picker for the expense modals. Renders a radio-row list of
 * expense categories from context, plus an "Add new category" sentinel at
 * the bottom. Matches the `.sort-sheet-row` vocabulary used by the product
 * category picker (CategoryStockStep) so the visual language stays consistent.
 *
 * - `value` is the selected category id, or null for "no category".
 * - `onChange` fires with the new id (or null) when a row is tapped.
 * - `onRequestAdd` fires when the sentinel row is tapped; the parent is
 *   responsible for opening the add-category sub-modal.
 */
export function ExpenseCategoryPicker({
  value,
  onChange,
  onRequestAdd,
}: ExpenseCategoryPickerProps) {
  const t = useIntl()
  const { categories } = useExpenseCategories()

  const sorted = [...categories].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
    return a.name.localeCompare(b.name)
  })

  return (
    <div className="expense-category-picker">
      {/* "None" option */}
      <button
        type="button"
        className={`sort-sheet-row${value === null ? ' sort-sheet-row--selected' : ''}`}
        onClick={() => onChange(null)}
      >
        <span className="sort-sheet-row__label">
          {t.formatMessage({ id: 'expense_modal.category_placeholder' })}
        </span>
        {value === null && (
          <span className="sort-sheet-row__check" aria-hidden="true">
            <Check size={18} strokeWidth={2.4} />
          </span>
        )}
      </button>

      {sorted.map((cat) => {
        const selected = cat.id === value
        return (
          <button
            key={cat.id}
            type="button"
            className={`sort-sheet-row${selected ? ' sort-sheet-row--selected' : ''}`}
            onClick={() => onChange(cat.id)}
          >
            <span className="sort-sheet-row__label">{cat.name}</span>
            {selected && (
              <span className="sort-sheet-row__check" aria-hidden="true">
                <Check size={18} strokeWidth={2.4} />
              </span>
            )}
          </button>
        )
      })}

      {/* Sentinel: open add-category modal */}
      <button
        type="button"
        className="sort-sheet-row expense-category-picker__add-row"
        onClick={onRequestAdd}
      >
        <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
        <span className="sort-sheet-row__label">
          {t.formatMessage({ id: 'expense_modal.category_add_new' })}
        </span>
      </button>
    </div>
  )
}
