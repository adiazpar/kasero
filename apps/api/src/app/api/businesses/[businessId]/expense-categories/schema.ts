import { z } from 'zod'

export const postExpenseCategorySchema = z.object({
  name: z.string().min(1).max(100).refine((s) => s.trim().length > 0, {
    params: { apiMessageCode: 'EXPENSE_CATEGORY_NAME_REQUIRED' },
  }),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
})

export const patchExpenseCategorySchema = postExpenseCategorySchema.partial()

export type PostExpenseCategoryBody = z.infer<typeof postExpenseCategorySchema>
export type PatchExpenseCategoryBody = z.infer<typeof patchExpenseCategorySchema>
