import { z } from 'zod'

export const patchSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  locale: z.string().optional(),
  removeLogo: z.literal('true').optional(),
})
