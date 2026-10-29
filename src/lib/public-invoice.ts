import { hashInvoiceToken } from './public-token'
import { createAdminClient, isServiceRoleConfigured } from './supabase/admin'

export const PUBLIC_INVOICE_SELECT =
  'id, invoice_number, total, currency, status, due_at, created_at, customers(name), invoice_items(description, quantity, unit_price, line_total), payment_orders(paypal_order_id, status, expected_amount, currency, created_at, payment_captures(amount, status))'

export interface PublicInvoiceCapture {
  amount: number | string | null
  status: string
}

export interface PublicInvoiceOrder {
  paypal_order_id: string | null
  status: string
  expected_amount: number | string | null
  currency: string
  created_at: string
  payment_captures: PublicInvoiceCapture[] | null
}

export interface PublicInvoice {
  id: string
  invoice_number: string
  total: number | string | null
  currency: string
  status: string
  due_at: string | null
  created_at: string
  customers: { name: string } | null
  invoice_items: Array<{
    description: string
    quantity: number | string
    unit_price: number | string
    line_total: number | string
  }>
  payment_orders: PublicInvoiceOrder[] | null
}

export type PublicInvoiceResult =
  | { ok: true; invoice: PublicInvoice }
  | { ok: false; reason: 'not_found' | 'not_configured' | 'error' }

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

/** Sum of captures that have actually cleared. */
export function completedCapturedAmount(invoice: PublicInvoice): number {
  let total = 0

  for (const order of invoice.payment_orders ?? []) {
    for (const capture of order.payment_captures ?? []) {
      if (capture.status !== 'COMPLETED') continue
      const amount = Number(capture.amount ?? 0)
      if (Number.isFinite(amount)) total += amount
    }
  }

  return roundMoney(total)
}

/** Amount the customer still owes, never below zero. */
export function invoiceAmountDue(invoice: PublicInvoice): number {
  if (invoice.status === 'Paid') return 0

  const total = Number(invoice.total ?? 0)
  if (!Number.isFinite(total) || total <= 0) return 0

  return roundMoney(Math.max(0, total - completedCapturedAmount(invoice)))
}

export async function loadPublicInvoice(token: string): Promise<PublicInvoiceResult> {
  if (!isServiceRoleConfigured()) {
    return { ok: false, reason: 'not_configured' }
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('invoices')
    .select(PUBLIC_INVOICE_SELECT)
    .eq('public_token_hash', hashInvoiceToken(token))
    .maybeSingle()

  if (error) {
    console.error('[public-invoice]', error.code ?? 'unknown', error.message)
    return { ok: false, reason: 'error' }
  }

  if (!data) {
    return { ok: false, reason: 'not_found' }
  }

  return { ok: true, invoice: data as unknown as PublicInvoice }
}

/** Most recent order that can still be resumed, if the amount still matches. */
export function findReusableOrder(
  invoice: PublicInvoice,
  amount: number,
  maxAgeMs = 60 * 60 * 1000
): PublicInvoiceOrder | null {
  const cutoff = Date.now() - maxAgeMs

  const candidates = (invoice.payment_orders ?? [])
    .filter((order) => order.status === 'Created')
    .filter((order) => Boolean(order.paypal_order_id))
    .filter((order) => order.currency.toUpperCase() === invoice.currency.toUpperCase())
    .filter((order) => Math.abs(Number(order.expected_amount ?? 0) - amount) < 0.005)
    .filter((order) => {
      const createdAt = new Date(order.created_at).getTime()
      return Number.isFinite(createdAt) && createdAt >= cutoff
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  return candidates[0] ?? null
}
