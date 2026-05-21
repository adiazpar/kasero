import { z } from 'zod'

export const postExpenseSchema = z.object({
  amount: z.number().positive().max(10_000_000).refine((n) => Number.isFinite(n), {
    params: { apiMessageCode: 'EXPENSE_INVALID_AMOUNT' },
  }),
  date: z.string().datetime().optional(),
  categoryId: z.string().min(1).optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
  photoUrl: z.string().url().max(2048).optional().nullable(),
})

export const patchExpenseSchema = postExpenseSchema.partial()

export type PostExpenseBody = z.infer<typeof postExpenseSchema>
export type PatchExpenseBody = z.infer<typeof patchExpenseSchema>
