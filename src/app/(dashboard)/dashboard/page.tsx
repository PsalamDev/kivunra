import Link from 'next/link'
import { redirect } from 'next/navigation'

import { InvoiceStatusBadge } from '@/components/invoice-status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDate, formatMoney } from '@/lib/format'
import { sumByCurrency } from '@/lib/invoices'
import { createClient } from '@/lib/supabase/server'

interface DashboardInvoice {
  id: string
  invoice_number: string
  status: string
  total: number | string | null
  currency: string
  due_at: string | null
  created_at: string
  customers: { name: string } | null
}

const OUTSTANDING_STATUSES = ['Published', 'PartiallyPaid', 'Overdue']

function Totals({ rows }: { rows: DashboardInvoice[] }) {
  const totals = sumByCurrency(rows)

  if (totals.length === 0) {
    return <p className="text-2xl font-bold text-[#12243A]">—</p>
  }

  return (
    <div className="space-y-1">
      {totals.map(([currency, amount]) => (
        <p key={currency} className="text-2xl font-bold text-[#12243A]">
          {formatMoney(currency, amount)}
        </p>
      ))}
    </div>
  )
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, status, total, currency, due_at, created_at, customers(name)')
    .eq('owner_user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    return (
      <main className="container mx-auto px-4 py-8">
        <h2 className="text-2xl font-bold text-[#12243A] mb-6">Dashboard</h2>
        <Card>
          <CardContent className="pt-6">
            <p className="text-red-700">Could not load your dashboard. Please refresh and try again.</p>
          </CardContent>
        </Card>
      </main>
    )
  }

  const invoices = (data ?? []) as unknown as DashboardInvoice[]
  const paid = invoices.filter((invoice) => invoice.status === 'Paid')
  const outstanding = invoices.filter((invoice) => OUTSTANDING_STATUSES.includes(invoice.status))
  const drafts = invoices.filter((invoice) => invoice.status === 'Draft')
  const recent = invoices.slice(0, 5)

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-[#12243A]">Dashboard</h2>
        <Link href="/invoices/new">
          <Button className="bg-[#0EA58B] hover:bg-[#0c9479]">Create Invoice</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-gray-500">Collected</CardTitle>
          </CardHeader>
          <CardContent>
            <Totals rows={paid} />
            <p className="text-sm text-gray-500 mt-2">
              {paid.length} paid {paid.length === 1 ? 'invoice' : 'invoices'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-gray-500">Outstanding</CardTitle>
          </CardHeader>
          <CardContent>
            <Totals rows={outstanding} />
            <p className="text-sm text-gray-500 mt-2">
              {outstanding.length} open {outstanding.length === 1 ? 'invoice' : 'invoices'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-gray-500">Drafts</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-[#12243A]">{drafts.length}</p>
            <p className="text-sm text-gray-500 mt-2">
              {invoices.length} {invoices.length === 1 ? 'invoice' : 'invoices'} total
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Recent Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-gray-500">
              No invoices yet. Create your first invoice to get started.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-medium">{invoice.invoice_number}</TableCell>
                    <TableCell>{invoice.customers?.name ?? '—'}</TableCell>
                    <TableCell>{formatMoney(invoice.currency, Number(invoice.total ?? 0))}</TableCell>
                    <TableCell>
                      <InvoiceStatusBadge status={invoice.status} />
                    </TableCell>
                    <TableCell>{formatDate(invoice.due_at)}</TableCell>
                    <TableCell>
                      <Link href={`/invoices/${invoice.id}`}>
                        <Button variant="ghost" size="sm">View</Button>
                      </Link>
                    </TableCell>
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
