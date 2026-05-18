import type { ReactNode } from 'react'

// Shared body shell for the / (EntryPage) and /auth wizard steps.
// Renders a vertically-stacked main slot (hero + form) and an optional
// footer slot pinned to the bottom.
//
// `center` opts the main block into vertical centering and drops the
// absent-toolbar top inset (login uses this; the wizard steps don't, so
// their content sits at the same vertical anchor as the rest of the
// app's headered pages).
//
// The auth-* classes live in apps/web/src/styles/auth.css.
interface AuthLayoutProps {
  children: ReactNode
  footer?: ReactNode
  center?: boolean
}

export function AuthLayout({ children, footer, center = false }: AuthLayoutProps) {
  const containerClass = center
    ? 'auth-container auth-container--center'
    : 'auth-container'
  return (
    <div className={containerClass}>
      <div className="auth-main">{children}</div>
      {footer ? <div className="auth-footer">{footer}</div> : null}
    </div>
  )
}
