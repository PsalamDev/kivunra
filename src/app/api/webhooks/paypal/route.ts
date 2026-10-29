import { NextRequest, NextResponse } from 'next/server'

import { apiError } from '@/lib/api-error'
import { isPayPalWebhookConfigured, verifyPayPalWebhookSignature } from '@/lib/paypal'
import { createAdminClient, isServiceRoleConfigured } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

interface PayPalWebhookEvent {
  id?: string
  event_type?: string
  resource?: {
    id?: string
    status?: string
    amount?: {
      currency_code?: string
      value?: string
    }
    supplementary_data?: {
      related_ids?: {
        order_id?: string
      }
    }
  }
}

const PERMANENT_RPC_ERRORS = new Set(['22023', 'P0002'])

/**
 * PayPal webhook receiver.
 *
 * Every delivery is persisted before it is acted on (for auditability and
 * idempotency). Signatures are verified with PayPal itself; unverified
 * payloads are recorded as Failed and never applied to an invoice.
 */
export async function POST(request: NextRequest) {
  if (!isServiceRoleConfigured()) {
    return apiError(503, 'Payments are not configured on this deployment.')
  }

  if (!isPayPalWebhookConfigured()) {
    return apiError(503, 'PayPal webhooks are not configured on this deployment.')
  }

  const rawBody = await request.text()
  let event: PayPalWebhookEvent

  try {
    event = JSON.parse(rawBody) as PayPalWebhookEvent
  } catch {
    return apiError(400, 'Invalid JSON payload')
  }

  if (!event.id || !event.event_type) {
    return apiError(400, 'Missing event id or type')
  }

  const admin = createAdminClient()

  const { data: inserted, error: insertError } = await admin
    .from('webhook_events')
    .insert({
      paypal_event_id: event.id,
      event_type: event.event_type,
      verification_status: 'Pending',
      raw_payload: event,
    })
    .select('id, processed_at')
    .maybeSingle()

  let eventRow = inserted as { id: string; processed_at: string | null } | null

  if (insertError) {
    if (insertError.code !== '23505') {
      console.error('[paypal webhook] could not persist event', insertError.code, insertError.message)
      return apiError(500, 'Could not record webhook event')
    }

    const { data: existing, error: fetchError } = await admin
      .from('webhook_events')
      .select('id, processed_at')
      .eq('paypal_event_id', event.id)
      .single()

    if (fetchError) {
      console.error('[paypal webhook] could not load duplicate event', fetchError.message)
      return apiError(500, 'Could not record webhook event')
    }

    eventRow = existing as { id: string; processed_at: string | null }
  }

  if (!eventRow) {
    return apiError(500, 'Could not record webhook event')
  }

  // Already handled: PayPal retries are acknowledged without reprocessing.
  if (eventRow.processed_at) {
    return NextResponse.json({ received: true, duplicate: true })
  }

  let verified = false

  try {
    verified = await verifyPayPalWebhookSignature(request.headers, event)
  } catch (error) {
    console.error('[paypal webhook] verification request failed', error)
    return apiError(502, 'Could not verify webhook signature')
  }

  if (!verified) {
    await admin
      .from('webhook_events')
      .update({ verification_status: 'Failed', processed_at: new Date().toISOString() })
      .eq('id', eventRow.id)

    return apiError(400, 'Invalid signature')
  }

  await admin
    .from('webhook_events')
    .update({ verification_status: 'Verified' })
    .eq('id', eventRow.id)

  const markProcessed = async () => {
    await admin
      .from('webhook_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('id', eventRow.id)
  }

  if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
    const resource = event.resource ?? {}
    const captureId = resource.id
    const orderId = resource.supplementary_data?.related_ids?.order_id
    const currency = (resource.amount?.currency_code ?? '').toUpperCase()
    const amount = Number(resource.amount?.value ?? Number.NaN)

    if (!captureId || !orderId || !Number.isFinite(amount) || amount <= 0) {
      console.error(
        '[paypal webhook] malformed capture event',
        event.id,
        JSON.stringify({ captureId, orderId, currency, amount })
      )
      await markProcessed()
      return NextResponse.json({ received: true })
    }

    const { data: order, error: orderError } = await admin
      .from('payment_orders')
      .select('invoice_id, expected_amount, currency')
      .eq('paypal_order_id', orderId)
      .maybeSingle()

    if (orderError) {
      console.error('[paypal webhook] order lookup failed', orderError.message)
      return apiError(500, 'Could not process webhook')
    }

    if (!order) {
      // The capture route records the order before it captures, so this means
      // the event is for an order Kivunra does not know about.
      console.error('[paypal webhook] unknown order for capture', event.id, orderId)
      await markProcessed()
      return NextResponse.json({ received: true })
    }

    const expectedAmount = Number(order.expected_amount ?? 0)

    if (
      String(order.currency).toUpperCase() !== currency ||
      Math.abs(expectedAmount - amount) > 0.01
    ) {
      console.error(
        '[paypal webhook] capture does not match order',
        event.id,
        orderId,
        `${amount} ${currency}`,
        `expected ${expectedAmount} ${String(order.currency).toUpperCase()}`
      )
      await markProcessed()
      return NextResponse.json({ received: true })
    }

    const { error: recordError } = await admin.rpc('record_payment_capture', {
      p_invoice_id: order.invoice_id,
      p_paypal_order_id: orderId,
      p_paypal_capture_id: captureId,
      p_amount: amount,
      p_currency: currency,
      p_status: resource.status ?? 'COMPLETED',
    })

    if (recordError) {
      console.error(
        '[paypal webhook] record capture failed',
        event.id,
        recordError.code,
        recordError.message
      )

      // Permanent failures (overpayment, deleted invoice) would loop forever.
      if (!PERMANENT_RPC_ERRORS.has(recordError.code ?? '')) {
        return apiError(500, 'Could not process webhook')
      }
    }
  }

  await markProcessed()

  return NextResponse.json({ received: true })
}
