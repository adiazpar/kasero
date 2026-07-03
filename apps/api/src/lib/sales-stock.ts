import { db, products } from '@/db'
import { and, eq, inArray, sql } from 'drizzle-orm'

// The transaction handle drizzle hands to the `db.transaction` callback.
// Derived from `db` so it tracks the exact driver type without importing
// deep drizzle internals.
type StockTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Apply signed stock deltas to a set of products in ONE UPDATE, via a CASE
 * keyed on product id — on the libSQL HTTP driver each statement is a
 * network round trip, so a per-line loop would fan out to N sequential
 * UPDATEs.
 *
 * `deltas` maps productId -> signed change: NEGATIVE decrements (a sale
 * create consumes stock), POSITIVE increments (a void restores it). The
 * SAME builder serves both routes; only the sign of the values differs.
 *
 * Callers MUST pre-aggregate quantity per product before calling — a sale
 * (or void) that carries the same product across multiple lines must be
 * applied as the SUMMED delta. A per-line map would overwrite instead of
 * accumulate and drive stock wrong (create: negative; void: under-restore).
 *
 * An empty map is a no-op (e.g. a voided sale whose every line lost its
 * product to a later delete). `tx` is the surrounding transaction so the
 * stock mutation commits atomically with the sale insert / status flip.
 */
export async function applyStockDeltas(
  tx: StockTx,
  businessId: string,
  deltas: Map<string, number>,
): Promise<void> {
  if (deltas.size === 0) return

  const cases = sql.join(
    Array.from(deltas, ([productId, delta]) => sql`WHEN ${productId} THEN ${delta}`),
    sql` `,
  )

  await tx
    .update(products)
    .set({ stock: sql`${products.stock} + CASE ${products.id} ${cases} END` })
    .where(
      and(
        eq(products.businessId, businessId),
        inArray(products.id, Array.from(deltas.keys())),
      ),
    )
}
