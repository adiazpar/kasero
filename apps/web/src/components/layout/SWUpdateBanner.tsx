'use client'

import { useIntl } from 'react-intl'

// Non-blocking banner that appears when a new service worker is waiting.
// Mirrors the OfflineBadge pattern: fixed-position, full-width, slim.
//
// Placement: bottom of screen so it doesn't cover the Ionic status bar
// or the top safe-area. z-[160] keeps it above the layer stack.
//
// Dismiss: the X button hides the banner for the remainder of the
// session without reloading. The "Reload" CTA calls `updateSW(true)`
// which triggers skipWaiting + window.location.reload().

interface SWUpdateBannerProps {
  onReload: () => void
  onDismiss: () => void
}

export function SWUpdateBanner({ onReload, onDismiss }: SWUpdateBannerProps) {
  const t = useIntl()

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-0 inset-x-0 z-[160] flex items-center justify-between gap-3 px-4 py-2.5 bg-neutral-800 text-text-inverse shadow-lg"
    >
      <span className="text-xs">
        {t.formatMessage({ id: 'network.sw_update_available' })}
      </span>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onReload}
          className="text-xs font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          {t.formatMessage({ id: 'network.sw_update_reload' })}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="text-text-inverse opacity-60 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  )
}
