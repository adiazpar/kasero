// Skeleton list rows for surfaces whose loaded shape is a ledger of
// leading-visual + two-line rows (Hub business list, Products list,
// Team roster). Mirrors the report-skeleton vocabulary in sales-tab.css:
// cream blocks on the paper canvas with a slow opacity pulse (disabled
// under prefers-reduced-motion). Purely decorative — hidden from AT.
//
// For headline / chart-shaped placeholders keep using the surface-local
// skeletons (home-revenue__skeleton, report-skeleton, ...); this
// component only covers the list-row shape.

interface SkeletonListProps {
  /** Number of placeholder rows. Default 6. */
  rows?: number
  /** Leading visual shape. 'square' matches product/business icons,
   *  'circle' matches user avatars, 'none' drops it. Default 'square'. */
  leading?: 'square' | 'circle' | 'none'
  /** Optional className passthrough on the wrapping element. */
  className?: string
}

export function SkeletonList({
  rows = 6,
  leading = 'square',
  className,
}: SkeletonListProps) {
  const cls = ['skeleton-list', className].filter(Boolean).join(' ')
  return (
    <div className={cls} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-list__row">
          {leading !== 'none' && (
            <div
              className={`skeleton-list__leading skeleton-list__leading--${leading}`}
            />
          )}
          <div className="skeleton-list__lines">
            <div className="skeleton-list__line skeleton-list__line--primary" />
            <div className="skeleton-list__line skeleton-list__line--secondary" />
          </div>
        </div>
      ))}
    </div>
  )
}
