import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { InvoiceStatusBadge } from '@/components/invoice-status-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDate, formatMoney } from '@/lib/format'
import { isPayPalConfigured, isPayPalCurrency } from '@/lib/paypal'
import {
  completedCapturedAmount,
  invoiceAmountDue,
  loadPublicInvoice,
} from '@/lib/public-invoice'
import { isInvoiceTokenShape } from '@/lib/public-token'

import { PayPalCheckout } from './paypal-checkout'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Invoice | Kivunra',
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

export default async function PublicInvoicePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  // Reject anything that cannot be one of our tokens before touching the DB.
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

  if (invoice.status === 'Draft' || invoice.status === 'Cancelled') {
    notFound()
  }

  const items = invoice.invoice_items ?? []
  const total = Number(invoice.total ?? 0)
  const paidToDate = completedCapturedAmount(invoice)
  const amountDue = invoiceAmountDue(invoice)
  const isPaid = invoice.status === 'Paid' || amountDue <= 0.01
  const currency = invoice.currency.toUpperCase()

  const paypalClientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID
  const canPayWithPayPal =
    !isPaid && isPayPalConfigured() && Boolean(paypalClientId) && isPayPalCurrency(currency)

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4 max-w-2xl">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-[#12243A]">Kivunra</h1>
          <p className="text-sm text-gray-500">Move Smarter. Manage Better.</p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex justify-between items-center gap-4">
              <div>
                <CardTitle className="text-lg">Invoice {invoice.invoice_number}</CardTitle>
                <p className="text-sm text-gray-500 mt-1">Issued {formatDate(invoice.created_at)}</p>
              </div>
              <InvoiceStatusBadge status={invoice.status} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">Billed to</p>
                <p className="font-medium text-[#12243A]">{invoice.customers?.name ?? 'Customer'}</p>
              </div>
              <div className="sm:text-right">
                <p className="text-xs uppercase tracking-wide text-gray-500">Due</p>
                <p className="font-medium text-[#12243A]">{formatDate(invoice.due_at)}</p>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit price</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, index) => (
                  <TableRow key={`${item.description}-${index}`}>
                    <TableCell className="whitespace-normal">{item.description}</TableCell>
                    <TableCell className="text-right">{Number(item.quantity)}</TableCell>
                    <TableCell className="text-right">
                      {formatMoney(invoice.currency, Number(item.unit_price))}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatMoney(invoice.currency, Number(item.line_total))}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={3} className="text-right font-bold">
                    Invoice total
                  </TableCell>
                  <TableCell className="text-right font-bold">
                    {formatMoney(invoice.currency, total)}
                  </TableCell>
                </TableRow>
                {paidToDate > 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-right text-gray-600">
                      Paid to date
                    </TableCell>
                    <TableCell className="text-right text-gray-600">
                      −{formatMoney(invoice.currency, paidToDate)}
                    </TableCell>
                  </TableRow>
                )}
                <TableRow>
                  <TableCell colSpan={3} className="text-right font-bold">
                    Amount due
                  </TableCell>
                  <TableCell className="text-right font-bold">
                    {formatMoney(invoice.currency, amountDue)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>

            {isPaid ? (
              <div className="mt-6 rounded-lg bg-green-50 p-4 text-center">
                <p className="text-green-700 font-medium">Paid in full — thank you.</p>
              </div>
            ) : canPayWithPayPal && paypalClientId ? (
              <PayPalCheckout
                token={token}
                clientId={paypalClientId}
                currency={currency}
                amountLabel={formatMoney(invoice.currency, amountDue)}
              />
            ) : (
              <div className="mt-6 rounded-lg bg-gray-50 p-4 text-center">
                <p className="text-gray-600 text-sm">
                  {isPayPalCurrency(currency)
                    ? 'Online payment is not enabled yet. Please contact the sender to arrange payment.'
                    : `Online card payment is not available for ${invoice.currency} invoices. Please contact the sender to arrange payment.`}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-gray-400 mt-6">Secured by Kivunra</p>
      </div>
    </div>
  )
}
