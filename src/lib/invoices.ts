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

  return {
    ...rest,
    public_url:
      public_token_hash && isInvoiceTokenConfigured()
        ? `${origin.replace(/\/$/, '')}/pay/${createInvoiceToken(invoice.id)}`
        : null,
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
