'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface Customer {
  id: string
  name: string
  email: string | null
  created_at: string
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)

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
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name) return

    setSubmitting(true)
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email: email || null }),
      })

      if (res.ok) {
        setName('')
        setEmail('')
        fetchCustomers()
      }
    } catch (error) {
      console.error('Error creating customer:', error)
    } finally {
      setSubmitting(false)
    }
  }

  const startEditing = (customer: Customer) => {
    setEditingId(customer.id)
    setEditName(customer.name)
    setEditEmail(customer.email ?? '')
    setEditError(null)
  }

  const cancelEditing = () => {
    setEditingId(null)
    setEditError(null)
  }

  const saveCustomer = async (id: string) => {
    if (!editName.trim()) {
      setEditError('Name is required')
      return
    }

    setSavingId(id)
    setEditError(null)

    try {
      const res = await fetch(`/api/customers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, email: editEmail || null }),
      })
      const data = (await res.json().catch(() => null)) as
        | { customer?: Customer; error?: string }
        | null

      if (!res.ok || !data?.customer) {
        setEditError(data?.error || 'Could not update the customer')
        return
      }

      setCustomers((current) =>
        current.map((customer) => (customer.id === id ? (data.customer as Customer) : customer))
      )
      setEditingId(null)
    } catch (error) {
      console.error('Error updating customer:', error)
      setEditError('Could not update the customer')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <main className="container mx-auto px-4 py-8">
      <h2 className="text-2xl font-bold text-[#12243A] mb-6">Customers</h2>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Add New Customer</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex gap-4">
            <div className="flex-1">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Customer name"
                required
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="customer@example.com"
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={submitting} className="bg-[#0EA58B] hover:bg-[#0c9479]">
                {submitting ? 'Adding...' : 'Add Customer'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Customer List</CardTitle>
        </CardHeader>
        <CardContent>
          {editError && (
            <p role="alert" className="mb-3 text-sm text-red-700">
              {editError}
            </p>
          )}
          {loading ? (
            <p className="text-gray-500">Loading...</p>
          ) : customers.length === 0 ? (
            <p className="text-gray-500">No customers yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((customer) =>
                  editingId === customer.id ? (
                    <TableRow key={customer.id}>
                      <TableCell>
                        <Input
                          aria-label="Customer name"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label="Customer email"
                          type="email"
                          value={editEmail}
                          onChange={(e) => setEditEmail(e.target.value)}
                          placeholder="customer@example.com"
                        />
                      </TableCell>
                      <TableCell>{new Date(customer.created_at).toLocaleDateString()}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            onClick={() => saveCustomer(customer.id)}
                            disabled={savingId === customer.id}
                            className="bg-[#0EA58B] hover:bg-[#0c9479]"
                          >
                            {savingId === customer.id ? 'Saving...' : 'Save'}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={cancelEditing}
                            disabled={savingId === customer.id}
                          >
                            Cancel
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    <TableRow key={customer.id}>
                      <TableCell className="font-medium">{customer.name}</TableCell>
                      <TableCell>{customer.email || '-'}</TableCell>
                      <TableCell>{new Date(customer.created_at).toLocaleDateString()}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => startEditing(customer)}
                          disabled={savingId !== null}
                        >
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
