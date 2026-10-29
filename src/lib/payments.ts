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
