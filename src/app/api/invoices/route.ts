import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

interface InvoiceItemInput {
  description: string
  quantity?: number | string
  unit_price?: number | string
}

interface CreateInvoiceBody {
  customer_id?: string | null
  items?: InvoiceItemInput[]
  currency?: string
  due_at?: string | null
}

async function generateInvoiceNumber(supabase: SupabaseClient, userId: string) {
  const { count } = await supabase
    .from('invoices')
    .select('*', { count: 'exact', head: true })
    .eq('owner_user_id', userId)

  const num = (count || 0) + 1
  return `INV-${String(num).padStart(4, '0')}`
}

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
      const { data, error } = await supabase
        .from('invoices')
        .select('*, customers(*), invoice_items(*)')
        .eq('owner_user_id', user.id)
        .order('created_at', { ascending: false })

      if (error) {
        return NextResponse.json({ invoices: [] })
      }

      return NextResponse.json({ invoices: data || [] })
    } catch {
      return NextResponse.json({ invoices: [] })
    }
  } catch {
    return NextResponse.json({ invoices: [] })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json()) as CreateInvoiceBody
    const { customer_id, items, currency = 'USD', due_at } = body

    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'Items are required' }, { status: 400 })
    }

    const invoiceNumber = await generateInvoiceNumber(supabase, user.id)

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

    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .insert({
        owner_user_id: user.id,
        customer_id: customer_id || null,
        invoice_number: invoiceNumber,
        currency,
        total,
        status: 'Draft',
        due_at: due_at || null,
      })
      .select()
      .single()

    if (invoiceError) {
      return NextResponse.json({ error: invoiceError.message }, { status: 500 })
    }

    const itemsToInsert = itemsWithTotals.map((item) => ({
      invoice_id: invoice.id,
      ...item,
    }))

    const { error: itemsError } = await supabase
      .from('invoice_items')
      .insert(itemsToInsert)

    if (itemsError) {
      return NextResponse.json({ error: itemsError.message }, { status: 500 })
    }

    const { data: fullInvoice } = await supabase
      .from('invoices')
      .select('*, customers(*), invoice_items(*)')
      .eq('id', invoice.id)
      .single()

    return NextResponse.json({ invoice: fullInvoice }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
