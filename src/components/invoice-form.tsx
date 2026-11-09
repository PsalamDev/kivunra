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
import { formatDate, formatMoney } from '@/lib/format'

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
    assumptions?: string[]
    items: InvoiceFormItem[]
  }
}

interface AiDraftSummary {
  customerName: string | null
  currency: string
  dueDate: string | null
  itemCount: number
  total: number
  notes: string | null
  assumptions: string[]
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

const AI_EXAMPLES = [
  {
    label: 'Website project',
    prompt:
      'Hi, this is Sarah at Acme Studio. Please invoice us for a 5-page website redesign at $2,400, due in 14 days.',
  },
  {
    label: 'Monthly retainer',
    prompt:
      'Invoice Northwind for our monthly social media retainer: $800 per month for 3 months, Net 30.',
  },
  {
    label: 'Brand package',
    prompt:
      'Create an invoice for a logo plus a 12-page brand guide for Bluebird Cafe. Total $1,500, due on receipt.',
  },
] as const

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
  const [aiNotice, setAiNotice] = useState<string | null>(null)
  const [aiSummary, setAiSummary] = useState<AiDraftSummary | null>(null)
  const [unmatchedCustomer, setUnmatchedCustomer] = useState<string | null>(null)
  const [addingCustomer, setAddingCustomer] = useState(false)

  const isEdit = mode === 'edit'

  const draftWithAi = async () => {
    const prompt = aiPrompt.trim()

    if (prompt.length < 10) {
      setAiError('Paste or describe the invoice in at least 10 characters.')
      return
    }

    setAiLoading(true)
    setAiError(null)
    setAiNotice(null)
    setAiSummary(null)
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

      const draftTotal = draft.items.reduce(
        (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0),
        0
      )

      setAiSummary({
        customerName: draft.customer_id
          ? customers.find((customer) => customer.id === draft.customer_id)?.name ??
            draft.customer_name
          : draft.customer_name,
        currency: draft.currency,
        dueDate: draft.due_date,
        itemCount: draft.items.length,
        total: Math.round(draftTotal * 100) / 100,
        notes: draft.notes,
        assumptions: draft.assumptions ?? [],
      })
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
      setAiSummary((current) =>
        current ? { ...current, customerName: data.customer?.name ?? current.customerName } : current
      )
      setAiNotice(`Added ${data.customer.name} and selected them for this invoice.`)
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
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Textarea
                value={aiPrompt}
                onChange={(event) => setAiPrompt(event.target.value)}
                placeholder="Paste a client email, project brief or contract excerpt — or describe the invoice: &quot;Invoice Acme for a 5-page website redesign at $2,400, Net 14&quot;"
                maxLength={6000}
                rows={5}
                disabled={aiLoading}
                aria-label="Invoice source text"
              />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-500">Try an example:</span>
                {AI_EXAMPLES.map((example) => (
                  <Button
                    key={example.label}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAiPrompt(example.prompt)}
                    disabled={aiLoading}
                  >
                    {example.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-gray-500">
                Paste an email, brief or contract excerpt. AI extracts the client, line items,
                currency and payment terms; you review everything before saving.
              </p>
              <Button
                type="button"
                onClick={draftWithAi}
                disabled={aiLoading || aiPrompt.trim().length < 10}
                className="bg-[#0EA58B] hover:bg-[#0c9479]"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                {aiLoading ? 'Drafting...' : aiSummary ? 'Regenerate' : 'Draft invoice'}
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

            {aiNotice && !aiError && (
              <p
                role="status"
                className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700"
              >
                {aiNotice}
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

            {aiSummary && !aiError && (
              <div
                role="status"
                className="space-y-3 rounded border border-green-200 bg-green-50 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-green-900">
                    Draft applied — review before saving
                  </p>
                  <p className="text-xs text-green-800">
                    The AI filled the editable fields below. Check every value.
                  </p>
                </div>

                <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                  <div>
                    <dt className="text-green-700">Customer</dt>
                    <dd className="font-medium text-green-900">
                      {aiSummary.customerName ?? 'Not detected'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-green-700">Currency</dt>
                    <dd className="font-medium text-green-900">{aiSummary.currency}</dd>
                  </div>
                  <div>
                    <dt className="text-green-700">Due</dt>
                    <dd className="font-medium text-green-900">
                      {aiSummary.dueDate ? formatDate(aiSummary.dueDate) : 'Not set'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-green-700">Total</dt>
                    <dd className="font-medium text-green-900">
                      {formatMoney(aiSummary.currency, aiSummary.total)} · {aiSummary.itemCount}{' '}
                      {aiSummary.itemCount === 1 ? 'item' : 'items'}
                    </dd>
                  </div>
                </dl>

                {aiSummary.notes && (
                  <p className="text-xs text-green-800">
                    <span className="font-medium">Suggested note:</span> {aiSummary.notes}
                  </p>
                )}

                {aiSummary.assumptions.length > 0 && (
                  <div className="text-xs text-green-800">
                    <p className="font-medium">Assumptions to check</p>
                    <ul className="list-disc pl-5">
                      {aiSummary.assumptions.map((assumption) => (
                        <li key={assumption}>{assumption}</li>
                      ))}
                    </ul>
                  </div>
                )}
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
