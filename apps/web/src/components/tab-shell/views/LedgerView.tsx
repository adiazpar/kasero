'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'

import { TabContainer } from '@/components/ui'
import { SalesView } from '@/components/tab-shell/views/SalesView'
import { ExpensesView } from '@/components/expenses/ExpensesView'
import { useFeatureFlag } from '@/lib/feature-flags'

type LedgerTab = 'sales' | 'expenses'

// LedgerView wraps the Sales and Expenses sub-tabs inside a TabContainer.
// When the expenses_v1 feature flag is OFF, renders SalesView directly
// (no sub-tabs, identical to the previous SalesTab behavior).
export function LedgerView() {
  const t = useIntl()
  const expensesEnabled = useFeatureFlag('expenses_v1')
  const [activeTab, setActiveTab] = useState<LedgerTab>('sales')

  if (!expensesEnabled) {
    return <SalesView />
  }

  return (
    <>
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
