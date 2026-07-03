/**
 * Regression guard for the React "Each child in a list should have a unique
 * key prop" warning produced by rich-text `intl.formatMessage(..., { em })`
 * results rendered directly into JSX.
 *
 * Root cause: react-intl assigns internal keys to the parts of a rich-text
 * result, but React 19 still warns about the bare ReactNode[] unless the
 * element returned by the chunk renderer carries an explicit key of its own.
 * The fix is `em: (chunks) => <em key="em">{chunks}</em>` at every call site.
 * (The `<FormattedMessage>` component form and `defaultRichTextElements` do
 * NOT avoid the warning in this react-intl 7 / React 19 combination —
 * verified empirically.)
 *
 * WHY ONE COMBINED RENDER, NOT ONE TEST PER COMPONENT: React deduplicates the
 * "unique key" dev warning per process. The FIRST unkeyed rich-text render
 * fires console.error; keyed (fixed) renders never fire, so they never mark
 * the dedup bucket. Rendering all flagged surfaces in a single tree therefore
 * guarantees that if ANY of them regresses to an unkeyed `<em>`, at least one
 * warning fires (the first broken one) and the assertion catches it. Splitting
 * into per-component tests would let a later component's regression be masked
 * by an earlier warning in the same process (a flaky false-pass we observed).
 *
 * The three surfaces are the ones the e2e walkthrough flagged: OpenSessionModal
 * step 0 (rich-text hero title routed through PriceKeypadStep), a product step
 * (AddEntryStep title), and EditTaxModal's success step.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { IonApp } from '@ionic/react'
import enUS from '../i18n/messages/en-US.json'

const fakeBusiness = {
  id: 'b1',
  taxMode: 'inclusive' as const,
  taxRate: 8,
  locale: 'en-US',
  currency: 'USD',
}

vi.mock('@/hooks/useBusinessFormat', () => ({
  useBusinessFormat: () => ({
    locale: 'en-US',
    currency: 'USD',
    formatCurrency: (n: number) => `$${n.toFixed(2)}`,
    formatCurrencyCompact: (n: number) => `$${n}`,
    formatDate: () => 'Jan 1',
    formatTime: () => '12:00 PM',
  }),
}))
vi.mock('@/components/animations', () => ({
  LottiePlayerDynamic: () => null,
}))
vi.mock('@/contexts/sales-sessions-context', () => ({
  useSalesSessions: () => ({
    openSession: vi.fn().mockResolvedValue(undefined),
    currentSession: null,
  }),
}))
vi.mock('@/hooks/useApiMessage', () => ({
  useApiMessage: () => () => 'error',
}))
vi.mock('@/hooks/useUpdateBusiness', () => ({
  useUpdateBusiness: () => ({
    update: vi.fn().mockResolvedValue(true),
    isSubmitting: false,
    error: '',
    reset: vi.fn(),
  }),
}))
vi.mock('@/contexts/business-context', () => ({
  useBusiness: () => ({ business: fakeBusiness }),
  useOptionalBusiness: () => ({ business: fakeBusiness }),
}))

import { OpenSessionModal } from './sales/OpenSessionModal'
import { EditTaxModal } from './manage/EditTaxModal'
import { AddEntryStep } from './products/steps/AddEntryStep'
import {
  AddProductNavContext,
  AddProductCallbacksContext,
} from './products/steps/ProductNavContext'
import type {
  ProductNav,
  AddProductCallbacks,
} from './products/steps/ProductNavContext'

const messages = enUS as Record<string, string>

function keyWarnings(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.filter((c: unknown[]) => String(c[0]).includes('unique "key"'))
}

describe('rich-text key-warning regression guard', () => {
  afterEach(() => vi.restoreAllMocks())

  it('renders every flagged rich-text surface without a React key warning', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const nav: ProductNav = { push: vi.fn(), pop: vi.fn(), depth: 1 }
    const callbacks = {
      onClose: vi.fn(),
      onOpenSettings: vi.fn(),
    } as unknown as AddProductCallbacks

    render(
      <IntlProvider locale="en" messages={messages}>
        <IonApp>
          <OpenSessionModal isOpen onClose={() => {}} previousCountedCash={null} />
          <AddProductNavContext.Provider value={nav}>
            <AddProductCallbacksContext.Provider value={callbacks}>
              <AddEntryStep />
            </AddProductCallbacksContext.Provider>
          </AddProductNavContext.Provider>
          <EditTaxModal isOpen onClose={() => {}} />
        </IonApp>
      </IntlProvider>,
    )

    // OpenSessionModal (hero title) and AddEntryStep (entry title) render
    // their rich-text on mount. Drive EditTaxModal from its default
    // 'inclusive' mode to "No tax" (dirty + rate-valid) and Save to reach
    // the rich-text success step.
    fireEvent.click(screen.getByText('No tax'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByText('Settings saved')).toBeDefined())

    expect(keyWarnings(spy)).toEqual([])
  })
})
