/**
 * Checkout behaviors in ViewCartModal:
 *
 *  1. A fully-comped sale (100% discount → $0 total) must be chargeable.
 *     The Charge button gates on `subtotal > 0` (real line value), not
 *     `chargeTotal > 0`, so a legitimately free sale commits while an empty
 *     cart stays disabled.
 *  2. The cart clears the instant the sale commits (at the success-step
 *     transition), not deferred to the Done tap — so the background POS is
 *     immediately consistent and there is no delayed-clear race.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { IonApp } from '@ionic/react'
import enUS from '../../i18n/messages/en-US.json'
import type { UseCartResult } from '@/hooks/useCart'
import type { Sale } from '@kasero/shared/types/sale'

const fakeBusiness = {
  id: 'b1',
  name: 'Test Stand',
  taxMode: 'none' as const,
  taxRate: 0,
  currency: 'USD',
  locale: 'en-US',
}

const fakeSale: Sale = {
  id: 's1',
  saleNumber: 42,
  sessionId: 'sess1',
  date: new Date().toISOString(),
  total: 0,
  paymentMethod: 'cash',
  notes: null,
  status: 'completed',
  voidedAt: null,
  voidedBy: null,
  discountAmount: 10,
  taxRate: 0,
  taxAmount: 0,
  taxMode: 'none',
  items: [
    { productId: 'p1', productName: 'Widget', quantity: 1, unitPrice: 10, subtotal: 10 },
  ],
  createdByUserId: 'u1',
  createdAt: new Date().toISOString(),
}

const commitSale = vi.fn().mockResolvedValue(fakeSale)

vi.mock('@/contexts/business-context', () => ({
  useBusiness: () => ({ business: fakeBusiness }),
  useOptionalBusiness: () => ({ business: fakeBusiness }),
}))
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
vi.mock('@/contexts/products-context', () => ({
  useProducts: () => ({
    products: [{ id: 'p1', name: 'Widget', price: 10, stock: 5 }],
    refetch: vi.fn(),
  }),
}))
vi.mock('@/contexts/sales-context', () => ({
  useSales: () => ({ commitSale }),
}))
vi.mock('@/hooks/useApiMessage', () => ({
  useApiMessage: () => () => 'error',
}))
vi.mock('@/components/animations', () => ({
  LottiePlayerDynamic: () => null,
}))

import { ViewCartModal } from './ViewCartModal'

const messages = enUS as Record<string, string>

function makeCart(): UseCartResult {
  return {
    lines: [{ productId: 'p1', productName: 'Widget', unitPrice: 10, quantity: 1 }],
    total: 10,
    addLine: vi.fn(),
    updateQty: vi.fn(),
    removeLine: vi.fn(),
    clear: vi.fn(),
  }
}

const renderModal = (cart: UseCartResult) =>
  render(
    <IntlProvider locale="en" messages={messages}>
      <IonApp>
        <ViewCartModal isOpen onClose={() => {}} cart={cart} />
      </IonApp>
    </IntlProvider>,
  )

describe('ViewCartModal checkout', () => {
  afterEach(() => vi.restoreAllMocks())

  it('enables Charge for a fully-comped ($0) sale and clears the cart at commit', async () => {
    const cart = makeCart()
    renderModal(cart)

    // Step 0 → payment step.
    fireEvent.click(screen.getByRole('button', { name: /Confirm/ }))

    // Apply a 100% discount so the charge total is $0.00.
    fireEvent.click(screen.getByRole('button', { name: 'Percent' }))
    fireEvent.change(screen.getByLabelText('Discount', { selector: 'input' }), {
      target: { value: '100' },
    })

    // The Charge button must be enabled even though the total is $0.
    const charge = screen.getByRole('button', { name: /Charge/ })
    expect(charge).not.toBeDisabled()

    fireEvent.click(charge)

    // Cart is cleared at commit (not deferred), and the success step shows.
    await waitFor(() => expect(commitSale).toHaveBeenCalled())
    await waitFor(() => expect(cart.clear).toHaveBeenCalled())
    expect(screen.getByText('Complete')).toBeDefined()
  })

  it('keeps Charge disabled when the cart is empty', () => {
    const emptyCart: UseCartResult = { ...makeCart(), lines: [], total: 0 }
    renderModal(emptyCart)
    // Confirm is disabled on an empty cart, so the payment/charge path is
    // unreachable — the empty-cart case stays blocked by the lines check.
    expect(screen.getByRole('button', { name: /Confirm/ })).toBeDisabled()
  })
})
