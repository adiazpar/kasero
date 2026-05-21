'use client'

import { useBusinessFormat } from '@/hooks/useBusinessFormat'
import { useExpenseCategories } from '@/contexts/expense-categories-context'
import type { Expense } from '@kasero/shared/types'

interface ExpenseListItemProps {
  expense: Expense
  onTap: (expense: Expense) => void
}

// Single expense row. Shows:
//   - Amount (with leading minus sign, formatted in business currency)
//   - Category chip (looked up from context by categoryId)
//   - Date
//   - Note preview (if present)
//   - Photo thumbnail (if photoUrl is set)
export function ExpenseListItem({ expense, onTap }: ExpenseListItemProps) {
  const { formatCurrency, formatDate } = useBusinessFormat()
  const { categories } = useExpenseCategories()

  const category = expense.categoryId
    ? categories.find((c) => c.id === expense.categoryId)
    : null

  const displayDate = formatDate(new Date(expense.date))
  const displayAmount = `-${formatCurrency(expense.amount)}`

  return (
    <button
      type="button"
      className="expense-row"
      onClick={() => onTap(expense)}
    >
      <div className="expense-row__body">
        <div className="expense-row__top">
          {category && (
            <span className="expense-row__category-chip">{category.name}</span>
          )}
          <span className="expense-row__date">{displayDate}</span>
        </div>
        {expense.note && (
          <p className="expense-row__note">{expense.note}</p>
        )}
      </div>
      <div className="expense-row__trail">
        {expense.photoUrl && (
          <img
            src={expense.photoUrl}
            alt=""
            className="expense-row__photo"
            aria-hidden="true"
          />
        )}
        <span className="expense-row__amount">{displayAmount}</span>
      </div>
    </button>
  )
}
