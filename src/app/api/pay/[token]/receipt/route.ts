import { NextRequest, NextResponse } from 'next/server'

import { apiError } from '@/lib/api-error'
import { getJournalName } from '@/lib/journal'
import { buildReceiptPdf } from '@/lib/receipt-pdf'
import { loadPublicInvoice, type PublicInvoiceCapture } from '@/lib/public-invoice'
import { isInvoiceTokenShape } from '@/lib/public-token'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ token: string }> }

/**
 * Public PDF receipt for a paid invoice. Protected by the same capability token
 * as the pay page, so both the customer and the owner use the same link.
 */
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { token } = await params

  if (!isInvoiceTokenShape(token)) {
    return apiError(404, 'Receipt not found')
  }

  const loaded = await loadPublicInvoice(token)

  if (!loaded.ok) {
    if (loaded.reason === 'not_found') {
      return apiError(404, 'Receipt not found')
    }

    if (loaded.reason === 'not_configured') {
      return apiError(503, 'Receipts are not configured on this deployment.')
    }

    return apiError(502, 'Could not load this invoice. Please try again later.')
  }

  const invoice = loaded.invoice

  if (invoice.status === 'Draft' || invoice.status === 'Cancelled') {
    return apiError(404, 'Receipt not found')
  }

  const captures = (invoice.payment_orders ?? [])
    .flatMap((order) => order.payment_captures ?? [])
    .filter((capture) => capture.status === 'COMPLETED')
    .sort((a, b) => {
      const left = a.captured_at ? new Date(a.captured_at).getTime() : 0
      const right = b.captured_at ? new Date(b.captured_at).getTime() : 0
      return left - right
    }) as PublicInvoiceCapture[]

  if (captures.length === 0) {
    return apiError(404, 'No receipt is available until a payment is confirmed.')
  }

  try {
    const journalName = await getJournalName(invoice.owner_user_id)
    const pdf = await buildReceiptPdf({ journalName, invoice, captures })
    const fileName = `Receipt-${invoice.invoice_number.replace(/[^A-Za-z0-9._-]/g, '')}.pdf`

    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    console.error('[receipt-pdf] build failed', error)
    return apiError(500, 'Could not build the receipt PDF. Please try again later.')
  }
}
