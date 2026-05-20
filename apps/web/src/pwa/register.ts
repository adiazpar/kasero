import { registerSW } from 'virtual:pwa-register'

/**
 * Register the service worker with an update-prompt callback.
 *
 * Returns the `updateSW` function — call it when the user confirms
 * they want to reload into the new version. Calling `updateSW(true)`
 * triggers skipWaiting on the waiting SW and reloads the page.
 *
 * `onNeedRefresh` fires once a waiting SW has been detected. Wire it
 * to whatever UI affordance surfaces the "reload" prompt.
 */
export function registerServiceWorkerWithUpdatePrompt(
  onNeedRefresh: () => void,
): () => Promise<void> {
  return registerSW({
    immediate: true,
    onNeedRefresh,
    onOfflineReady() {
      // No-op: the app is already cached for offline use by the
      // precache manifest — we don't need a separate "ready offline"
      // toast for that. Only the update prompt needs a UI affordance.
    },
    onRegisterError(error) {
      console.warn('[pwa] SW registration failed:', error)
    },
  })
}
