import { NextRequest, NextResponse } from 'next/server'

import { apiError, databaseErrorResponse } from '@/lib/api-error'
import { INVOICE_DETAIL_SELECT, serializeInvoice } from '@/lib/invoices'
import { markOverdueInvoices } from '@/lib/overdue'
import { netCapturedAmount, type InvoicePaymentTrail } from '@/lib/payments'
import { createInvoiceToken, hashInvoiceToken, isInvoiceTokenConfigured } from '@/lib/public-token'
import { createClient } from '@/lib/supabase/server'
import { updateInvoiceSchema } from '@/lib/validation'

type RouteContext = { params: Promise<{ id: string }> }

type ExistingInvoice = InvoicePaymentTrail & {
  id: string
  status: string
  public_token_hash: string | null
}

const EDIT_GUARD_SELECT =
  'id, status, public_token_hash, payment_orders(payment_captures(amount, status, payment_refunds(amount, status)))'

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return apiError(401, 'Unauthorized')
  }

  await markOverdueInvoices(supabase, user.id)

  const { data, error } = await supabase
    .from('invoices')
    .select(INVOICE_DETAIL_SELECT)
    .eq('id', id)
    .eq('owner_user_id', user.id)
    .maybeSingle()

  if (error) {
    return databaseErrorResponse(error)
  }

  if (!data) {
    return apiError(404, 'Invoice not found')
  }

  return NextResponse.json({
    invoice: serializeInvoice(data, process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin),
  })
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return apiError(401, 'Unauthorized')
  }

  const body = await request.json().catch(() => null)
  const parsed = updateInvoiceSchema.safeParse(body)

  if (!parsed.success) {
    return apiError(400, 'Invalid invoice data', { issues: parsed.error.issues })
  }

  const { status, items, customer_id, due_at } = parsed.data

  const { data: found, error: findError } = await supabase
    .from('invoices')
    .select(EDIT_GUARD_SELECT)
    .eq('id', id)
    .eq('owner_user_id', user.id)
    .maybeSingle()

  if (findError) {
    return databaseErrorResponse(findError)
  }

  if (!found) {
    return apiError(404, 'Invoice not found')
  }

  const existing = found as ExistingInvoice
  const netCaptured = netCapturedAmount(existing)

  if (existing.status === 'Paid' || existing.status === 'Cancelled') {
    return apiError(409, `A ${existing.status.toLowerCase()} invoice can no longer be changed.`)
  }

  if (status) {
    if (status === 'Published') {
      if (existing.status !== 'Draft') {
        return apiError(409, 'Only draft invoices can be published.')
      }
    } else if (status === 'Cancelled') {
      if (netCaptured > 0.01) {
        return apiError(409, 'Refund the payments on this invoice before cancelling it.')
      }
    } else {
      return apiError(409, `An invoice cannot be changed to ${status} from this screen.`)
    }
  }

  if (items && netCaptured > 0.01) {
    return apiError(
      409,
      'This invoice has payments recorded. Refund them before editing its items.'
    )
  }

  if (customer_id !== undefined && netCaptured > 0.01) {
    return apiError(
      409,
      'This invoice has payments recorded. Its customer can no longer be changed.'
    )
  }

  if (customer_id) {
    const { data: customer } = await supabase
      .from('customers')
      .select('id')
      .eq('id', customer_id)
      .eq('owner_user_id', user.id)
      .maybeSingle()

    if (!customer) {
      return apiError(400, 'Customer not found')
    }
  }

  // Validate the public-link prerequisite before touching any rows.
  let publicTokenHash: string | null = null

  if (status === 'Published' && !existing.public_token_hash) {
    if (!isInvoiceTokenConfigured()) {
      return apiError(
        500,
        'Public invoice links are not configured. Set INVOICE_TOKEN_SECRET on the server.'
      )
    }

    publicTokenHash = hashInvoiceToken(createInvoiceToken(id))
  }

  // Atomic delete + insert + total recalculation.
  if (items) {
    const { error } = await supabase.rpc('replace_invoice_items', {
      p_invoice_id: id,
      p_items: items,
    })

    if (error) {
      return databaseErrorResponse(error)
    }
  }

  const updates: Record<string, unknown> = {}

  if (status) {
    updates.status = status
    if (publicTokenHash) updates.public_token_hash = publicTokenHash
  }

  if (customer_id !== undefined) updates.customer_id = customer_id
  if (due_at !== undefined) updates.due_at = due_at

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase
      .from('invoices')
      .update(updates)
      .eq('id', id)
      .eq('owner_user_id', user.id)

    if (error) {
      return databaseErrorResponse(error)
    }
  }

  const { data: invoice, error: fetchError } = await supabase
    .from('invoices')
    .select(INVOICE_DETAIL_SELECT)
    .eq('id', id)
    .eq('owner_user_id', user.id)
    .single()

  if (fetchError) {
    return databaseErrorResponse(fetchError)
  }

  return NextResponse.json({
    invoice: serializeInvoice(invoice, process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin),
  })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return apiError(401, 'Unauthorized')
  }

  const { data: found, error: findError } = await supabase
    .from('invoices')
    .select(EDIT_GUARD_SELECT)
    .eq('id', id)
    .eq('owner_user_id', user.id)
    .maybeSingle()

  if (findError) {
    return databaseErrorResponse(findError)
  }

  if (!found) {
    return apiError(404, 'Invoice not found')
  }

  if (netCapturedAmount(found as ExistingInvoice) > 0.01) {
    return apiError(409, 'Refund the payments on this invoice before deleting it.')
  }

  const { error } = await supabase
    .from('invoices')
    .delete()
    .eq('id', id)
    .eq('owner_user_id', user.id)

  if (error) {
    return databaseErrorResponse(error)
  }

  return NextResponse.json({ success: true })
}
