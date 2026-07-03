'use client'

import { useEffect, useMemo } from 'react'
import { useIntl } from 'react-intl'
import {
  IonRefresher,
  IonRefresherContent,
  useIonRouter,
  type RefresherEventDetail,
} from '@ionic/react'
import { useBusiness } from '@/contexts/business-context'
import { useExpenses } from '@/contexts/expenses-context'
import { useSales } from '@/contexts/sales-context'
import { useSalesSessions } from '@/contexts/sales-sessions-context'
import { useProducts } from '@/contexts/products-context'
import { useSalesAggregate } from '@/hooks/useSalesAggregate'
import { useBusinessFormat } from '@/hooks/useBusinessFormat'
import { useFeatureFlag } from '@/lib/feature-flags'
import { callRefetch } from '@/lib/realtime/refetch-registry'
import {
  HomeHero,
  RevenueCard,
  WeekTrendCard,
  AlertsSection,
  MonthlySummaryCard,
} from '@/components/home'

export function HomeView() {
  const intl = useIntl()
  const { businessId } = useBusiness()
  const {
    sales,
    stats,
    isLoaded: salesLoaded,
    ensureLoaded: ensureSalesLoaded,
    refetch: refetchSales,
  } = useSales()
  const {
    currentSession,
    ensureLoaded: ensureSessionsLoaded,
    refetch: refetchSessions,
  } = useSalesSessions()
  const {
    products,
    ensureLoaded: ensureProductsLoaded,
    refetch: refetchProducts,
  } = useProducts()
  const expensesEnabled = useFeatureFlag('expenses_v1')
  // Read-only view of the expenses store — HomeView never triggers the
  // list fetch itself (no ensureLoaded here); it only derives from data
  // that a Ledger visit or the sessionStorage cache already loaded.
  const { expenses, isLoaded: expensesLoaded } = useExpenses()
  const aggregate = useSalesAggregate(businessId ?? '')
  const { formatCurrency } = useBusinessFormat()
  // Ionic-aware router. Used for cross-tab navigation (Home -> Sales /
  // Products / Manage and the alert rows) with the ('none', 'replace')
  // signature so IonTabs recognizes the destination as a sibling tab
  // and performs a tab swap instead of stacking a push on top of Home.
  // Without this, tapping a tile then the back button would walk back
  // through Home before reaching the Hub. Precedent: user-menu-content.
  const ionRouter = useIonRouter()

  useEffect(() => {
    if (!businessId) return
    void ensureSalesLoaded()
    void ensureSessionsLoaded()
    void ensureProductsLoaded()
  }, [
    businessId,
    ensureSalesLoaded,
    ensureSessionsLoaded,
    ensureProductsLoaded,
  ])

  // Mirror SalesStatsCard — open-session running total is computed from
  // the sales list, not currentSession.salesTotal (which is nullable on
  // the wire and not kept live for the open session).
  const sessionRunningTotal = useMemo(() => {
    if (!currentSession) return 0
    // Voided sales are excluded — matches SalesStatsCard and every
    // server-side aggregate.
    return sales
      .filter((s) => s.sessionId === currentSession.id && s.status !== 'voided')
      .reduce((sum, s) => sum + s.total, 0)
  }, [sales, currentSession])

  // Low-stock threshold matches apps/web/src/hooks/useProductFilters.ts —
  // per-product threshold with a default of 10 when unset; nullable stock
  // treated as 0 (matches the same hook).
  const lowStockCount = useMemo(
    () =>
      products.filter((p) => (p.stock ?? 0) <= (p.lowStockThreshold ?? 10))
        .length,
    [products],
  )

  // 7-day total from the server-aggregated dailyRevenue.
  const thisWeekTotal = useMemo(() => {
    if (!aggregate.isLoaded || !aggregate.data) return null
    return aggregate.data.dailyRevenue.reduce((sum, e) => sum + e.total, 0)
  }, [aggregate.isLoaded, aggregate.data])

  // This-week spend for the trend card's "spent" micro-row. Derived from
  // the expenses store only when it's already populated (Ledger visit or
  // sessionStorage cache) — no fetch is triggered from Home. Window
  // mirrors the revenue sparkline: today minus six days, local midnight.
  // The store holds the 100 most-recent expenses, which comfortably
  // covers a 7-day window for the target businesses.
  const thisWeekSpend = useMemo(() => {
    if (!expensesEnabled || !expensesLoaded) return null
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() - 6)
    return expenses.reduce(
      (sum, e) => (new Date(e.date) >= start ? sum + e.amount : sum),
      0,
    )
  }, [expensesEnabled, expensesLoaded, expenses])

  // Pull-to-refresh: refetch every store this surface renders from, and
  // fan the 'sales' key out through the refetch registry so instance-
  // scoped listeners (the MonthlySummaryCard's expenses summary registers
  // under 'sales') revalidate too. The direct refetches above set their
  // inFlight guards synchronously, so the registry fan-out dedupes into
  // the same requests instead of doubling them.
  const handleRefresh = async (event: CustomEvent<RefresherEventDetail>) => {
    try {
      const jobs = [
        refetchSales(),
        refetchSessions(),
        refetchProducts(),
        aggregate.refetch(),
      ]
      callRefetch('sales')
      await Promise.all(jobs)
    } finally {
      event.detail.complete()
    }
  }

  // Cross-tab navigation. push(href, 'none', 'replace') tells Ionic to
  // perform a tab swap instead of stacking a push on top of Home — so
  // the back button from the destination tab leaves the shell at Hub
  // level rather than walking back through Home first.
  const pushTab = (href: string) => {
    ionRouter.push(href, 'none', 'replace')
  }

  const handleSalesClick = () => {
    if (businessId) pushTab(`/${businessId}/sales`)
  }

  const handleProductsClick = () => {
    if (businessId) pushTab(`/${businessId}/products`)
  }

  const handleLowStockClick = () => {
    if (businessId) pushTab(`/${businessId}/products?filter=low_stock`)
  }

  return (
    <>
      {/* Direct DOM child of the page's IonContent (fragments render no
          element), so the slot="fixed" projection works. */}
      <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
        <IonRefresherContent />
      </IonRefresher>
      <div className="home-body">
      <HomeHero />
      <MonthlySummaryCard />
      <RevenueCard
        isLoading={!salesLoaded}
        amount={stats?.todayRevenue ?? null}
        vsYesterdayPct={stats?.vsYesterdayPct ?? null}
      />
      <div className="home-mini-row">
        <button
          type="button"
          className={`home-mini home-mini--cta${
            currentSession ? ' home-mini--cta-open' : ''
          }`}
          onClick={handleSalesClick}
        >
          <span className="home-mini__eyebrow">
            {intl.formatMessage({ id: 'home.sales_tile_kicker' })}
          </span>
          <span className="home-mini__title">
            {currentSession
              ? intl.formatMessage({ id: 'home.session_open_title' })
              : intl.formatMessage({ id: 'home.session_closed_title' })}
          </span>
          <span className="home-mini__sub">
            {currentSession
              ? formatCurrency(sessionRunningTotal)
              : intl.formatMessage({ id: 'home.session_closed_description' })}
          </span>
        </button>
        <div className="home-mini home-mini--stats">
          <button
            type="button"
            className="home-mini__stat-row"
            onClick={handleSalesClick}
          >
            <span className="home-mini__stat-value">{stats?.todayCount ?? 0}</span>
            <span className="home-mini__stat-label">
              {intl.formatMessage({ id: 'home.stat_sales_today' })}
            </span>
          </button>
          <button
            type="button"
            className="home-mini__stat-row"
            onClick={handleProductsClick}
          >
            <span className="home-mini__stat-value">{products.length}</span>
            <span className="home-mini__stat-label">
              {intl.formatMessage({ id: 'navigation.products' })}
            </span>
          </button>
        </div>
      </div>
      <WeekTrendCard
        isLoading={!aggregate.isLoaded}
        dailyRevenue={aggregate.data?.dailyRevenue ?? null}
        thisWeekTotal={thisWeekTotal}
        previousWeekTotal={aggregate.data?.previousWeekRevenue ?? null}
        thisWeekSpend={thisWeekSpend}
      />
      <AlertsSection
        lowStockCount={lowStockCount}
        onLowStockClick={handleLowStockClick}
      />
      </div>
    </>
  )
}
