# P0-1 POS rows plan (2026-05-20)

- Replace 2-col `.product-grid` with single-column flex stack (gap var(--space-2)).
- Re-style `.product-tile` to a horizontal row: flex row, align-items center, gap space-3, padding space-3 space-4, radius-xl, surface bg, hair border, width 100%.
- Drop column stacking inside tile: remove `.product-tile__head`'s column behavior — that wrapper already row-aligns icon+name; keep it as the center cluster (icon + name/price block, flex-1).
- Right side: a single trailing slot.
  - Idle non-sold-out: render mono caps `+ ADD` in `var(--color-brand)`.
  - Active (qty>0): render the existing `[− n +]` stepper, right-anchored, gap space-2.
  - Sold out: render the existing SOLD OUT stamp on the right (replaces ADD).
- Selected tile keeps brand border + brand-subtle bg (existing `--product-tile--selected`).
- Whole row remains role=button; tap → addLine (idle) or remains active. Stepper buttons stopPropagation.
- New i18n key `sales.product.add_short` = `+ Add` (en), `+ Añadir` (es), `+ 追加` (ja).
- Regenerate messageIds with `npm run i18n:types --workspace=apps/web`.
- Verify with Playwright: idle screenshot, click, active screenshot.
