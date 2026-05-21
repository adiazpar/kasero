import type { InferSelectModel } from 'drizzle-orm'
import type { expenses, expenseCategories } from '../db/schema'

export type Expense = InferSelectModel<typeof expenses>
export type ExpenseCategory = InferSelectModel<typeof expenseCategories>

export interface ExpenseSummary {
  month: string          // ISO yyyy-mm-dd of first day of the month
  totalIncome: number    // sum of sales for the month, business currency
  totalExpenses: number  // sum of expenses for the month, business currency
  net: number            // income - expenses
}
