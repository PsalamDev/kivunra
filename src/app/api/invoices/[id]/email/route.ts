import { NextRequest, NextResponse } from 'next/server'

import { apiError, databaseErrorResponse } from '@/lib/api-error'
import { EmailDeliveryError, isEmailConfigured, sendInvoiceEmail } from '@/lib/email'
import { INVOICE_DETAIL_SELECT, serializeInvoice } from '@/lib/invoices'
import { invoiceSenderName } from '@/lib/journal'
import { createClient } from '@/lib/supabase/server'

type RouteContext = { params: Promise<{ id: string }> }

interface RefundRow {
  amount: number | string | null
  status: string
}

interface CaptureRow {
  amount: number | string | null
  status: string
  payment_refunds: RefundRow[] | null
}

interface OrderRow {
  payment_captures: CaptureRow[] | null
}

interface InvoiceRow {
  [key: string]: unknown
  id: string
  invoice_number: string
  total: number | string | null
  currency: string
  status: string
  due_at: string | null
  public_token_hash?: string | null
  customers?: { name?: string | null; email?: string | null } | null
  invoice_items?: Array<{
    description: string
    quantity: number | string
    line_total: number | string | null
  }> | null
  payment_orders?: OrderRow[] | null
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

/** Net amount the customer has paid: completed captures minus completed refunds. */
function netCaptured(invoice: InvoiceRow): number {
  let net = 0

  for (const order of invoice.payment_orders ?? []) {
    for (const capture of order.payment_captures ?? []) {
      const amount = Number(capture.amount ?? 0)
      if (capture.status === 'COMPLETED' && Number.isFinite(amount)) {
        net += amount
      }

      for (const refund of capture.payment_refunds ?? []) {
        const refundAmount = Number(refund.amount ?? 0)
        if (refund.status === 'COMPLETED' && Number.isFinite(refundAmount)) {
          net -= refundAmount
        }
      }
    }
  }

  return roundMoney(net)
}

/**
 * Emails the customer the public pay link for an invoice.
 *
 * The link is derived server-side from the invoice id and INVOICE_TOKEN_SECRET;
 * the browser never supplies a URL or an amount.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return apiError(401, 'Unauthorized')
  }

  if (!isEmailConfigured()) {
    return apiError(503, 'Email sending is not configured on this deployment.')
  }

  const { data, error } = await supabase
    .from('invoices')
    .select(INVOICE_DETAIL_SELECT)
    .eq('id', id)
    .eq('owner_user_id', user.id)
    .maybeSingle()

  if (error) {
    return databaseErrorResponse(error)
  }

  if (!data) {
    return apiError(404, 'Invoice not found')
  }

  const invoice = serializeInvoice(
    data as unknown as InvoiceRow,
    process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin
  ) as unknown as InvoiceRow & { public_url: string | null }

  if (invoice.status === 'Draft' || invoice.status === 'Cancelled') {
    return apiError(400, 'Publish the invoice before emailing it.')
  }

  if (!invoice.public_url) {
    return apiError(400, 'The public pay link is not available for this invoice.')
  }

  const customerEmail = invoice.customers?.email?.trim()
  if (!customerEmail) {
    return apiError(400, 'Add an email address to this customer before sending the invoice.')
  }

  const total = Number(invoice.total ?? 0)
  const amountDue = roundMoney(Math.max(0, total - netCaptured(invoice)))

  if (amountDue <= 0) {
    return apiError(400, 'This invoice is already paid in full.')
  }

  const senderName = invoiceSenderName(user.user_metadata)

  let messageId: string | null = null

  try {
    messageId = await sendInvoiceEmail({
      to: customerEmail,
      customerName: invoice.customers?.name ?? null,
      invoiceNumber: invoice.invoice_number,
      currency: invoice.currency,
      amountDue,
      dueAt: invoice.due_at,
      payUrl: invoice.public_url,
      senderName,
      replyTo: user.email ?? null,
      items: invoice.invoice_items ?? [],
    })
  } catch (sendError) {
    if (sendError instanceof EmailDeliveryError) {
      return apiError(sendError.status, sendError.message)
    }

    console.error('[invoice email] send failed', sendError)
    return apiError(502, 'Could not send the invoice email. Please try again.')
  }

  return NextResponse.json({ sent: true, to: customerEmail, id: messageId })
}
