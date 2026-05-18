'use client'

import { useIntl } from 'react-intl';
import { Link } from 'react-router-dom'
import { useCallback } from 'react'
import { usePathname } from '@/lib/next-navigation-shim'
import { useAuth } from '@/contexts/auth-context'
import { useAuthGate } from '@/contexts/auth-gate-context'
import { usePageTransition } from '@/contexts/page-transition-context'
import { useIncomingTransferContext } from '@/contexts/incoming-transfer-context'
import { getUserInitials } from '@kasero/shared/auth'
import { ChevronRight, Settings, CircleHelp, LogOut } from 'lucide-react'

interface UserMenuContentProps {
  onAction?: () => void
  showHeader?: boolean
}

/**
 * User menu content - user-level quick actions.
 * Language and theme preferences now live on the account settings page.
 */
export function UserMenuContent({ onAction, showHeader = true }: UserMenuContentProps) {
  const t = useIntl()
  const { user } = useAuth()
  const { requestLogout } = useAuthGate()
  const { navigate } = usePageTransition()
  const { transfer: incomingTransfer } = useIncomingTransferContext()

  const handleLogout = useCallback(() => {
    onAction?.()
    requestLogout('/')
  }, [requestLogout, onAction])

  const pathname = usePathname()

  const handleLinkClick = useCallback((e: React.MouseEvent, href: string) => {
    // Modifier clicks pass through to default anchor behavior.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    if (e.button !== 0) return
    e.preventDefault()
    if (href === pathname) {
      onAction?.()
      return
    }
    navigate(href)
    onAction?.()
  }, [navigate, onAction, pathname])

  if (!user) return null

  return (
    <div className="user-menu-content">
      {/* User Info Header */}
      {showHeader && (
        <div className="user-menu-header">
          <div className="user-menu-avatar">
            {user.avatar ? (
              // Avatar is a small base64 data URL — Next/Image with its width/
              // height requirements adds no benefit over a plain <img> here.
              (<img
                src={user.avatar}
                alt={user.name}
                className="user-menu-avatar-img"
              />)
            ) : (
              getUserInitials(user.name)
            )}
          </div>
          <div className="user-menu-info">
            <div className="user-menu-name">{user.name}</div>
            <div className="user-menu-email">{user.email}</div>
          </div>
        </div>
      )}
      {/* Menu Items */}
      <div className="user-menu-items">
        <Link
          to="/account"
          className="user-menu-item"
          onClick={(e) => {
            // Modifier clicks pass through to default anchor behavior.
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
            if (e.button !== 0) return
            e.preventDefault()
            if (pathname === '/account') {
              onAction?.()
              return
            }
            navigate('/account')
            onAction?.()
          }}
        >
          <Settings />
          <span>{t.formatMessage({
            id: 'ui.user_menu.account_settings'
          })}</span>
          <span className="user-menu-item-trailing">
            {incomingTransfer && (
              <span
                className="w-2.5 h-2.5 rounded-full bg-warning badge-pop-in flex-shrink-0"
                aria-hidden="true"
              />
            )}
            <ChevronRight className="user-menu-item-arrow" />
          </span>
        </Link>

        <Link
          to="/support"
          className="user-menu-item"
          onClick={(e) => handleLinkClick(e, '/support')}
        >
          <CircleHelp />
          <span>{t.formatMessage({
            id: 'ui.user_menu.support'
          })}</span>
          <ChevronRight className="user-menu-item-arrow" />
        </Link>

        <button
          type="button"
          className="user-menu-item user-menu-item-danger"
          onClick={handleLogout}
        >
          <LogOut />
          <span>{t.formatMessage({
            id: 'ui.user_menu.log_out'
          })}</span>
        </button>
      </div>
    </div>
  );
}
