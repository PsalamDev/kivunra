'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Sparkles, Trash2, Plus } from 'lucide-react'

interface Customer {
  id: string
  name: string
  email: string | null
}

interface InvoiceItem {
  description: string
  quantity: number
  unit_price: number
}

interface InvoiceDraftResponse {
  draft: {
    customer_id: string | null
    customer_name: string | null
    currency: string
    due_in_days: number | null
    due_date: string | null
    notes: string | null
    items: InvoiceItem[]
  }
}

export default function NewInvoicePage() {
  const router = useRouter()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [customerId, setCustomerId] = useState<string>('')
  const [items, setItems] = useState<InvoiceItem[]>([
    { description: '', quantity: 1, unit_price: 0 }
  ])
  const [currency, setCurrency] = useState('USD')
  const [dueDate, setDueDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiMessage, setAiMessage] = useState<string | null>(null)
  const [unmatchedCustomer, setUnmatchedCustomer] = useState<string | null>(null)
  const [addingCustomer, setAddingCustomer] = useState(false)

  useEffect(() => {
    fetchCustomers()
  }, [])

  const fetchCustomers = async () => {
    try {
      const res = await fetch('/api/customers')
      const data = await res.json()
      if (data.customers) {
        setCustomers(data.customers)
      }
    } catch (error) {
      console.error('Error fetching customers:', error)
    }
  }

  const draftWithAi = async () => {
    const prompt = aiPrompt.trim()

    if (prompt.length < 10) {
      setAiError('Describe the invoice in at least 10 characters.')
      return
    }

    setAiLoading(true)
    setAiError(null)
    setAiMessage(null)
    setUnmatchedCustomer(null)

    try {
      const res = await fetch('/api/ai/invoice-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          currency,
          customer_id: customerId || null,
        }),
      })

      const data = (await res.json().catch(() => null)) as
        | (InvoiceDraftResponse & { error?: string })
        | null

      if (!res.ok || !data?.draft) {
        setAiError(data?.error || 'Could not draft the invoice. Please try again.')
        return
      }

      const draft = data.draft

      if (Array.isArray(draft.items) && draft.items.length > 0) {
        setItems(
          draft.items.map((item) => ({
            description: item.description,
            quantity: Number(item.quantity) || 1,
            unit_price: Number(item.unit_price) || 0,
          }))
        )
      }

      if (draft.currency) {
        setCurrency(draft.currency)
      }

      if (draft.due_date) {
        setDueDate(draft.due_date)
      }

      if (draft.customer_id) {
        setCustomerId(draft.customer_id)
      } else if (draft.customer_name) {
        setUnmatchedCustomer(draft.customer_name)
      }

      setAiMessage(
        draft.notes
          ? `Draft applied. AI note: ${draft.notes} Review the customer, items and due date before creating the invoice.`
          : 'Draft applied. Review the customer, items and due date before creating the invoice.'
      )
    } catch (error) {
      console.error('Error drafting invoice:', error)
      setAiError('Could not draft the invoice. Please try again.')
    } finally {
      setAiLoading(false)
    }
  }

  const addDraftCustomer = async () => {
    if (!unmatchedCustomer) return

    setAddingCustomer(true)
    setAiError(null)

    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: unmatchedCustomer }),
      })

      const data = (await res.json().catch(() => null)) as
        | { customer?: Customer; error?: string }
        | null

      if (!res.ok || !data?.customer) {
        setAiError(data?.error || 'Could not add that customer.')
        return
      }

      setCustomers((current) => [data.customer as Customer, ...current])
      setCustomerId(data.customer.id)
      setUnmatchedCustomer(null)
      setAiMessage(`Added ${data.customer.name} and selected them for this invoice.`)
    } catch (error) {
      console.error('Error adding customer:', error)
      setAiError('Could not add that customer.')
    } finally {
      setAddingCustomer(false)
    }
  }

  const addItem = () => {
    setItems([...items, { description: '', quantity: 1, unit_price: 0 }])
  }

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index))
    }
  }

  const updateItem = (index: number, field: keyof InvoiceItem, value: string | number) => {
    const newItems = [...items]
    newItems[index] = { ...newItems[index], [field]: value }
    setItems(newItems)
  }

  const calculateTotal = () => {
    return items.reduce((sum, item) => {
      return sum + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0)
    }, 0)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Filter out empty items
    const validItems = items.filter(item => item.description.trim())
    if (validItems.length === 0) {
      alert('Please add at least one item')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId || null,
          items: validItems,
          currency,
          due_at: dueDate || null,
        }),
      })

      if (res.ok) {
        router.push('/invoices')
      } else {
        const data = await res.json()
        alert(data.error || 'Failed to create invoice')
      }
    } catch (error) {
      console.error('Error creating invoice:', error)
      alert('Failed to create invoice')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-[#12243A]">Create Invoice</h2>
        <Button variant="outline" onClick={() => router.push('/invoices')}>
          Cancel
        </Button>
      </div>

      <Card className="mb-6 border-[#0EA58B]/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[#0EA58B]" />
            Draft with AI
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={aiPrompt}
            onChange={(event) => setAiPrompt(event.target.value)}
            placeholder="Invoice Acme for a 5-page website redesign at $2,400, due in 14 days"
            maxLength={2000}
            rows={3}
            disabled={aiLoading}
            aria-label="Describe the invoice"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-gray-500">
              Describe the work, customer, amount and payment terms. You review the draft before
              creating anything.
            </p>
            <Button
              type="button"
              onClick={draftWithAi}
              disabled={aiLoading || aiPrompt.trim().length < 10}
              className="bg-[#0EA58B] hover:bg-[#0c9479]"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              {aiLoading ? 'Drafting...' : 'Draft invoice'}
            </Button>
          </div>

          {aiError && (
            <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {aiError}
            </p>
          )}

          {aiMessage && !aiError && (
            <p role="status" className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              {aiMessage}
            </p>
          )}

          {unmatchedCustomer && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-sm text-amber-800">
                AI suggested <strong>{unmatchedCustomer}</strong>, which is not in your customers
                yet.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addDraftCustomer}
                disabled={addingCustomer}
              >
                {addingCustomer ? 'Adding...' : `Add ${unmatchedCustomer}`}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <form onSubmit={handleSubmit}>
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Invoice Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="customer">Customer</Label>
                <Select value={customerId} onValueChange={(value) => setCustomerId(value || '')}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select customer (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="currency">Currency</Label>
                <Select value={currency} onValueChange={(value) => setCurrency(value || 'USD')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                    <SelectItem value="NGN">NGN</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="dueDate">Due Date</Label>
                <Input
                  id="dueDate"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>Invoice Items</CardTitle>
              <Button type="button" onClick={addItem} size="sm" className="bg-[#0EA58B] hover:bg-[#0c9479]">
                <Plus className="h-4 w-4 mr-2" />
                Add Item
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-32">Quantity</TableHead>
                  <TableHead className="w-32">Unit Price</TableHead>
                  <TableHead className="w-32">Total</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <Input
                        value={item.description}
                        onChange={(e) => updateItem(index, 'description', e.target.value)}
                        placeholder="Item description"
                        required
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={item.quantity}
                        onChange={(e) => updateItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unit_price}
                        onChange={(e) => updateItem(index, 'unit_price', parseFloat(e.target.value) || 0)}
                      />
                    </TableCell>
                    <TableCell>
                      {((Number(item.quantity) || 0) * (Number(item.unit_price) || 0)).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeItem(index)}
                        disabled={items.length === 1}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-4 text-right">
              <p className="text-lg font-bold">
                Total: {currency} {calculateTotal().toFixed(2)}
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={loading} className="bg-[#0EA58B] hover:bg-[#0c9479]">
            {loading ? 'Creating...' : 'Create Invoice'}
          </Button>
        </div>
      </form>
    </main>
  )
}
