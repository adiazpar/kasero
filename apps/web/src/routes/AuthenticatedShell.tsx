import { Route } from 'react-router-dom'
import { IonRouterOutlet } from '@ionic/react'

import dynamic from '@/lib/next-dynamic-shim'
import { shellBackTransition } from '@/lib/shell-back-transition'

// Route-level code splitting: each page below is its own chunk, fetched
// on first navigation. The dynamic() shim wraps each in Suspense with a
// null fallback; Ionic's router supports lazily loaded pages as long as
// the resolved component mounts an IonPage at its root (they all do).
// Once a page has been visited, IonRouterOutlet keeps it mounted, so the
// lazy boundary only costs on first entry.
const AccountPage = dynamic(
  () => import('@/routes/AccountPage').then((m) => m.AccountPage),
  { ssr: false },
)
const Sessions = dynamic(
  () => import('@/routes/account/Sessions').then((m) => m.Sessions),
  { ssr: false },
)
const BusinessProvidersFromUrl = dynamic(
  () => import('@/routes/BusinessProvidersFromUrl').then((m) => m.BusinessProvidersFromUrl),
  { ssr: false },
)
const BusinessTabsLayout = dynamic(
  () => import('@/routes/BusinessTabsLayout').then((m) => m.BusinessTabsLayout),
  { ssr: false },
)
const HubPage = dynamic(
  () => import('@/routes/HubPage').then((m) => m.HubPage),
  { ssr: false },
)
const JoinPage = dynamic(
  () => import('@/routes/JoinPage').then((m) => m.JoinPage),
  { ssr: false },
)

// `BusinessProvidersFromUrl` is mounted INSIDE the `/:businessId` route,
// not around the outlet. Wrapping the outlet with a component whose
// rendered tree shape changes with the URL (Fragment vs. full provider
// stack) caused React to unmount and remount the outlet on every
// hub<->business transition. By the second remount Ionic's view-stack
// lifecycle stopped clearing `.ion-page-invisible` on the new page —
// the page mounted with `opacity: 0`, looked blank, but had working
// pointer-events (buttons fired haptics where they "would be").
// Keeping the outlet structurally stable fixes that.
export function AuthenticatedShell() {
  return (
    <IonRouterOutlet animation={shellBackTransition}>
      <Route exact path="/account">
        <AccountPage />
      </Route>
      <Route exact path="/account/sessions">
        <Sessions />
      </Route>
      <Route exact path="/join">
        <JoinPage />
      </Route>
      <Route exact path="/">
        <HubPage />
      </Route>
      <Route path="/:businessId([A-Za-z0-9_-]{9,})">
        <BusinessProvidersFromUrl>
          <BusinessTabsLayout />
        </BusinessProvidersFromUrl>
      </Route>
    </IonRouterOutlet>
  )
}
