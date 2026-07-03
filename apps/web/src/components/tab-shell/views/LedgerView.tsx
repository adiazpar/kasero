'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import {
  IonRefresher,
  IonRefresherContent,
  type RefresherEventDetail,
} from '@ionic/react'

import { TabContainer } from '@/components/ui'
import { SalesView } from '@/components/tab-shell/views/SalesView'
import { ExpensesView } from '@/components/expenses/ExpensesView'
import { useExpenses } from '@/contexts/expenses-context'
import { useSales } from '@/contexts/sales-context'
import { useSalesSessions } from '@/contexts/sales-sessions-context'
import { useFeatureFlag } from '@/lib/feature-flags'
import { callRefetch } from '@/lib/realtime/refetch-registry'
import { useSearchParams } from '@/lib/next-navigation-shim'

type LedgerTab = 'sales' | 'expenses'

// LedgerView wraps the Sales and Expenses sub-tabs inside a TabContainer.
// When the expenses_v1 feature flag is OFF, renders SalesView directly
// (no sub-tabs, identical to the previous SalesTab behavior).
//
// Deep-link: navigate to `/:bid/sales?tab=expenses` to land on the
// Expenses sub-tab. The MonthlySummaryCard on Home uses this to let
// users tap income/expenses and arrive at the right sub-tab.
export function LedgerView() {
  const t = useIntl()
  const expensesEnabled = useFeatureFlag('expenses_v1')
  const searchParams = useSearchParams()
  const tabParam = searchParams?.get('tab')
  const initialTab: LedgerTab =
    tabParam === 'expenses' ? 'expenses' : 'sales'
  const [activeTab, setActiveTab] = useState<LedgerTab>(initialTab)

  const { refetch: refetchSales } = useSales()
  const { refetch: refetchSessions } = useSalesSessions()
  const { refetch: refetchExpenses } = useExpenses()

  // Pull-to-refresh for the whole ledger surface. Awaits the shared
  // context refetches, and fans the 'sales' key out through the refetch
  // registry so instance-scoped listeners (the SalesReports aggregate,
  // the expenses summary) revalidate too — the direct refetches set
  // their inFlight guards synchronously, so the fan-out dedupes into
  // the same requests.
  const handleRefresh = async (event: CustomEvent<RefresherEventDetail>) => {
    try {
      const jobs = [refetchSales(), refetchSessions()]
      if (expensesEnabled) jobs.push(refetchExpenses())
      callRefetch('sales')
      await Promise.all(jobs)
    } finally {
      event.detail.complete()
    }
  }

  const refresher = (
    // Direct DOM child of the page's IonContent (fragments render no
    // element), so the slot="fixed" projection works.
    <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
      <IonRefresherContent />
    </IonRefresher>
  )

  if (!expensesEnabled) {
    return (
      <>
        {refresher}
        <SalesView />
      </>
    )
  }

  return (
    <>
      {refresher}
      <div className="ledger-segment-wrap">
      <div
        role="tablist"
        aria-label={t.formatMessage({ id: 'ledger.tab_switcher_aria' })}
        className="products-segment"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'sales'}
          className="products-segment__button"
          onClick={() => setActiveTab('sales')}
        >
          {t.formatMessage({ id: 'ledger.sub_sales' })}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'expenses'}
          className="products-segment__button"
          onClick={() => setActiveTab('expenses')}
        >
          {t.formatMessage({ id: 'ledger.sub_expenses' })}
        </button>
      </div>
      </div>
      <TabContainer
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as LedgerTab)}
        swipeable
        fitActiveHeight
      >
        <TabContainer.Tab id="sales">
          <SalesView />
        </TabContainer.Tab>
        <TabContainer.Tab id="expenses">
          <ExpensesView />
        </TabContainer.Tab>
      </TabContainer>
    </>
  )
}
