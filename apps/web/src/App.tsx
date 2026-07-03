import { useEffect, useState } from 'react'
import { IonApp } from '@ionic/react'
import { IonReactRouter } from '@ionic/react-router'
import { Route, Switch } from 'react-router-dom'

import dynamic from '@/lib/next-dynamic-shim'
import { ErrorBoundary } from '@/components/layout/error-boundary'
import { HapticFeedbackProvider } from '@/components/layout/haptic-feedback-provider'
import { OfflineBadge } from '@/components/layout/OfflineBadge'
import { SWUpdateBanner } from '@/components/layout/SWUpdateBanner'
import { AuthGateProvider } from '@/contexts/auth-gate-context'
import { AuthProvider } from '@/contexts/auth-context'
import { RealtimeProvider } from '@/contexts/realtime-context'
import { AppIntlProvider } from '@/i18n/AppIntlProvider'
import { AuthWizardPage } from '@/routes/AuthWizardPage'

// AuthWizardPage stays eager: it is the first-paint route for logged-out
// users, and a lazy boundary there would flash a blank frame on cold
// start. Everything behind authentication is lazy so the logged-out
// entry path never downloads business-app code.
const AuthenticatedShell = dynamic(
  () => import('@/routes/AuthenticatedShell').then((m) => m.AuthenticatedShell),
  { ssr: false },
)

// AuthGateOverlay is the only always-mounted consumer of framer-motion.
// Lazy-loading it moves framer-motion out of the entry chunk, but the
// fetch must start at module-eval time (not first render): on an OAuth
// return the auth-gate entry animation begins immediately on cold start,
// and a render-triggered fetch can lose that race on slow connections,
// flashing the authenticated UI unmasked before the overlay chunk lands.
const authGateOverlayImport = import('@/components/layout/auth-gate-overlay')
const AuthGateOverlay = dynamic(
  () => authGateOverlayImport.then((m) => m.AuthGateOverlay),
  { ssr: false },
)

// Provider order:
//   - IonReactRouter wraps everything: AuthContext calls useRouter() (via the
//     next-navigation-shim) at module init.
//   - AppIntlProvider sits ABOVE AuthProvider because AuthProvider calls
//     useIntl()/useApiMessage() at render time. AppIntlProvider doesn't
//     depend on auth — it reads the locale from user-cache and listens for
//     LANGUAGE_CHANGE_EVENT.
//   - AuthGateOverlay is a sibling of the route surface (NOT a route) so it
//     survives route changes. Fixed-positioned at z-index --z-auth-gate.
//   - HapticFeedbackProvider mounts a single document-level click listener
//     that fires haptic() on a narrow allow-list: ion-tab-button,
//     ion-back-button, ion-menu-button, and any element marked
//     [data-haptic]. Renders no DOM.
export function App() {
  const [showUpdateBanner, setShowUpdateBanner] = useState(
    () => typeof window !== 'undefined' && !!window.__swUpdateReady,
  )

  // Listen for the sw-update-ready event dispatched from main.tsx when
  // vite-plugin-pwa detects a waiting service worker.
  useEffect(() => {
    const handler = () => setShowUpdateBanner(true)
    window.addEventListener('sw-update-ready', handler)
    return () => window.removeEventListener('sw-update-ready', handler)
  }, [])

  function handleReload() {
    void window.__swUpdateFn?.()
  }

  function handleDismiss() {
    setShowUpdateBanner(false)
  }

  return (
    <IonApp>
      <ErrorBoundary>
        <IonReactRouter>
          <AppIntlProvider>
            <AuthProvider>
              <AuthGateProvider>
                <RealtimeProvider>
                  <HapticFeedbackProvider />
                  <AuthGateOverlay />
                  <OfflineBadge />
                  {showUpdateBanner && (
                    <SWUpdateBanner onReload={handleReload} onDismiss={handleDismiss} />
                  )}
                  <Switch>
                    <Route exact path="/auth">
                      <AuthWizardPage />
                    </Route>
                    <Route>
                      <AuthenticatedShell />
                    </Route>
                  </Switch>
                </RealtimeProvider>
              </AuthGateProvider>
            </AuthProvider>
          </AppIntlProvider>
        </IonReactRouter>
      </ErrorBoundary>
    </IonApp>
  )
}
