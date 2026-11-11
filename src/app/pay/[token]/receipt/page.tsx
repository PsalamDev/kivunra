import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { InvoiceStatusBadge } from '@/components/invoice-status-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDate, formatMoney } from '@/lib/format'
import { getJournalName } from '@/lib/journal'
import {
  completedCapturedAmount,
  invoiceAmountDue,
  loadPublicInvoice,
  refundedAmount,
} from '@/lib/public-invoice'
import { isInvoiceTokenShape } from '@/lib/public-token'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Receipt | Kivunra',
  robots: { index: false, follow: false },
}

function Unavailable({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="container mx-auto px-4 max-w-lg">
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <h1 className="text-xl font-bold text-[#12243A] mb-2">Kivunra</h1>
          <p className="text-gray-600">{message}</p>
        </div>
      </div>
    </div>
  )
}

/**
 * Public receipt for an invoice paid through Kivunra.
 *
 * The token is the same hashed public token as the pay page, so anyone with
 * the invoice link can confirm what was paid and what was refunded.
 */
export default async function PublicReceiptPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  if (!isInvoiceTokenShape(token)) {
    notFound()
  }

  const loaded = await loadPublicInvoice(token)

  if (!loaded.ok) {
    if (loaded.reason === 'not_found') {
      notFound()
    }

    return (
      <Unavailable
        message={
          loaded.reason === 'not_configured'
            ? 'Payment links are not configured for this deployment yet.'
            : 'We could not load this invoice. Please try again later.'
        }
      />
    )
  }

  const invoice = loaded.invoice
  const journalName = await getJournalName(invoice.owner_user_id)

  if (invoice.status === 'Draft' || invoice.status === 'Cancelled') {
    notFound()
  }

  const captures = (invoice.payment_orders ?? [])
    .flatMap((order) => order.payment_captures ?? [])
    .filter((capture) => capture.status === 'COMPLETED')
    .sort((a, b) => {
      const left = a.captured_at ? new Date(a.captured_at).getTime() : 0
      const right = b.captured_at ? new Date(b.captured_at).getTime() : 0
      return left - right
    })

  if (captures.length === 0) {
    // Nothing has been paid yet, so there is no receipt to show.
    notFound()
  }

  const total = Number(invoice.total ?? 0)
  const capturedTotal = completedCapturedAmount(invoice)
  const refundedTotal = refundedAmount(invoice)
  const netPaid = Math.max(0, Math.round((capturedTotal - refundedTotal) * 100) / 100)
  const amountDue = invoiceAmountDue(invoice)

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4 max-w-2xl">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-[#12243A]">{journalName}</h1>
          <p className="text-sm text-gray-500">Payment receipt</p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex justify-between items-center gap-4">
              <div>
                <CardTitle className="text-lg">Receipt for {invoice.invoice_number}</CardTitle>
                <p className="text-sm text-gray-500 mt-1">
                  Invoice issued {formatDate(invoice.created_at)}
                </p>
              </div>
              <InvoiceStatusBadge status={invoice.status} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">Billed to</p>
                <p className="font-medium text-[#12243A]">
                  {invoice.customers?.name ?? 'Customer'}
                </p>
              </div>
              <div className="sm:text-right">
                <p className="text-xs uppercase tracking-wide text-gray-500">Status</p>
                <p className="font-medium text-[#12243A]">
                  {amountDue > 0.01 ? 'Partially paid' : 'Paid in full'}
                </p>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Payment</TableHead>
                  <TableHead className="text-right">Refunded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {captures.map((capture, index) => {
                  const refunded = (capture.payment_refunds ?? [])
                    .filter((refund) => refund.status === 'COMPLETED')
                    .reduce((sum, refund) => sum + Number(refund.amount ?? 0), 0)

                  return (
                    <TableRow key={capture.id ?? `capture-${index}`}>
                      <TableCell>{formatDate(capture.captured_at ?? null)}</TableCell>
                      <TableCell className="text-right">
                        {formatMoney(invoice.currency, Number(capture.amount ?? 0))}
                      </TableCell>
                      <TableCell className="text-right">
                        {refunded > 0
                          ? `−${formatMoney(invoice.currency, Math.round(refunded * 100) / 100)}`
                          : '—'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            <div className="mt-4 space-y-2 border-t pt-4">
              <div className="flex justify-between text-sm text-gray-600">
                <span>Invoice total</span>
                <span>{formatMoney(invoice.currency, total)}</span>
              </div>
              <div className="flex justify-between text-sm text-gray-600">
                <span>Payments received</span>
                <span>{formatMoney(invoice.currency, capturedTotal)}</span>
              </div>
              {refundedTotal > 0 && (
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Refunds</span>
                  <span>−{formatMoney(invoice.currency, refundedTotal)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold text-[#12243A]">
                <span>Net paid</span>
                <span>{formatMoney(invoice.currency, netPaid)}</span>
              </div>
              <div className="flex justify-between font-semibold text-[#12243A]">
                <span>Amount due</span>
                <span>{formatMoney(invoice.currency, amountDue)}</span>
              </div>
            </div>

            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href={`/api/pay/${token}/receipt`}
                className="inline-block rounded-lg bg-[#0EA58B] px-6 py-3 font-bold text-white hover:bg-[#0c9480]"
              >
                Download PDF
              </a>
              <a
                href={`/pay/${token}`}
                className="inline-block rounded-lg border border-gray-300 px-6 py-3 font-medium text-[#12243A] hover:bg-gray-50"
              >
                Back to invoice
              </a>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-gray-400 mt-6">Secured by Kivunra</p>
      </div>
    </div>
  )
}
