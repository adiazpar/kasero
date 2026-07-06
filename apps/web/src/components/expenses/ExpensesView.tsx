'use client'

import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import { Plus, Receipt } from 'lucide-react'

import { useBusiness } from '@/contexts/business-context'
import { useExpenses } from '@/contexts/expenses-context'
import { useExpenseCategories } from '@/contexts/expense-categories-context'
import { ExpenseTotalsStrip } from './ExpenseTotalsStrip'
import { ExpenseListItem } from './ExpenseListItem'
import { AddExpenseModal } from './AddExpenseModal'
import { ExpenseDetailModal } from './ExpenseDetailModal'
import type { Expense } from '@kasero/shared/types'

// Main content for the Expenses sub-tab.
//   - Header: ExpenseTotalsStrip
//   - Empty state when no expenses and not loading
//   - List of ExpenseListItem rows
//   - Add-expense FAB (bottom-right)
export function ExpensesView() {
  const t = useIntl()
  const { business } = useBusiness()
  const businessId = business?.id ?? ''

  const { expenses, isLoading, ensureLoaded } = useExpenses()
  const { ensureLoaded: ensureCategories } = useExpenseCategories()

  const [addOpen, setAddOpen] = useState(false)
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null)

  useEffect(() => {
    if (!businessId) return
    void ensureLoaded()
    void ensureCategories()
  }, [businessId, ensureLoaded, ensureCategories])

  if (!businessId) return null

  const handleTap = (expense: Expense) => {
    setSelectedExpense(expense)
  }

  const handleAdd = () => {
    setAddOpen(true)
  }

  const showEmptyState = !isLoading && expenses.length === 0

  return (
    <div className="expenses-view">
      <ExpenseTotalsStrip businessId={businessId} />

      {showEmptyState ? (
        <div className="expenses-empty">
          <Receipt className="expenses-empty__icon" size={32} strokeWidth={1.5} />
          <p className="expenses-empty__title">
            {t.formatMessage({ id: 'expenses.empty_title' })}
          </p>
          <p className="expenses-empty__desc">
            {t.formatMessage({ id: 'expenses.empty_body' })}
          </p>
          <button
            type="button"
            className="expenses-empty__cta"
            onClick={handleAdd}
          >
            <Plus size={16} strokeWidth={2} aria-hidden="true" />
            {t.formatMessage({ id: 'expenses.add_button' })}
          </button>
        </div>
      ) : (
        <div className="expenses-list-card stagger-children">
          {expenses.map((expense) => (
            <ExpenseListItem
              key={expense.id}
              expense={expense}
              onTap={handleTap}
            />
          ))}
        </div>
      )}

      {/* Floating add button — positioned bottom-right via CSS. Only
          shown when there are existing expenses so the empty-state CTA
          is the primary affordance on a fresh business. */}
      {!showEmptyState && (
        <button
          type="button"
          className="expenses-fab"
          onClick={handleAdd}
          aria-label={t.formatMessage({ id: 'expenses.add_button' })}
        >
          <Plus size={20} strokeWidth={2.5} />
        </button>
      )}

      <AddExpenseModal
        isOpen={addOpen}
        onClose={() => setAddOpen(false)}
        onExitComplete={() => setAddOpen(false)}
      />

      <ExpenseDetailModal
        isOpen={selectedExpense !== null}
        expense={selectedExpense}
        onClose={() => setSelectedExpense(null)}
        onExitComplete={() => setSelectedExpense(null)}
      />
    </div>
  )
}
