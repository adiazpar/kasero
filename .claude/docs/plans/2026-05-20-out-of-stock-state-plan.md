# OUT OF STOCK 4th state (P0-3 follow-up)

## Goal

Add a 4th stock-chip state to the products list: **OUT OF STOCK** (saffron, `var(--color-warning)`) shown when `stock === 0` AND the product has had at least one sale. The existing **READY · SET STOCK** (tertiary mono) is reserved for brand-new, never-sold products at zero — so creation never looks like an error, but a depleted SKU does signal action.

## Final 4-state matrix

| Condition | State token | Label key | Tint |
|---|---|---|---|
| `stock == null` | `untracked` | `products.stock_untracked` | tertiary (muted) |
| `stock > 0` (and not low) | `in-stock` | `products.stock_in_stock` | moss `--color-success` |
| `stock > 0 && <= lowStockThreshold` | `low` | `products.stock_low` | saffron `--color-warning` |
| `stock === 0 && hasSold` | `out-of-stock` | `products.stock_out_of_stock` | saffron `--color-warning` |
| `stock === 0 && !hasSold` | `ready` | `products.stock_ready` | tertiary (muted) |

## Backend — Option A (aggregate, no new column)

File: `apps/api/src/app/api/businesses/[businessId]/products/route.ts`.

The current `GET` does `db.select().from(products).where(...)`. We replace that with a LEFT JOIN against `sale_items` aggregating a per-product sold-count, then map each row to `{ ...product, hasSold: count > 0 }`.

```ts
const rows = await db
  .select({
    product: products,
    soldCount: sql<number>`COUNT(${saleItems.id})`.as('sold_count'),
  })
  .from(products)
  .leftJoin(saleItems, eq(saleItems.productId, products.id))
  .where(and(...conditions))
  .groupBy(products.id)
  .limit(500)

const productsList = rows.map(r => ({ ...r.product, hasSold: Number(r.soldCount) > 0 }))
```

Indexes are already in place (`idx_sale_items_product_id` on `sale_items.productId`) so this stays cheap for small-business catalogs (cap 500). No new DB column, no maintenance on sale-confirm — single source of truth = `sale_items` rows.

Why not Option B (denormalized boolean): an extra column means another invariant to keep in sync on every sale confirm AND on every sale delete/refund — easy to drift. Not justified for a list view that already caps at 500 products.

## Shared type

`packages/shared/src/types/index.ts` — add to `Product`:

```ts
/** Derived at read time on the products list route. True when ≥1 sale_items
 *  row references this product. Used by the Products list to distinguish
 *  "brand new, awaiting initial stock" (READY) from "depleted SKU that has
 *  sold before" (OUT OF STOCK). Optional because other routes that return a
 *  Product (single GET, PATCH response, etc.) don't compute it. */
hasSold?: boolean
```

## Frontend

File: `apps/web/src/components/products/ProductsTab.tsx`. Replace the existing 3-state derivation with the 4-state matrix above. `out-of-stock` and `low` both reuse the saffron tint, so the CSS adds one selector.

File: `apps/web/src/styles/products-tab.css` — add `[data-state="out-of-stock"]` selector mirroring `[data-state="low"]` (saffron). Update the leading comment to describe the 4-state model.

## i18n

Add `products.stock_out_of_stock` → `Out of stock` to `en-US.json` first, then the real translation to all 10 other locales (de, es, fil, fr, it, ja, ko, pt, vi, zh). Run `npm run i18n:types --workspace=apps/web` to refresh `messageIds.d.ts`.

## Verification

- `npx tsc --noEmit` from `apps/web`
- `npx tsc --noEmit` from `apps/api`
