import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'

// Order matters:
// 1. Ionic core CSS (resets, structure, typography utilities) FIRST so the
//    brand layer can override Ionic defaults via --ion-* variables.
import '@ionic/react/css/core.css'
import '@ionic/react/css/normalize.css'
import '@ionic/react/css/structure.css'
import '@ionic/react/css/typography.css'
import '@ionic/react/css/padding.css'
import '@ionic/react/css/float-elements.css'
import '@ionic/react/css/text-alignment.css'
import '@ionic/react/css/text-transformation.css'
import '@ionic/react/css/flex-utils.css'
import '@ionic/react/css/display.css'

// 2. Brand design tokens. Defines --color-*, --brand-*, --space-*, etc.
import './styles/base.css'

// 3. Ionic theme bridge — maps brand tokens to --ion-* CSS variables.
//    Must come AFTER base.css (which defines the brand tokens being read)
//    and AFTER Ionic core CSS (so these mappings override Ionic's defaults).
import './styles/ionic-theme.css'

// 4. Component-level brand CSS, layered on top of the brand tokens.
import './styles/forms.css'
import './styles/interactive.css'
import './styles/animations.css'
import './styles/swipe-row.css'
import './styles/auth-gate.css'
import './styles/auth.css'
import './styles/app.css'
import './styles/account-modals.css'
import './styles/hub-modals.css'
import './styles/manage-modals.css'
import './styles/sales-tab.css'
import './styles/sales-modal-open.css'
import './styles/sales-modal-close.css'
import './styles/sales-modal-history.css'
import './styles/sales-modal-cart.css'
import './styles/home-tab.css'
import './styles/price-keypad.css'
import './styles/products-tab.css'
import './styles/products-modal-add-edit.css'
import './styles/products-modal-settings.css'
import './styles/products-modal-orders.css'
import './styles/products-modal-info.css'
import './styles/team-roster.css'
import './styles/team-invite-modal.css'
import './styles/team-member-modal.css'
import './styles/providers-modal.css'
import './styles/providers-detail.css'
import './styles/utilities.css'

// 5. Tailwind utilities last so utility classes can override component CSS.
import './styles/index.css'

import { setupIonicReact } from '@ionic/react'

// iOS-style chrome on every platform for UX consistency.
// `swipeBackEnabled: false` disables Ionic's swipe-to-go-back gesture
// app-wide; navigation is via IonBackButton instead.
setupIonicReact({ mode: 'ios', swipeBackEnabled: false })

const root = ReactDOM.createRoot(document.getElementById('root')!)
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// PWA service worker handling.
// - Prod builds: register the Workbox SW that vite-plugin-pwa emits.
//   `registerServiceWorkerWithUpdatePrompt` is called with a callback that
//   sets a flag on window so the App shell can surface the update banner.
//   The returned `updateSW` function is stashed on window so the banner
//   can call it without needing a React prop chain or context.
// - Dev: actively unregister any SW from a prior production-preview session.
//   `vite-plugin-pwa`'s `devOptions.enabled = false` only prevents registering
//   a NEW SW in dev — it doesn't unregister one that's already installed.
//   iOS Safari preserves service workers across "Clear History and Website
//   Data" in many cases, so a stale SW will keep serving a cached app shell
//   whose hashed JS bundles 404 against the dev server, presenting as a
//   blank page with no traffic visible at Vite. Active unregistration here
//   recovers without manual per-device cleanup.
if ('serviceWorker' in navigator) {
  if (import.meta.env.DEV) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      if (regs.length === 0) return
      Promise.all(regs.map((r) => r.unregister())).then(() => {
        console.warn('[pwa] Unregistered stale service worker; reloading.')
        window.location.reload()
      })
    })
  } else {
    import('./pwa/register').then(({ registerServiceWorkerWithUpdatePrompt }) => {
      const updateSW = registerServiceWorkerWithUpdatePrompt(() => {
        // Signal the React tree that a new SW is waiting. The App shell
        // checks this flag in a useEffect and surfaces the update banner.
        window.__swUpdateReady = true
        window.__swUpdateFn = updateSW
        window.dispatchEvent(new Event('sw-update-ready'))
      })
    })
  }
}

declare global {
  interface Window {
    __swUpdateReady?: boolean
    __swUpdateFn?: () => Promise<void>
  }
}
