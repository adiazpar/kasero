import { z } from 'zod'

export const patchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  locale: z.string().optional(),
  removeLogo: z.literal('true').optional(),
  // Tax settings arrive as FormData strings; coerce the rate. A percent —
  // 0..100 covers every real-world sales tax / VAT rate.
  taxRate: z.coerce.number().min(0).max(100).optional(),
  taxMode: z.enum(['none', 'inclusive', 'exclusive']).optional(),
})
