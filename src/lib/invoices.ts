import { createInvoiceToken, isInvoiceTokenConfigured } from './public-token'

export const INVOICE_STATUSES = [
  'Draft',
  'Published',
  'PartiallyPaid',
  'Paid',
  'Cancelled',
  'Overdue',
] as const

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

/** Statuses for which a customer can still open the public pay link. */
export const PAYABLE_STATUSES: readonly InvoiceStatus[] = ['Published', 'PartiallyPaid', 'Overdue']

export const INVOICE_SELECT = '*, customers(*), invoice_items(*)'

/**
 * Detail view also loads the payment trail so the owner can see captured,
 * refunded and outstanding amounts without a second round trip.
 */
export const INVOICE_DETAIL_SELECT =
  '*, customers(*), invoice_items(*), payment_orders(paypal_order_id, status, expected_amount, currency, created_at, payment_captures(id, amount, currency, status, captured_at, payment_refunds(amount, currency, status, refunded_at)))'

export function isInvoiceStatus(value: unknown): value is InvoiceStatus {
  return typeof value === 'string' && (INVOICE_STATUSES as readonly string[]).includes(value)
}

type SerializableInvoice = {
  id: string
  status: string
  public_token_hash?: string | null
  [key: string]: unknown
}

/**
 * Strips the stored token hash and adds the (recomputable) public pay URL.
 * Server-only: relies on INVOICE_TOKEN_SECRET.
 */
export function serializeInvoice<T extends SerializableInvoice>(invoice: T, origin: string) {
  const { public_token_hash, ...rest } = invoice
  const base = origin.replace(/\/$/, '')
  const token = public_token_hash && isInvoiceTokenConfigured() ? createInvoiceToken(invoice.id) : null

  return {
    ...rest,
    public_url: token ? `${base}/pay/${token}` : null,
    receipt_url: token ? `${base}/pay/${token}/receipt` : null,
    receipt_pdf_url: token ? `${base}/api/pay/${token}/receipt` : null,
  }
}

export function sumByCurrency<T extends { total: number | string | null; currency: string }>(
  rows: T[]
): Array<[string, number]> {
  const totals = new Map<string, number>()

  for (const row of rows) {
    const amount = Number(row.total ?? 0)
    if (!Number.isFinite(amount)) continue
    totals.set(row.currency, (totals.get(row.currency) ?? 0) + amount)
  }

  return [...totals.entries()].sort((a, b) => b[1] - a[1])
}
