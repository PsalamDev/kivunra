import { redirect } from 'next/navigation'

import { PaymentStatusBadge } from '@/components/payment-status-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDate, formatMoney } from '@/lib/format'
import { sumByCurrency } from '@/lib/invoices'
import { createClient } from '@/lib/supabase/server'

interface CaptureInvoice {
  invoice_number: string
  customers: { name: string } | null
}

interface PaymentCapture {
  id: string
  amount: number | string | null
  currency: string
  status: string
  captured_at: string
  payment_orders:
    | {
        paypal_order_id: string | null
        invoices: CaptureInvoice | CaptureInvoice[] | null
      }
    | Array<{
        paypal_order_id: string | null
        invoices: CaptureInvoice | CaptureInvoice[] | null
      }>
    | null
}

function normaliseOrder(row: PaymentCapture) {
  const order = Array.isArray(row.payment_orders) ? row.payment_orders[0] : row.payment_orders
  const invoice = Array.isArray(order?.invoices) ? order?.invoices[0] : order?.invoices
  return { order: order ?? null, invoice: invoice ?? null }
}

export default async function PaymentsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data, error } = await supabase
    .from('payment_captures')
    .select(
      'id, amount, currency, status, captured_at, payment_orders(paypal_order_id, invoices(invoice_number, customers(name)))'
    )
    .order('captured_at', { ascending: false })
    .limit(100)

  const captures = (data ?? []) as unknown as PaymentCapture[]
  const completed = captures.filter((capture) => capture.status === 'COMPLETED')
  const pending = captures.filter((capture) => capture.status === 'PENDING')

  const capturedTotals = sumByCurrency(
    completed.map((capture) => ({ total: capture.amount, currency: capture.currency }))
  )

  return (
    <main className="container mx-auto px-4 py-8">
      <h2 className="text-2xl font-bold text-[#12243A] mb-6">Payments</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-gray-500">Captured</CardTitle>
          </CardHeader>
          <CardContent>
            {capturedTotals.length === 0 ? (
              <p className="text-2xl font-bold text-[#12243A]">—</p>
            ) : (
              <div className="space-y-1">
                {capturedTotals.map(([currency, amount]) => (
                  <p key={currency} className="text-2xl font-bold text-[#12243A]">
                    {formatMoney(currency, amount)}
                  </p>
                ))}
              </div>
            )}
            <p className="text-sm text-gray-500 mt-2">
              {completed.length} completed {completed.length === 1 ? 'payment' : 'payments'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-gray-500">Pending</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-[#12243A]">{pending.length}</p>
            <p className="text-sm text-gray-500 mt-2">
              Waiting for PayPal confirmation
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-gray-500">Checkout</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600">
              PayPal checkout is live on published invoices. Share an invoice&apos;s pay link
              to collect card or PayPal payments.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Payment History</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-red-700">
              Could not load payments. Make sure migration 003 has been applied.
            </p>
          ) : captures.length === 0 ? (
            <p className="text-gray-500">
              No payments yet. Captured PayPal payments will appear here.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Captured</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {captures.map((capture) => {
                  const { invoice } = normaliseOrder(capture)

                  return (
                    <TableRow key={capture.id}>
                      <TableCell className="font-medium">
                        {invoice?.invoice_number ?? '—'}
                      </TableCell>
                      <TableCell>{invoice?.customers?.name ?? '—'}</TableCell>
                      <TableCell>
                        {formatMoney(capture.currency, Number(capture.amount ?? 0))}
                      </TableCell>
                      <TableCell>
                        <PaymentStatusBadge status={capture.status} />
                      </TableCell>
                      <TableCell>{formatDate(capture.captured_at)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
