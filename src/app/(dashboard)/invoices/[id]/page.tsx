'use client'

import { useState, useEffect, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDate, formatMoney } from '@/lib/format'

interface InvoiceItem {
  id: string
  description: string
  quantity: number
  unit_price: number
  line_total: number
}

interface PaymentRefund {
  amount: number | string | null
  currency: string
  status: string
  refunded_at: string | null
}

interface PaymentCapture {
  id: string
  amount: number | string | null
  currency: string
  status: string
  captured_at: string
  payment_refunds: PaymentRefund[] | null
}

interface PaymentOrder {
  paypal_order_id: string | null
  status: string
  expected_amount: number | string | null
  currency: string
  created_at: string
  payment_captures: PaymentCapture[] | null
}

interface Invoice {
  id: string
  invoice_number: string
  total: number
  currency: string
  status: string
  due_at: string | null
  created_at: string
  public_url: string | null
  customers?: { name: string; email: string } | null
  invoice_items: InvoiceItem[]
  payment_orders?: PaymentOrder[] | null
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

/** Captured, refunded and still-owed totals for an invoice. */
function paymentTotals(invoice: Invoice) {
  let captured = 0
  let refunded = 0

  for (const order of invoice.payment_orders ?? []) {
    for (const capture of order.payment_captures ?? []) {
      const amount = Number(capture.amount ?? 0)
      if (capture.status === 'COMPLETED' && Number.isFinite(amount)) {
        captured += amount
      }

      for (const refund of capture.payment_refunds ?? []) {
        const refundAmount = Number(refund.amount ?? 0)
        if (refund.status === 'COMPLETED' && Number.isFinite(refundAmount)) {
          refunded += refundAmount
        }
      }
    }
  }

  captured = roundMoney(captured)
  refunded = roundMoney(refunded)
  const net = roundMoney(captured - refunded)
  const total = Number(invoice.total ?? 0)
  const due = invoice.status === 'Paid' ? 0 : roundMoney(Math.max(0, total - net))

  return { captured, refunded, net, due }
}

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [emailing, setEmailing] = useState(false)
  const [emailStatus, setEmailStatus] = useState<string | null>(null)
  const [emailError, setEmailError] = useState<string | null>(null)

  const fetchInvoice = useCallback(async () => {
    try {
      const res = await fetch(`/api/invoices/${id}`)
      const data = await res.json()
      if (data.invoice) {
        setInvoice(data.invoice)
      }
    } catch (error) {
      console.error('Error fetching invoice:', error)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    fetchInvoice()
  }, [fetchInvoice])

  const publishInvoice = async () => {
    setPublishing(true)
    setPublishError(null)
    try {
      const res = await fetch(`/api/invoices/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Published' }),
      })

      if (res.ok) {
        fetchInvoice()
      } else {
        const data = await res.json().catch(() => null)
        setPublishError(data?.error || 'Failed to publish invoice')
      }
    } catch (error) {
      console.error('Error publishing invoice:', error)
      setPublishError('Failed to publish invoice')
    } finally {
      setPublishing(false)
    }
  }

  const cancelInvoice = async () => {
    if (!window.confirm('Cancel this invoice? Your customer will no longer be able to pay it.')) {
      return
    }

    setCancelling(true)
    setActionError(null)

    try {
      const res = await fetch(`/api/invoices/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Cancelled' }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setActionError(data?.error || 'Failed to cancel invoice')
        return
      }

      await fetchInvoice()
    } catch (error) {
      console.error('Error cancelling invoice:', error)
      setActionError('Failed to cancel invoice')
    } finally {
      setCancelling(false)
    }
  }

  const deleteInvoice = async () => {
    if (!window.confirm('Delete this invoice permanently? This cannot be undone.')) {
      return
    }

    setDeleting(true)
    setActionError(null)

    try {
      const res = await fetch(`/api/invoices/${id}`, { method: 'DELETE' })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setActionError(data?.error || 'Failed to delete invoice')
        return
      }

      router.push('/invoices')
      router.refresh()
    } catch (error) {
      console.error('Error deleting invoice:', error)
      setActionError('Failed to delete invoice')
    } finally {
      setDeleting(false)
    }
  }

