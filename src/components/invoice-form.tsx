'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Sparkles, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

export interface InvoiceFormCustomer {
  id: string
  name: string
  email: string | null
}

export interface InvoiceFormItem {
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
    items: InvoiceFormItem[]
  }
}

interface InvoiceFormProps {
  mode: 'create' | 'edit'
  invoiceId?: string
  customers: InvoiceFormCustomer[]
  initialCustomerId?: string | null
  initialCurrency?: string
  initialDueDate?: string | null
  initialItems?: InvoiceFormItem[]
  allowAiDraft?: boolean
  currencyLocked?: boolean
  backHref?: string
}

const EMPTY_ITEM: InvoiceFormItem = { description: '', quantity: 1, unit_price: 0 }

const CURRENCIES = ['USD', 'EUR', 'GBP', 'NGN'] as const

export function InvoiceForm({
  mode,
  invoiceId,
  customers: initialCustomers,
  initialCustomerId,
  initialCurrency = 'USD',
  initialDueDate,
  initialItems,
  allowAiDraft = false,
  currencyLocked = false,
  backHref = '/invoices',
}: InvoiceFormProps) {
  const router = useRouter()
  const [customers, setCustomers] = useState<InvoiceFormCustomer[]>(initialCustomers)
  const [customerId, setCustomerId] = useState<string>(initialCustomerId ?? '')
  const [items, setItems] = useState<InvoiceFormItem[]>(
    initialItems && initialItems.length > 0 ? initialItems : [EMPTY_ITEM]
  )
  const [currency, setCurrency] = useState(initialCurrency)
  const [dueDate, setDueDate] = useState(initialDueDate ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiMessage, setAiMessage] = useState<string | null>(null)
  const [unmatchedCustomer, setUnmatchedCustomer] = useState<string | null>(null)
  const [addingCustomer, setAddingCustomer] = useState(false)

  const isEdit = mode === 'edit'

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
          ? `Draft applied. AI note: ${draft.notes} Review the customer, items and due date before saving.`
          : 'Draft applied. Review the customer, items and due date before saving.'
      )
    } catch (draftError) {
      console.error('Error drafting invoice:', draftError)
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
        | { customer?: InvoiceFormCustomer; error?: string }
        | null

      if (!res.ok || !data?.customer) {
        setAiError(data?.error || 'Could not add that customer.')
        return
      }

      setCustomers((current) => [data.customer as InvoiceFormCustomer, ...current])
      setCustomerId(data.customer.id)
      setUnmatchedCustomer(null)
      setAiMessage(`Added ${data.customer.name} and selected them for this invoice.`)
    } catch (addError) {
      console.error('Error adding customer:', addError)
      setAiError('Could not add that customer.')
    } finally {
      setAddingCustomer(false)
    }
  }

  const addItem = () => {
    setItems((current) => [...current, { ...EMPTY_ITEM }])
  }

  const removeItem = (index: number) => {
    setItems((current) => (current.length > 1 ? current.filter((_, i) => i !== index) : current))
  }

  const updateItem = (index: number, field: keyof InvoiceFormItem, value: string | number) => {
    setItems((current) => {
      const next = [...current]
      next[index] = { ...next[index], [field]: value }
      return next
    })
  }

  const calculateTotal = () =>
    items.reduce(
      (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0),
      0
    )

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)

    const validItems = items.filter((item) => item.description.trim())

    if (validItems.length === 0) {
      setError('Add at least one item with a description.')
      return
    }

    setLoading(true)

    try {
      const payload = isEdit
        ? {
            customer_id: customerId || null,
            items: validItems,
            due_at: dueDate || null,
          }
        : {
            customer_id: customerId || null,
            items: validItems,
            currency,
            due_at: dueDate || null,
          }

      const res = await fetch(isEdit ? `/api/invoices/${invoiceId}` : '/api/invoices', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = (await res.json().catch(() => null)) as
        | { invoice?: { id: string }; error?: string }
        | null

      if (!res.ok || !data?.invoice?.id) {
        setError(data?.error || 'Could not save the invoice. Please try again.')
        return
      }

      router.push(`/invoices/${data.invoice.id}`)
      router.refresh()
    } catch (submitError) {
      console.error('Error saving invoice:', submitError)
      setError('Could not save the invoice. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold text-[#12243A]">
          {isEdit ? 'Edit Invoice' : 'Create Invoice'}
        </h2>
        <Button variant="outline" onClick={() => router.push(backHref)}>
          Cancel
        </Button>
      </div>

      {isEdit && (
        <p className="mb-6 rounded border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          Changes apply to the same invoice number and public link. Items can only be edited while
          no payments have been recorded.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="mb-6 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      {allowAiDraft && (
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
                <Sparkles className="mr-2 h-4 w-4" />
                {aiLoading ? 'Drafting...' : 'Draft invoice'}
              </Button>
            </div>

            {aiError && (
              <p
                role="alert"
                className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {aiError}
              </p>
            )}

            {aiMessage && !aiError && (
              <p
                role="status"
                className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700"
              >
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
      )}

      <form onSubmit={handleSubmit}>
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Invoice Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
                <Select
                  value={currency}
                  onValueChange={(value) => setCurrency(value || 'USD')}
                  disabled={currencyLocked}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((code) => (
                      <SelectItem key={code} value={code}>
                        {code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {currencyLocked && (
                  <p className="mt-1 text-xs text-gray-500">
                    The currency is fixed once an invoice exists.
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="dueDate">Due Date</Label>
                <Input
                  id="dueDate"
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Invoice Items</CardTitle>
              <Button
                type="button"
                onClick={addItem}
                size="sm"
                className="bg-[#0EA58B] hover:bg-[#0c9479]"
              >
                <Plus className="mr-2 h-4 w-4" />
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
                        onChange={(event) => updateItem(index, 'description', event.target.value)}
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
                        onChange={(event) =>
                          updateItem(index, 'quantity', parseFloat(event.target.value) || 0)
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unit_price}
                        onChange={(event) =>
                          updateItem(index, 'unit_price', parseFloat(event.target.value) || 0)
                        }
                      />
                    </TableCell>
                    <TableCell>
                      {(
                        (Number(item.quantity) || 0) * (Number(item.unit_price) || 0)
                      ).toFixed(2)}
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
            {loading ? 'Saving...' : isEdit ? 'Save changes' : 'Create Invoice'}
          </Button>
        </div>
      </form>
    </main>
  )
}
