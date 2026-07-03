import type { IntlShape } from 'react-intl'
import type { Sale } from '@kasero/shared/types/sale'

interface BuildReceiptTextOptions {
  intl: IntlShape
  sale: Sale
  /** User-entered — rendered verbatim, never translated. */
  businessName: string
  formatCurrency: (value: number) => string
  formatDate: (date: Date | string) => string
  formatTime: (date: Date | string) => string
}

/**
 * Build the shareable plain-text receipt for a sale. Labels are localized
 * to the viewer's UI language; money/date/time formatting uses the
 * BUSINESS locale + currency (pass the useBusinessFormat formatters).
 * Product names, notes, and the business name are user-entered content and
 * are embedded verbatim.
 */
export function buildReceiptText({
  intl,
  sale,
  businessName,
  formatCurrency,
  formatDate,
  formatTime,
}: BuildReceiptTextOptions): string {
  const createdAt = new Date(sale.createdAt)
  const lines: string[] = []

  lines.push(businessName)
  lines.push(
    intl.formatMessage({ id: 'sales.receipt.text_sale_number' }, { number: sale.saleNumber }),
  )
  lines.push(`${formatDate(createdAt)} · ${formatTime(createdAt)}`)
  if (sale.status === 'voided') {
    lines.push(intl.formatMessage({ id: 'sales.receipt.text_voided' }))
  }
  lines.push('')

  for (const item of sale.items) {
    lines.push(
      `${item.quantity} × ${item.productName} @ ${formatCurrency(item.unitPrice)} = ${formatCurrency(item.subtotal)}`,
    )
  }
  lines.push('')

  const subtotal = sale.items.reduce((acc, it) => acc + it.subtotal, 0)
  const hasDiscount = sale.discountAmount > 0
  const hasTax = sale.taxMode !== 'none' && sale.taxAmount > 0

  if (hasDiscount || hasTax) {
    lines.push(
      `${intl.formatMessage({ id: 'sales.receipt.text_subtotal' })}: ${formatCurrency(subtotal)}`,
    )
  }
  if (hasDiscount) {
    lines.push(
      `${intl.formatMessage({ id: 'sales.receipt.text_discount' })}: -${formatCurrency(sale.discountAmount)}`,
    )
  }
  if (hasTax) {
    const taxLabel =
      sale.taxMode === 'inclusive'
        ? intl.formatMessage({ id: 'sales.receipt.text_tax_included' }, { rate: sale.taxRate })
        : intl.formatMessage({ id: 'sales.receipt.text_tax' }, { rate: sale.taxRate })
    lines.push(`${taxLabel}: ${formatCurrency(sale.taxAmount)}`)
  }
  lines.push(
    `${intl.formatMessage({ id: 'sales.receipt.text_total' })}: ${formatCurrency(sale.total)}`,
  )
  lines.push(
    `${intl.formatMessage({ id: 'sales.receipt.text_payment' })}: ${intl.formatMessage({
      id: `sales.cart.modal_method_${sale.paymentMethod}` as const,
    })}`,
  )

  return lines.join('\n')
}

export type ShareReceiptOutcome = 'shared' | 'copied' | 'failed'

/**
 * Deliver a receipt: native share sheet when the platform has one,
 * clipboard otherwise. 'copied' tells the caller to surface a confirmation
 * toast (there is no visible feedback from writeText alone); 'shared'
 * needs no toast — the OS sheet is its own feedback. A dismissed share
 * sheet (AbortError) also resolves as 'shared' so we never show a
 * misleading failure after a deliberate cancel.
 */
export async function shareReceiptText(text: string): Promise<ShareReceiptOutcome> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ text })
      return 'shared'
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'shared'
      // Fall through to the clipboard path (some webviews expose share()
      // but reject it outside a user gesture chain).
    }
  }
  try {
    await navigator.clipboard.writeText(text)
    return 'copied'
  } catch {
    return 'failed'
  }
}
