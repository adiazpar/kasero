import { z } from 'zod'

const itemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive().max(1000),
})

export const postSaleSchema = z.object({
  date: z.string().datetime().optional(),
  paymentMethod: z.enum(['cash', 'card', 'other']),
  notes: z.string().max(1000).optional(),
  // Cart-level discount as an absolute amount. The "discount cannot exceed
  // the subtotal" invariant is enforced in the handler (the server-computed
  // subtotal is not known at parse time) — see SALE_DISCOUNT_EXCEEDS_SUBTOTAL.
  discountAmount: z.number().min(0).max(1_000_000_000).optional(),
  items: z.array(itemSchema).min(1).max(100),
})

export type PostSaleBody = z.infer<typeof postSaleSchema>
