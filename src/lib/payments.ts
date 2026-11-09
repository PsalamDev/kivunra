export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

export interface PaymentCaptureJoinRow {
  amount: number | string | null
  status: string
  payment_orders:
    | { invoice_id: string }
    | Array<{ invoice_id: string }>
    | null
}

export function captureInvoiceId(row: PaymentCaptureJoinRow): string | null {
  const order = Array.isArray(row.payment_orders) ? row.payment_orders[0] : row.payment_orders
  return order?.invoice_id ?? null
}

/** Completed capture totals keyed by invoice id. */
export function sumCapturedByInvoice(
  rows: PaymentCaptureJoinRow[]
): Map<string, number> {
  const totals = new Map<string, number>()

  for (const row of rows) {
    if (row.status !== 'COMPLETED') continue

    const invoiceId = captureInvoiceId(row)
    if (!invoiceId) continue

    const amount = Number(row.amount ?? 0)
    if (!Number.isFinite(amount)) continue

    totals.set(invoiceId, roundMoney((totals.get(invoiceId) ?? 0) + amount))
  }

  return totals
}

/** Remaining balance for an invoice, never below zero. */
export function remainingBalance(
  total: number | string | null,
  captured: number | undefined
): number {
  const invoiceTotal = Number(total ?? 0)
  if (!Number.isFinite(invoiceTotal) || invoiceTotal <= 0) return 0

  return roundMoney(Math.max(0, invoiceTotal - (captured ?? 0)))
}

export interface PaymentTrailRefund {
  amount: number | string | null
  status: string
}

export interface PaymentTrailCapture {
  amount: number | string | null
  status: string
  payment_refunds?: PaymentTrailRefund[] | null
}

export interface InvoicePaymentTrail {
  payment_orders?: Array<{ payment_captures?: PaymentTrailCapture[] | null }> | null
}

function amountOf(value: number | string | null | undefined): number {
  const amount = Number(value ?? 0)
  return Number.isFinite(amount) ? amount : 0
}

/**
 * Completed captures minus completed refunds for one invoice's nested payment
 * trail. Used to decide whether an invoice can still be edited, cancelled or
 * deleted without disturbing recorded money.
 */
export function netCapturedAmount(invoice: InvoicePaymentTrail): number {
  let captured = 0
  let refunded = 0

  for (const order of invoice.payment_orders ?? []) {
    for (const capture of order.payment_captures ?? []) {
      if (capture.status === 'COMPLETED') {
        captured += amountOf(capture.amount)
      }

      for (const refund of capture.payment_refunds ?? []) {
        if (refund.status === 'COMPLETED') {
          refunded += amountOf(refund.amount)
        }
      }
    }
  }

  return roundMoney(Math.max(0, captured - refunded))
}
