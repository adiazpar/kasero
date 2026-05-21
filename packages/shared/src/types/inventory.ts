import type { InferSelectModel } from 'drizzle-orm'
import type { inventoryAdjustments } from '../db/schema'

export type InventoryAdjustment = InferSelectModel<typeof inventoryAdjustments>
