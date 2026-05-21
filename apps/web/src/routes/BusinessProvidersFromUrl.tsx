import type { ReactNode } from 'react'
import { useRouteMatch } from 'react-router-dom'

import { BusinessDataPreloader } from '@/components/layout/BusinessDataPreloader'
import { NavigationErrorNotice } from '@/components/layout/NavigationErrorNotice'
import { ContentGuard } from '@/components/auth'
import { BusinessProvider } from '@/contexts/business-context'
import { ExpenseCategoriesProvider } from '@/contexts/expense-categories-context'
import { ExpensesProvider } from '@/contexts/expenses-context'
import { InventoryAdjustmentsProvider } from '@/contexts/inventory-adjustments-context'
import { IncomingTransferProvider } from '@/contexts/incoming-transfer-context'
import { PageTransitionProvider } from '@/contexts/page-transition-context'
import { PendingTransferProvider } from '@/contexts/pending-transfer-context'
import { ProductsProvider } from '@/contexts/products-context'
import { ProductSettingsProvider } from '@/contexts/product-settings-context'
import { SalesProvider } from '@/contexts/sales-context'
import { SalesSessionsProvider } from '@/contexts/sales-sessions-context'

/**
 * Per-business provider tree. Mounted INSIDE the `/:businessId` Route
 * inside the outer `IonRouterOutlet` (see AuthenticatedShell), not
 * around it.
 *
 * Why "inside" matters: a wrapper around the outlet that conditionally
 * renders different parents (Fragment for `/`, full provider stack for
 * `/:bizId/...`) caused the entire outer outlet to unmount and remount
 * on every hub<->business transition. By the second remount Ionic's
 * view-stack lifecycle no longer cleared `.ion-page-invisible` from
 * the freshly-mounted page, leaving it at `opacity: 0` (DOM rendered,
 * pointer-events working — buttons fired haptics — but visually blank).
 * Mounting the providers inside the route keeps the outer outlet
 * structurally stable.
 *
 * Tab switches inside a business don't unmount this — Ionic keeps
 * `BusinessTabsLayout` (and therefore this wrapper) mounted in the
 * outlet stack across tab routes that share the `/:bizId` prefix.
 *
 * The matched `businessId` becomes the React `key` on each per-resource
 * provider so caches reset cleanly when the user switches businesses
 * via direct URL change. Without that, entering business A and then
 * business B would leak A's cached arrays into B's first render.
 *
 * `ContentGuard` gates rendering until `BusinessContext` resolves the
 * business + role. `BusinessDataPreloader` warms `ensure*Loaded()`
 * data so the first tab seen has populated caches.
 */
export function BusinessProvidersFromUrl({ children }: { children: ReactNode }) {
  // Same regex as the parent Route — kept here as a backstop, but in
  // practice this component is only mounted when the route already
  // matched a real businessId.
  const match = useRouteMatch<{ businessId: string }>({
    path: '/:businessId([A-Za-z0-9_-]{9,})',
    exact: false,
  })

  const businessId = match?.params.businessId
  if (!businessId) return null

  return (
    <PageTransitionProvider>
      <IncomingTransferProvider>
        <BusinessProvider businessId={businessId}>
          <PendingTransferProvider>
            <SalesSessionsProvider key={`sales-sessions-${businessId}`} businessId={businessId}>
              <SalesProvider key={`sales-${businessId}`} businessId={businessId}>
                <ProductsProvider key={`products-${businessId}`} businessId={businessId}>
                  <ProductSettingsProvider key={`product-settings-${businessId}`} businessId={businessId}>
                    <ExpenseCategoriesProvider key={`expense-categories-${businessId}`} businessId={businessId}>
                      <ExpensesProvider key={`expenses-${businessId}`} businessId={businessId}>
                        <InventoryAdjustmentsProvider key={`inventory-adjustments-${businessId}`} businessId={businessId}>
                          <ContentGuard>
                            <BusinessDataPreloader businessId={businessId} />
                            <NavigationErrorNotice />
                            {children}
                          </ContentGuard>
                        </InventoryAdjustmentsProvider>
                      </ExpensesProvider>
                    </ExpenseCategoriesProvider>
                  </ProductSettingsProvider>
                </ProductsProvider>
              </SalesProvider>
            </SalesSessionsProvider>
          </PendingTransferProvider>
        </BusinessProvider>
      </IncomingTransferProvider>
    </PageTransitionProvider>
  )
}
