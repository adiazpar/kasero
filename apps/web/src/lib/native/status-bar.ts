/**
 * Native status-bar styling. Follows the app theme: dark theme gets
 * light status-bar text (Style.Dark = dark background), light theme gets
 * dark text. No-op on web — the web keeps the <meta name="theme-color">
 * mechanism in lib/theme-color.ts untouched.
 *
 * The @capacitor/status-bar import is dynamic so the plugin never lands
 * in the web bundle's critical path.
 */

import { Capacitor } from '@capacitor/core'

export async function syncNativeStatusBar(resolved: 'light' | 'dark'): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setStyle({
      style: resolved === 'dark' ? Style.Dark : Style.Light,
    })
  } catch {
    // Plugin not installed on this platform build — styling is cosmetic,
    // never block on it.
  }
}
