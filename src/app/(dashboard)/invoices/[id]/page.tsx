'use client'

import { useState, useEffect, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface InvoiceItem {
  id: string
  description: string
  quantity: number
  unit_price: number
  line_total: number
}

interface Invoice {
  id: string
  invoice_number: string
  total: number
  currency: string
  status: string
  due_at: string | null
  created_at: string
  customers?: { name: string; email: string } | null
  invoice_items: InvoiceItem[]
}

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)

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
    try {
      const res = await fetch(`/api/invoices/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Published' }),
      })

      if (res.ok) {
        fetchInvoice()
      }
    } catch (error) {
      console.error('Error publishing invoice:', error)
    } finally {
      setPublishing(false)
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

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-[#12243A]">{invoice.invoice_number}</h2>
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(invoice.status)}`}>
            {invoice.status}
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push('/invoices')}>
            Back to Invoices
          </Button>
          {invoice.status === 'Draft' && (
            <Button onClick={publishInvoice} disabled={publishing} className="bg-[#0EA58B] hover:bg-[#0c9479]">
              {publishing ? 'Publishing...' : 'Publish Invoice'}
            </Button>
          )}
        </div>
      </div>

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

      {invoice.status === 'Published' && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Payment</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600 mb-4">Share this invoice for payment:</p>
            <div className="flex gap-2">
              <Input value={`${window.location.origin}/pay/${invoice.id}`} readOnly />
              <Button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/pay/${invoice.id}`)}>
                Copy Link
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  )
}
