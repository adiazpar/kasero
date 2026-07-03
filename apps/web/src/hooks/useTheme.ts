'use client'

import { useIntl } from 'react-intl';
import { useEffect, useCallback, useSyncExternalStore } from 'react'
import { applyThemeColorMeta } from '@/lib/theme-color'
import { syncNativeStatusBar } from '@/lib/native/status-bar'

export type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'theme'

// ---------------------------------------------------------------------------
// Shared module-level store so every useTheme() instance sees the same value.
// ---------------------------------------------------------------------------
type Listener = () => void
const listeners = new Set<Listener>()
let currentTheme: Theme = 'system'

function readFromStorage(): Theme {
  if (typeof window === 'undefined') return 'system'
  const saved = localStorage.getItem(STORAGE_KEY) as Theme | null
  return saved ?? 'system'
}

// Hydrate once when the module loads (client-side).
if (typeof window !== 'undefined') {
  currentTheme = readFromStorage()
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): Theme {
  return currentTheme
}

function getServerSnapshot(): Theme {
  return 'system'
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  let resolved: 'light' | 'dark'
  if (theme === 'system') {
    resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    localStorage.removeItem(STORAGE_KEY)
  } else {
    resolved = theme
    localStorage.setItem(STORAGE_KEY, theme)
  }
  root.classList.toggle('dark', resolved === 'dark')
  applyThemeColorMeta(resolved)
  // Native (Capacitor) status bar follows the theme. No-op on web — the
  // meta theme-color mechanism above stays the web path.
  void syncNativeStatusBar(resolved)
}

/**
 * Detect iOS Safari running in standalone (added-to-home-screen) PWA mode.
 * In that mode, the status-bar / dynamic-island region is tinted from the
 * BODY background, NOT from the `<meta name="theme-color">` tag — and iOS
 * only reads the body background on cold launch. Mutating CSS variables,
 * swapping the meta element, or even toggling the body bg at runtime does
 * not propagate to the system bar until the app is relaunched.
 *
 * Sources documenting this (researched 2026-05):
 *   - https://benfrain.com/ios26-safari-theme-color-tab-tinting-with-fixed-position-elements/
 *   - https://medium.com/@otterlord/custom-ios-status-bar-for-pwas-e62b9c473ae9
 *   - https://intercom.help/progressier/en/articles/10574799-complete-guide-to-customizing-the-mobile-status-bar-in-a-website-or-pwa
 *
 * The practical fix is to soft-reload when the user manually picks a theme
 * inside standalone PWA. The inline <head> script in index.html runs again
 * on the fresh document, sets the right `theme-color` and `.dark` class,
 * and iOS reads the new body background as a new launch — status bar
 * updates instantly. Browser-tab and Android Chrome users skip the reload
 * because the meta-tag swap already works for them.
 */
function isIosStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false
  // iOS-specific Safari API. `display-mode: standalone` covers Android +
  // desktop installs too — the iOS-specific `navigator.standalone` is the
  // narrowest predicate for the bug we're working around.
  const nav = window.navigator as Navigator & { standalone?: boolean }
  if (nav.standalone === true) return true
  return window.matchMedia?.('(display-mode: standalone)').matches === true
}

// ---------------------------------------------------------------------------

interface UseThemeReturn {
  theme: Theme
  setTheme: (theme: Theme) => void
  themeDescription: string
}

export function useTheme(): UseThemeReturn {
  const t = useIntl()
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const setTheme = useCallback((next: Theme) => {
    if (next === currentTheme) return
    currentTheme = next
    applyTheme(next)
    listeners.forEach((l) => l())

    // iOS standalone PWA: the status-bar tint is cached until cold launch.
    // Soft-reload after the click animation has played so the inline <head>
    // script runs again on the fresh document and the status-bar /
    // dynamic-island region picks up the new theme. Skip 'system' picks —
    // those follow the OS-level toggle and would feel jarring if every
    // sunset auto-flip caused a reload.
    if ((next === 'light' || next === 'dark') && isIosStandalonePwa()) {
      window.setTimeout(() => window.location.reload(), 320)
    }
  }, [])

  // In 'system' mode, follow OS-level color scheme changes live.
  useEffect(() => {
    if (theme !== 'system') return

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (event: MediaQueryListEvent) => {
      document.documentElement.classList.toggle('dark', event.matches)
      applyThemeColorMeta(event.matches ? 'dark' : 'light')
      void syncNativeStatusBar(event.matches ? 'dark' : 'light')
    }

    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [theme])

  return {
    theme,
    setTheme,
    themeDescription: t.formatMessage({
      id: `account.theme_description_${theme}`
    }),
  };
}
