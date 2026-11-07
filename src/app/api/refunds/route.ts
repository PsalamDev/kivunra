import { NextRequest, NextResponse } from 'next/server'

import { apiError, databaseErrorResponse } from '@/lib/api-error'
import { isPayPalConfigured, PayPalApiError, refundPayPalCapture } from '@/lib/paypal'
import { applyRefundSchema } from '@/lib/refunds'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface CaptureRow {
  id: string
  paypal_capture_id: string
  amount: number | string | null
  currency: string
  status: string
}

/**
 * Issues a full or partial refund of a captured payment.
 *
 * The owner asks PayPal for the refund first; the result is then recorded
 * atomically (refund row, ledger entry, invoice status, notification).
 * Retries are safe: PayPal refund ids are unique and the RPC is idempotent.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return apiError(401, 'Unauthorized')
  }

  if (!isPayPalConfigured()) {
    return apiError(503, 'Refunds are not configured on this deployment.')
  }

  const body = await request.json().catch(() => null)
  const parsed = applyRefundSchema.safeParse(body)

  if (!parsed.success) {
    return apiError(400, 'Invalid refund request', { issues: parsed.error.issues })
  }

  const { capture_id, amount, reason } = parsed.data

  const { data: captureData, error: captureError } = await supabase
    .from('payment_captures')
    .select('id, paypal_capture_id, amount, currency, status')
    .eq('id', capture_id)
    .maybeSingle()

  if (captureError) {
    return databaseErrorResponse(captureError)
  }

  const capture = captureData as CaptureRow | null

  if (!capture) {
    return apiError(404, 'Payment not found')
  }

  if (capture.status !== 'COMPLETED') {
    return apiError(409, 'Only completed payments can be refunded.')
  }

  const currency = capture.currency.toUpperCase()
  const capturedAmount = Number(capture.amount ?? 0)

  let refundAmount = capturedAmount

  if (amount !== undefined) {
    refundAmount = Math.round(amount * 100) / 100

    if (refundAmount <= 0 || refundAmount > capturedAmount + 0.01) {
      return apiError(400, `Refund amount must be between 0.00 and ${capturedAmount.toFixed(2)}.`)
    }
  }

  let refund

  try {
    refund = await refundPayPalCapture({
      captureId: capture.paypal_capture_id,
      amount: refundAmount,
      currency,
    })
  } catch (error) {
    if (error instanceof PayPalApiError) {
      console.error('[refunds] PayPal refund failed', error.status, error.message, error.debugId ?? '')

      if (error.status === 404) {
        return apiError(404, 'That payment could not be found at PayPal.')
      }
      if (error.status === 422) {
        return apiError(409, 'PayPal refused the refund. It may already be refunded.')
      }
    } else {
      console.error('[refunds] PayPal refund failed', error)
    }

    return apiError(502, 'Could not request the refund from PayPal. Please try again.')
  }

  if (!refund.id) {
    console.error('[refunds] PayPal refund response had no id', capture.paypal_capture_id)
    return apiError(502, 'PayPal did not confirm the refund. Check the Payments page before retrying.')
  }

  const admin = createAdminClient()
  const { data, error: recordError } = await admin.rpc('apply_payment_refund', {
    p_paypal_capture_id: capture.paypal_capture_id,
    p_paypal_refund_id: refund.id,
    p_amount: refundAmount,
    p_currency: currency,
    p_status: refund.status || 'COMPLETED',
    p_reason: reason ?? null,
  })

  if (recordError) {
    console.error('[refunds] record refund failed', recordError.code, recordError.message)
    return databaseErrorResponse(recordError)
  }

  return NextResponse.json(
    {
      refund: {
        paypal_refund_id: refund.id,
        status: refund.status || 'COMPLETED',
        amount: refundAmount,
        currency,
      },
      invoice_status: (data as { invoice_status?: string } | null)?.invoice_status ?? null,
    },
    { status: 201 }
  )
}
