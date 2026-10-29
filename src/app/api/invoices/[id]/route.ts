import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface InvoiceItemInput {
  description: string
  quantity?: number | string
  unit_price?: number | string
}

interface InvoiceUpdateBody {
  status?: string
  items?: InvoiceItemInput[]
  customer_id?: string | null
  due_at?: string | null
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabase
      .from('invoices')
      .select('*, customers(*), invoice_items(*)')
      .eq('id', id)
      .eq('owner_user_id', user.id)
      .single()

    if (error) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    return NextResponse.json({ invoice: data })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json()) as InvoiceUpdateBody
    const { status, items, customer_id, due_at } = body

    const updateData: {
      status?: string
      customer_id?: string | null
      due_at?: string | null
      total?: number
    } = {}

    if (status) updateData.status = status
    if (customer_id !== undefined) updateData.customer_id = customer_id
    if (due_at !== undefined) updateData.due_at = due_at

    if (items) {
      let total = 0
      const itemsWithTotals = items.map((item) => {
        const lineTotal = (Number(item.quantity) || 1) * (Number(item.unit_price) || 0)
        total += lineTotal
        return {
          description: item.description,
          quantity: Number(item.quantity) || 1,
          unit_price: Number(item.unit_price) || 0,
          line_total: lineTotal,
        }
      })
      updateData.total = total

      await supabase.from('invoice_items').delete().eq('invoice_id', id)

      const itemsToInsert = itemsWithTotals.map((item) => ({
        invoice_id: id,
        ...item,
      }))

      await supabase.from('invoice_items').insert(itemsToInsert)
    }

    const { error } = await supabase
      .from('invoices')
      .update(updateData)
      .eq('id', id)
      .eq('owner_user_id', user.id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const { data: fullInvoice } = await supabase
      .from('invoices')
      .select('*, customers(*), invoice_items(*)')
      .eq('id', id)
      .single()

    return NextResponse.json({ invoice: fullInvoice })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { error } = await supabase
      .from('invoices')
      .delete()
      .eq('id', id)
      .eq('owner_user_id', user.id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
