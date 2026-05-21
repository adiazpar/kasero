import { z } from 'zod'

export const postInventoryAdjustmentSchema = z.object({
  productId: z.string().min(1),
  delta: z.number().int().refine((d) => d !== 0, {
    params: { apiMessageCode: 'INVENTORY_ADJUSTMENT_INVALID_DELTA' },
  }),
  reason: z.string().max(500).optional().nullable(),
  expense: z
    .object({
      amount: z.number().positive().max(10_000_000),
      categoryId: z.string().min(1).optional().nullable(),
    })
    .optional(),
})

export type PostInventoryAdjustmentBody = z.infer<typeof postInventoryAdjustmentSchema>
