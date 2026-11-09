import Link from 'next/link'
import { redirect } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { markOverdueInvoices } from '@/lib/overdue'
import { createClient } from '@/lib/supabase/server'

import { BillingCalendarLoader } from './billing-calendar-loader'
import type { BillingCalendarInvoice, BillingCalendarPayment } from './types'

interface CustomerJoin {
  name: string
}

interface InvoiceRow {
  id: string
  invoice_number: string
  status: string
  total: number | string | null
  currency: string
  due_at: string | null
  customers: CustomerJoin | CustomerJoin[] | null
}

interface CaptureInvoiceJoin {
  id: string
  invoice_number: string
  customers: CustomerJoin | CustomerJoin[] | null
}

interface CaptureOrderJoin {
  invoice_id: string
  invoices: CaptureInvoiceJoin | CaptureInvoiceJoin[] | null
}

interface CaptureRow {
  id: string
  amount: number | string | null
  currency: string
  captured_at: string
  payment_orders: CaptureOrderJoin | CaptureOrderJoin[] | null
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

const LEGEND = [
  { label: 'Published', className: 'bg-blue-500' },
  { label: 'Partially paid', className: 'bg-amber-500' },
  { label: 'Overdue', className: 'bg-red-500' },
  { label: 'Paid', className: 'bg-green-500' },
  { label: 'Draft', className: 'bg-gray-400' },
  { label: 'PayPal payment', className: 'bg-teal-500' },
]

export default async function CalendarPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  await markOverdueInvoices(supabase, user.id)

  const [invoiceResult, captureResult] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, invoice_number, status, total, currency, due_at, customers(name)')
      .eq('owner_user_id', user.id)
      .not('due_at', 'is', null)
      .order('due_at', { ascending: true })
      .limit(500),
    supabase
      .from('payment_captures')
      .select(
        'id, amount, currency, captured_at, payment_orders(invoice_id, invoices(id, invoice_number, customers(name)))'
      )
      .eq('status', 'COMPLETED')
      .order('captured_at', { ascending: false })
      .limit(500),
  ])

  const invoiceRows = (invoiceResult.data ?? []) as unknown as InvoiceRow[]
  const captureRows = (captureResult.data ?? []) as unknown as CaptureRow[]

  const invoices: BillingCalendarInvoice[] = invoiceRows.flatMap((row) => {
    if (!row.due_at) return []
    const customer = firstOf(row.customers)

    return [
      {
        id: row.id,
        invoice_number: row.invoice_number,
        status: row.status,
        total: Number(row.total ?? 0),
        currency: row.currency,
        due_at: row.due_at,
        customer_name: customer?.name ?? null,
      },
    ]
  })

  const payments: BillingCalendarPayment[] = captureRows.flatMap((row) => {
    const order = firstOf(row.payment_orders)
    const invoice = firstOf(order?.invoices)
    if (!order || !invoice) return []
    const customer = firstOf(invoice.customers)

    return [
      {
        id: row.id,
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        amount: Number(row.amount ?? 0),
        currency: row.currency,
        captured_at: row.captured_at,
        customer_name: customer?.name ?? null,
      },
    ]
  })

  const error = invoiceResult.error ?? captureResult.error
  const isEmpty = invoices.length === 0 && payments.length === 0

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-[#12243A]">Billing Calendar</h2>
          <p className="text-sm text-gray-500 mt-1">
            Invoice due dates and completed PayPal payments. Click an event to open its invoice.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {LEGEND.map((item) => (
            <span key={item.label} className="inline-flex items-center gap-1.5 text-xs text-gray-600">
              <span className={`h-2.5 w-2.5 rounded-full ${item.className}`} />
              {item.label}
            </span>
          ))}
        </div>
      </div>

      {error ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-red-700">
              Could not load your billing calendar. Please refresh and try again.
            </p>
          </CardContent>
        </Card>
      ) : isEmpty ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-gray-500">
              No invoices with due dates or completed payments yet.{' '}
              <Link href="/invoices/new" className="text-[#0EA58B] hover:underline">
                Create an invoice
              </Link>{' '}
              to see it on the calendar.
            </p>
          </CardContent>
        </Card>
      ) : (
        <BillingCalendarLoader invoices={invoices} payments={payments} />
      )}

      {!error && !isEmpty && (
        <div className="mt-6">
          <Link href="/invoices">
            <Button variant="outline">View all invoices</Button>
          </Link>
        </div>
      )}
    </main>
  )
}