  const emailInvoice = async () => {
    setEmailing(true)
    setEmailStatus(null)
    setEmailError(null)

    try {
      const res = await fetch(`/api/invoices/${id}/email`, { method: 'POST' })
      const data = await res.json().catch(() => null)

      if (!res.ok) {
        setEmailError(data?.error || 'Could not send the invoice email')
        return
      }

      setEmailStatus(`Sent to ${data?.to ?? 'the customer'}`)
    } catch (error) {
      console.error('Error emailing invoice:', error)
      setEmailError('Could not send the invoice email')
    } finally {
      setEmailing(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Paid':
        return 'bg-green-100 text-green-800'
      case 'Published':
        return 'bg-blue-100 text-blue-800'
      case 'Overdue':
        return 'bg-red-100 text-red-800'
      case 'Draft':
        return 'bg-gray-100 text-gray-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  if (loading) {
    return (
      <main className="container mx-auto px-4 py-8">
        <p>Loading...</p>
      </main>
    )
  }

  if (!invoice) {
    return (
      <main className="container mx-auto px-4 py-8">
        <p>Invoice not found</p>
      </main>
    )
  }

  const totals = paymentTotals(invoice)
  const captures = (invoice.payment_orders ?? []).flatMap(
    (order) => order.payment_captures ?? []
  )
  const isClosed = invoice.status === 'Paid' || invoice.status === 'Cancelled'
  const canEdit = totals.net <= 0.01 && !isClosed
  const canCancel = totals.net <= 0.01 && invoice.status !== 'Draft' && !isClosed
  const canDelete = totals.net <= 0.01 && invoice.status !== 'Paid'

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-[#12243A]">{invoice.invoice_number}</h2>
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(invoice.status)}`}>
            {invoice.status}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => router.push('/invoices')}>
            Back to Invoices
          </Button>
          {canEdit && (
            <Button
              variant="outline"
              onClick={() => router.push(`/invoices/${invoice.id}/edit`)}
            >
              Edit Invoice
            </Button>
          )}
          {invoice.status === 'Draft' && (
            <Button onClick={publishInvoice} disabled={publishing} className="bg-[#0EA58B] hover:bg-[#0c9479]">
              {publishing ? 'Publishing...' : 'Publish Invoice'}
            </Button>
          )}
          {canCancel && (
            <Button variant="outline" onClick={cancelInvoice} disabled={cancelling}>
              {cancelling ? 'Cancelling...' : 'Cancel Invoice'}
            </Button>
          )}
          {canDelete && (
            <Button
              variant="outline"
              onClick={deleteInvoice}
              disabled={deleting}
              className="text-red-600 hover:text-red-700"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          )}
        </div>
      </div>
      {publishError && (
        <div className="mb-6 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {publishError}
        </div>
      )}
      {actionError && (
        <div
          role="alert"
          className="mb-6 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {actionError}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader>
            <CardTitle>Bill To</CardTitle>
          </CardHeader>
          <CardContent>
            {invoice.customers ? (
              <div>
                <p className="font-medium">{invoice.customers.name}</p>
                {invoice.customers.email && <p className="text-gray-600">{invoice.customers.email}</p>}
              </div>
            ) : (
              <p className="text-gray-500">No customer</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invoice Info</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <p><span className="text-gray-600">Created:</span> {new Date(invoice.created_at).toLocaleDateString()}</p>
              {invoice.due_at && <p><span className="text-gray-600">Due Date:</span> {new Date(invoice.due_at).toLocaleDateString()}</p>}
              <p><span className="text-gray-600">Currency:</span> {invoice.currency}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Payment Summary</CardTitle>
            {invoice.public_url && captures.length > 0 && (
              <a
                href={`${invoice.public_url}/receipt`}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-[#0EA58B] hover:underline"
              >
                View receipt
              </a>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <p className="text-sm text-gray-500">Captured</p>
              <p className="text-lg font-semibold text-[#12243A]">
                {formatMoney(invoice.currency, totals.captured)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Refunded</p>
              <p className="text-lg font-semibold text-[#12243A]">
                {formatMoney(invoice.currency, totals.refunded)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Amount due</p>
              <p className="text-lg font-semibold text-[#12243A]">
                {formatMoney(invoice.currency, totals.due)}
              </p>
            </div>
          </div>

          {captures.length === 0 ? (
            <p className="text-gray-500">No payments captured yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Captured</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Refunded</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {captures.map((capture) => {
                  const refunded = (capture.payment_refunds ?? [])
                    .filter((refund) => refund.status === 'COMPLETED')
                    .reduce((sum, refund) => sum + Number(refund.amount ?? 0), 0)

                  return (
                    <TableRow key={capture.id}>
                      <TableCell>{formatDate(capture.captured_at)}</TableCell>
                      <TableCell className="text-right">
                        {formatMoney(capture.currency, Number(capture.amount ?? 0))}
                      </TableCell>
                      <TableCell className="text-right">
                        {refunded > 0 ? formatMoney(capture.currency, roundMoney(refunded)) : '—'}
                      </TableCell>
                      <TableCell>{capture.status}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.invoice_items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.description}</TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right">
                    {invoice.currency} {item.unit_price.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right">
                    {invoice.currency} {item.line_total.toFixed(2)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={3} className="text-right font-bold">Total</TableCell>
                <TableCell className="text-right font-bold">
                  {invoice.currency} {invoice.total.toFixed(2)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {invoice.public_url && invoice.status !== 'Cancelled' && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Payment</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600 mb-4">Share this secure link with your customer:</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input value={invoice.public_url} readOnly />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    if (invoice.public_url) {
                      navigator.clipboard.writeText(invoice.public_url)
                    }
                  }}
                >
                  Copy Link
                </Button>
                {!isClosed && (
                  <Button
                    onClick={emailInvoice}
                    disabled={emailing || !invoice.customers?.email}
                    title={
                      invoice.customers?.email
                        ? undefined
                        : 'Add an email address to this customer first'
                    }
                  >
                    {emailing ? 'Sending...' : 'Email Invoice'}
                  </Button>
                )}
              </div>
            </div>
            {emailStatus && (
              <p className="mt-3 text-sm text-green-700">{emailStatus}</p>
            )}
            {emailError && <p className="mt-3 text-sm text-red-700">{emailError}</p>}
            {!isClosed && !invoice.customers?.email && (
              <p className="mt-3 text-sm text-gray-500">
                Add an email address to this customer to send the invoice.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  )
}
