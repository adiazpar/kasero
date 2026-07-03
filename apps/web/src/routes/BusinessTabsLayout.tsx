import { Redirect, Route, useRouteMatch } from 'react-router-dom'
import {
  IonLabel,
  IonRouterOutlet,
  IonTabBar,
  IonTabButton,
  IonTabs,
} from '@ionic/react'
import { Home, BookOpen, Package, Settings } from 'lucide-react'
import { useIntl } from 'react-intl'

import dynamic from '@/lib/next-dynamic-shim'
import { shellBackTransition } from '@/lib/shell-back-transition'

// Each tab page is its own chunk, fetched on first navigation to that
// tab. IonRouterOutlet keeps visited tabs mounted, so the lazy boundary
// only costs once per tab per session. Every tab page mounts an IonPage
// at its root, which is what Ionic's router requires of lazy pages.
const HomeTab = dynamic(
  () => import('@/routes/tabs/HomeTab').then((m) => m.HomeTab),
  { ssr: false },
)
const ManageTab = dynamic(
  () => import('@/routes/tabs/ManageTab').then((m) => m.ManageTab),
  { ssr: false },
)
const ProductsTab = dynamic(
  () => import('@/routes/tabs/ProductsTab').then((m) => m.ProductsTab),
  { ssr: false },
)
const LedgerTab = dynamic(
  () => import('@/routes/tabs/LedgerTab').then((m) => m.LedgerTab),
  { ssr: false },
)
const TeamTab = dynamic(
  () => import('@/routes/tabs/TeamTab').then((m) => m.TeamTab),
  { ssr: false },
)

const BUSINESS_PATH = '/:businessId([A-Za-z0-9_-]{9,})'

// Lucide icons match the rest of the app's icon vocabulary (Hub feature
// cards, Account settings rows, etc.) — and we need stroke-width control
// to land at 1.5 across the row, which the stock ionicons outlines don't
// expose. Active state is signaled by the brand color flip on the icon
// + label (--ion-tab-bar-color-selected), no extra mark.
//
// `size` is rendered as the SVG's `width`/`height` HTML attributes by
// lucide-react. HTML attributes outrank CSS dimensions, so this is the
// authoritative way to size tab-bar icons (CSS width/height in
// ionic-theme.css would lose to it). 28px puts the row at roughly the
// same visual weight as the IonItem start-slot icons used elsewhere.
const TAB_ICON_PROPS = { size: 28, strokeWidth: 1.5 } as const

export function BusinessTabsLayout() {
  const match = useRouteMatch<{ businessId: string }>(BUSINESS_PATH)
  const businessId = match?.params.businessId ?? ''
  const intl = useIntl()

  return (
    <IonTabs>
      <IonRouterOutlet animation={shellBackTransition}>
        <Route exact path={`${BUSINESS_PATH}/home`} component={HomeTab} />
        <Route exact path={`${BUSINESS_PATH}/sales`} component={LedgerTab} />
        <Route exact path={`${BUSINESS_PATH}/products`} component={ProductsTab} />
        <Route exact path={`${BUSINESS_PATH}/manage`} component={ManageTab} />
        <Route exact path={`${BUSINESS_PATH}/team`} component={TeamTab} />
        <Route
          exact
          path={BUSINESS_PATH}
          render={({ match: m }) => <Redirect to={`/${m.params.businessId}/home`} />}
        />
      </IonRouterOutlet>
      <IonTabBar slot="bottom">
        <IonTabButton tab="home" href={`/${businessId}/home`}>
          <Home {...TAB_ICON_PROPS} />
          <IonLabel>{intl.formatMessage({ id: 'navigation.home' })}</IonLabel>
        </IonTabButton>
        <IonTabButton tab="sales" href={`/${businessId}/sales`}>
          <BookOpen {...TAB_ICON_PROPS} />
          <IonLabel>{intl.formatMessage({ id: 'ledger.tab_label' })}</IonLabel>
        </IonTabButton>
        <IonTabButton tab="products" href={`/${businessId}/products`}>
          <Package {...TAB_ICON_PROPS} />
          <IonLabel>{intl.formatMessage({ id: 'navigation.products' })}</IonLabel>
        </IonTabButton>
        <IonTabButton tab="manage" href={`/${businessId}/manage`}>
          <Settings {...TAB_ICON_PROPS} />
          <IonLabel>{intl.formatMessage({ id: 'navigation.manage' })}</IonLabel>
        </IonTabButton>
      </IonTabBar>
    </IonTabs>
  )
}
