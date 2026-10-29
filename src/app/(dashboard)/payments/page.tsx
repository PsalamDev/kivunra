import { redirect } from 'next/navigation'

import { InvoiceStatusBadge } from '@/components/invoice-status-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDate, formatMoney } from '@/lib/format'
import { sumByCurrency } from '@/lib/invoices'
import { createClient } from '@/lib/supabase/server'

interface PaymentOrder {
  id: string
  status: string
  expected_amount: number | string | null
  currency: string
  created_at: string
  invoices: {
    invoice_number: string
    customers: { name: string } | null
  } | null
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
    .from('payment_orders')
    .select('id, status, expected_amount, currency, created_at, invoices(invoice_number, customers(name))')
    .order('created_at', { ascending: false })
    .limit(100)

  const payments = (data ?? []) as unknown as PaymentOrder[]
  const captured = payments.filter((payment) => payment.status === 'Captured')
  const capturedTotals = sumByCurrency(
    captured.map((payment) => ({
      total: payment.expected_amount,
      currency: payment.currency,
    }))
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
              {captured.length} captured {captured.length === 1 ? 'payment' : 'payments'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-gray-500">Payment Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-[#12243A]">{payments.length}</p>
            <p className="text-sm text-gray-500 mt-2">Across all invoices</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-gray-500">Checkout</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600">
              PayPal checkout is the next milestone. Published invoices already have a secure
              public pay link on their detail page.
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
              Could not load payments. Make sure migration 002 has been applied.
            </p>
          ) : payments.length === 0 ? (
            <p className="text-gray-500">
              No payments yet. Once PayPal checkout is enabled, captured payments will appear here.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell className="font-medium">
                      {payment.invoices?.invoice_number ?? '—'}
                    </TableCell>
                    <TableCell>{payment.invoices?.customers?.name ?? '—'}</TableCell>
                    <TableCell>
                      {formatMoney(payment.currency, Number(payment.expected_amount ?? 0))}
                    </TableCell>
                    <TableCell>
                      <InvoiceStatusBadge status={payment.status} />
                    </TableCell>
                    <TableCell>{formatDate(payment.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
