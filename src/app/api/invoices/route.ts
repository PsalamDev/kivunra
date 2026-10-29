import { NextRequest, NextResponse } from 'next/server'

import { databaseErrorResponse, apiError } from '@/lib/api-error'
import { INVOICE_SELECT, serializeInvoice } from '@/lib/invoices'
import { createClient } from '@/lib/supabase/server'
import { createInvoiceSchema } from '@/lib/validation'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return apiError(401, 'Unauthorized')
  }

  const { data, error } = await supabase
    .from('invoices')
    .select(INVOICE_SELECT)
    .eq('owner_user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    return databaseErrorResponse(error)
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin

  return NextResponse.json({
    invoices: (data ?? []).map((invoice) => serializeInvoice(invoice, origin)),
  })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return apiError(401, 'Unauthorized')
  }

  const body = await request.json().catch(() => null)
  const parsed = createInvoiceSchema.safeParse(body)

  if (!parsed.success) {
    return apiError(400, 'Invalid invoice data', { issues: parsed.error.issues })
  }

  const { customer_id, items, currency, due_at } = parsed.data

  // Creates the invoice and all of its items in one transaction, and assigns
  // the next invoice number under a row lock (safe under concurrent requests).
  const { data: invoiceId, error } = await supabase.rpc('create_invoice', {
    p_customer_id: customer_id ?? null,
    p_items: items,
    p_currency: currency,
    p_due_at: due_at ?? null,
  })

  if (error) {
    return databaseErrorResponse(error)
  }

  const { data: invoice, error: fetchError } = await supabase
    .from('invoices')
    .select(INVOICE_SELECT)
    .eq('id', invoiceId)
    .single()

  if (fetchError) {
    return databaseErrorResponse(fetchError)
  }

  return NextResponse.json(
    { invoice: serializeInvoice(invoice, process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin) },
    { status: 201 }
  )
}
