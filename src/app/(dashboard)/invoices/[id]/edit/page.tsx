import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { InvoiceForm, type InvoiceFormItem } from '@/components/invoice-form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { netCapturedAmount } from '@/lib/payments'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface EditInvoice {
  id: string
  status: string
  currency: string
  due_at: string | null
  customer_id: string | null
  invoice_items: Array<{
    description: string
    quantity: number | string
    unit_price: number | string
    created_at: string
  }>
  payment_orders: Array<{
    payment_captures: Array<{
      amount: number | string | null
      status: string
      payment_refunds: Array<{
        amount: number | string | null
        status: string
      }> | null
    }> | null
  }> | null
}

/** Calendar date for an <input type="date">. */
function dateInputValue(value: string | null): string {
  if (!value) return ''

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

export default async function EditInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect(`/login?next=/invoices/${id}/edit`)
  }

  const [invoiceResult, customersResult] = await Promise.all([
    supabase
      .from('invoices')
      .select(
        'id, status, currency, due_at, customer_id, invoice_items(description, quantity, unit_price, created_at), payment_orders(payment_captures(amount, status, payment_refunds(amount, status)))'
      )
      .eq('id', id)
      .eq('owner_user_id', user.id)
      .maybeSingle(),
    supabase
      .from('customers')
      .select('id, name, email')
      .eq('owner_user_id', user.id)
      .order('name'),
  ])

  const invoice = invoiceResult.data as unknown as EditInvoice | null

  if (!invoice) {
    notFound()
  }

  const netCaptured = netCapturedAmount(invoice)
  const editable =
    netCaptured <= 0.01 && invoice.status !== 'Paid' && invoice.status !== 'Cancelled'

  if (!editable) {
    const reason =
      invoice.status === 'Paid'
        ? 'This invoice has been paid in full.'
        : invoice.status === 'Cancelled'
          ? 'This invoice has been cancelled.'
          : 'This invoice has payments recorded.'

    return (
      <main className="container mx-auto px-4 py-8">
        <Card className="mx-auto max-w-xl">
          <CardHeader>
            <CardTitle>This invoice can&apos;t be edited</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-gray-600">
              {reason} Refunds must be resolved from the invoice page before its items can change.
            </p>
            <Link href={`/invoices/${invoice.id}`}>
              <Button variant="outline">Back to invoice</Button>
            </Link>
          </CardContent>
        </Card>
      </main>
    )
  }

  const items: InvoiceFormItem[] = [...invoice.invoice_items]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((item) => ({
      description: item.description,
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
    }))

  return (
    <InvoiceForm
      mode="edit"
      invoiceId={invoice.id}
      customers={customersResult.data ?? []}
      initialCustomerId={invoice.customer_id}
      initialCurrency={invoice.currency}
      initialDueDate={dateInputValue(invoice.due_at)}
      initialItems={items}
      currencyLocked
      backHref={`/invoices/${invoice.id}`}
    />
  )
}
