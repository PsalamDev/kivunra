import { NextRequest, NextResponse } from 'next/server'

import { apiError } from '@/lib/api-error'
import { PAYABLE_STATUSES, type InvoiceStatus } from '@/lib/invoices'
import {
  createPayPalOrder,
  isPayPalConfigured,
  isPayPalCurrency,
  PayPalApiError,
} from '@/lib/paypal'
import {
  findReusableOrder,
  invoiceAmountDue,
  loadPublicInvoice,
} from '@/lib/public-invoice'
import { isInvoiceTokenShape } from '@/lib/public-token'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ token: string }> }

/**
 * Creates (or reuses) a PayPal order for the amount still owed.
 * The amount always comes from the database, never from the browser.
 */
export async function POST(_request: NextRequest, { params }: RouteContext) {
  const { token } = await params

  if (!isInvoiceTokenShape(token)) {
    return apiError(404, 'Invoice not found')
  }

  if (!isPayPalConfigured()) {
    return apiError(503, 'Online payments are not configured on this deployment.')
  }

  const loaded = await loadPublicInvoice(token)

  if (!loaded.ok) {
    if (loaded.reason === 'not_configured') {
      return apiError(503, 'Online payments are not configured on this deployment.')
    }
    if (loaded.reason === 'not_found') {
      return apiError(404, 'Invoice not found')
    }
    return apiError(500, 'Could not load this invoice. Please try again.')
  }

  const invoice = loaded.invoice

  if (!PAYABLE_STATUSES.includes(invoice.status as InvoiceStatus)) {
    return apiError(409, 'This invoice is not available for payment.')
  }

  const currency = invoice.currency.toUpperCase()

  if (!isPayPalCurrency(currency)) {
    return apiError(400, `PayPal does not support ${invoice.currency} payments.`)
  }

  const amount = invoiceAmountDue(invoice)

  if (amount <= 0.01) {
    return apiError(409, 'This invoice has already been paid in full.')
  }

  const reusable = findReusableOrder(invoice, amount)

  if (reusable?.paypal_order_id) {
    return NextResponse.json({ id: reusable.paypal_order_id })
  }

  let order

  try {
    order = await createPayPalOrder({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      amount,
      currency,
    })
  } catch (error) {
    if (error instanceof PayPalApiError) {
      console.error(
        '[paypal] create order failed',
        error.status,
        error.message,
        error.debugId ?? ''
      )
    } else {
      console.error('[paypal] create order failed', error)
    }

    return apiError(502, 'Could not start PayPal checkout. Please try again.')
  }

  const admin = createAdminClient()
  const { error: insertError } = await admin.from('payment_orders').insert({
    invoice_id: invoice.id,
    paypal_order_id: order.id,
    expected_amount: amount,
    currency,
    status: 'Created',
  })

  if (insertError) {
    console.error('[paypal] could not persist order', insertError.code, insertError.message)
    return apiError(500, 'Could not start PayPal checkout. Please try again.')
  }

  return NextResponse.json({ id: order.id }, { status: 201 })
}
