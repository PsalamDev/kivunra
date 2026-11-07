import { NextRequest, NextResponse } from 'next/server'

import { apiError, databaseErrorResponse } from '@/lib/api-error'
import { PAYABLE_STATUSES, type InvoiceStatus } from '@/lib/invoices'
import {
  capturePayPalOrder,
  fetchPayPalOrder,
  isPayPalConfigured,
  isPayPalCurrency,
  PayPalApiError,
  type PayPalCapture,
  type PayPalOrder,
} from '@/lib/paypal'
import {
  completedCapturedAmount,
  invoiceAmountDue,
  loadPublicInvoice,
} from '@/lib/public-invoice'
import { isInvoiceTokenShape } from '@/lib/public-token'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ token: string }> }

/** RPC codes that will keep failing: do not ask the client to retry forever. */
const PERMANENT_RPC_ERRORS = new Set(['22023', 'P0002'])

function extractCompletedCapture(order: PayPalOrder): PayPalCapture | undefined {
  return order.purchase_units
    ?.flatMap((unit) => unit.payments?.captures ?? [])
    .find((capture) => capture.status === 'COMPLETED')
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Captures an approved PayPal order.
 *
 * The browser only supplies the PayPal order id. The invoice, currency and
 * amount are all re-read (and re-checked) on the server before and after the
 * capture, so a tampered client cannot pay less or attach someone else's order.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { token } = await params

  if (!isInvoiceTokenShape(token)) {
    return apiError(404, 'Invoice not found')
  }

  if (!isPayPalConfigured()) {
    return apiError(503, 'Online payments are not configured on this deployment.')
  }

  const body = (await request.json().catch(() => null)) as { orderID?: unknown } | null
  const orderID = typeof body?.orderID === 'string' ? body.orderID.trim() : ''

  if (!orderID || orderID.length > 64) {
    return apiError(400, 'Missing PayPal order id')
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

  const admin = createAdminClient()

  // Bind the PayPal order to this invoice; never capture an arbitrary order.
  const { data: order, error: orderError } = await admin
    .from('payment_orders')
    .select('id, invoice_id, status, expected_amount, currency')
    .eq('paypal_order_id', orderID)
    .eq('invoice_id', invoice.id)
    .maybeSingle()

  if (orderError) {
    return databaseErrorResponse(orderError)
  }

  if (!order) {
    return apiError(404, 'Payment order not found')
  }

  const capturedSoFar = completedCapturedAmount(invoice)
  const amountDue = invoiceAmountDue(invoice)

  // PayPal calls onApprove once per approval, but a retry must be harmless.
  if (order.status === 'Captured') {
    return NextResponse.json({
      status: 'COMPLETED',
      already_captured: true,
      invoice_status: invoice.status,
      captured: capturedSoFar,
      amount_due: amountDue,
    })
  }

  if (amountDue <= 0.01) {
    return apiError(409, 'This invoice has already been paid in full.')
  }

  const expectedAmount = Number(order.expected_amount ?? 0)

  if (!Number.isFinite(expectedAmount) || expectedAmount <= 0.01) {
    return apiError(409, 'This payment order is no longer valid.')
  }

  // Someone else may have paid part of the invoice since this order was made.
  if (expectedAmount > amountDue + 0.01) {
    return apiError(409, 'The amount due has changed. Please refresh the page and try again.')
  }

  let capturedOrder: PayPalOrder | null = null
  let reconciled = false

  try {
    capturedOrder = await capturePayPalOrder(orderID)
  } catch (error) {
    if (error instanceof PayPalApiError && (error.status === 400 || error.status === 403 || error.status === 422)) {
      // A first attempt may have captured the money even though this call
      // failed (double-click, retry, webhook race). Read the order back and
      // reconcile instead of telling the payer something went wrong.
      try {
        const orderNow = await fetchPayPalOrder(orderID)
        const existingCapture = extractCompletedCapture(orderNow)

        if (existingCapture) {
          capturedOrder = orderNow
          reconciled = true
          console.warn('[paypal] capture reconciled after error', orderID, error.status, error.message)
        }
      } catch (readError) {
        console.error('[paypal] could not re-read order during reconciliation', orderID, readError)
      }
    }

    if (!capturedOrder) {
      if (error instanceof PayPalApiError) {
        console.error(
          '[paypal] capture failed',
          error.status,
          error.message,
          error.debugId ?? ''
        )

        if (error.status === 422) {
          return apiError(409, 'PayPal could not complete this payment. Please try again.')
        }
      } else {
        console.error('[paypal] capture failed', error)
      }

      return apiError(502, 'Could not complete the PayPal payment. Please try again.')
    }
  }

  const captures =
    capturedOrder.purchase_units?.flatMap((unit) => unit.payments?.captures ?? []) ?? []
  const capture =
    captures.find((entry) => entry.status === 'COMPLETED') ?? captures[0]

  if (!capture?.id) {
    console.error('[paypal] capture response had no capture', orderID, capturedOrder.status)
    return apiError(502, 'PayPal did not return a capture. Please contact the sender.')
  }

  const capturedCurrency = (capture.amount?.currency_code ?? '').toUpperCase()
  const capturedAmount = Number(capture.amount?.value ?? Number.NaN)

  // Server-side amount verification. Never trust a value from the browser.
  if (
    capturedCurrency !== currency ||
    !Number.isFinite(capturedAmount) ||
    capturedAmount <= 0 ||
    Math.abs(capturedAmount - expectedAmount) > 0.01
  ) {
    console.error(
      '[paypal] capture amount mismatch',
      orderID,
      capture.id,
      `${capturedAmount} ${capturedCurrency}`,
      `expected ${expectedAmount} ${currency}`
    )
    return apiError(
      502,
      'PayPal returned an unexpected amount. Please contact the sender before trying again.'
    )
  }

  const status = capture.status || 'COMPLETED'

  const { data, error: recordError } = await admin.rpc('record_payment_capture', {
    p_invoice_id: invoice.id,
    p_paypal_order_id: orderID,
    p_paypal_capture_id: capture.id,
    p_amount: capturedAmount,
    p_currency: currency,
    p_status: status,
  })

  if (recordError) {
    console.error('[paypal] record capture failed', recordError.code, recordError.message)

    // A permanent refusal would loop on every retry; surface it now.
    if (PERMANENT_RPC_ERRORS.has(recordError.code ?? '')) {
      return databaseErrorResponse(recordError)
    }

    // The money has moved but our record did not land. The webhook (or a
    // retry) will reconcile, so acknowledge instead of reporting a failure.
    return NextResponse.json(
      {
        status,
        reconciled: reconciled || undefined,
        pending_reconciliation: true,
        message: 'Payment received. Final confirmation is syncing in the background.',
        invoice_status: invoice.status,
        captured: capturedSoFar,
        amount_due: amountDue,
      },
      { status: 202 }
    )
  }

  const result = (data ?? {}) as {
    invoice_status?: string
    captured?: number
    fully_paid?: boolean
  }

  const total = Number(invoice.total ?? 0)
  const capturedTotal = Number(result.captured ?? capturedSoFar + capturedAmount)

  return NextResponse.json(
    {
      status,
      invoice_status: result.invoice_status ?? invoice.status,
      captured: capturedTotal,
      amount_due: roundMoney(Math.max(0, total - capturedTotal)),
      fully_paid: Boolean(result.fully_paid),
    },
    { status: status === 'COMPLETED' ? 200 : 202 }
  )
}
