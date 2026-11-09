import { NextRequest, NextResponse } from 'next/server'

import { requestOrigin } from '@/lib/auth-origin'
import { apiError, databaseErrorResponse } from '@/lib/api-error'
import {
  automationDraftSchema,
  automationSecretMatches,
  composeAutomationSource,
  parseAutomationToken,
} from '@/lib/automation'
import {
  createGroqCompletion,
  getGroqModel,
  GroqApiError,
  isGroqConfigured,
  parseJsonObject,
} from '@/lib/groq'
import {
  buildInvoiceDraftSystemPrompt,
  buildInvoiceDraftUserPrompt,
  matchCustomer,
  normaliseInvoiceDraft,
  type NormalisedInvoiceDraft,
} from '@/lib/invoice-draft'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const HOURLY_LIMIT = 30

interface CustomerRow {
  id: string
  name: string
  email?: string | null
}

interface InvoiceRow {
  id: string
  invoice_number: string
  status: string
  total: number | string | null
  currency: string
  due_at: string | null
  customers?: { id?: string; name?: string | null } | null
}

async function authenticate(request: NextRequest) {
  const header = request.headers.get('authorization') ?? ''

  if (!header.toLowerCase().startsWith('bearer ')) {
    return null
  }

  const parsed = parseAutomationToken(header.slice(7))

  if (!parsed) {
    return null
  }

  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.getUserById(parsed.userId)

  if (error || !data.user) {
    return null
  }

  const storedHash =
    typeof data.user.user_metadata?.automation_key_hash === 'string'
      ? (data.user.user_metadata.automation_key_hash as string)
      : null

  if (!automationSecretMatches(parsed.secret, storedHash)) {
    return null
  }

  return { admin, user: data.user }
}

function invoiceSummary(invoice: InvoiceRow, origin: string) {
  return {
    id: invoice.id,
    number: invoice.invoice_number,
    status: invoice.status,
    url: `${origin}/invoices/${invoice.id}`,
    total: Number(invoice.total ?? 0),
    currency: invoice.currency,
    due_at: invoice.due_at,
    customer: invoice.customers
      ? { id: invoice.customers.id ?? null, name: invoice.customers.name ?? null }
      : null,
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticate(request)

  if (!auth) {
    return NextResponse.json(
      { error: 'Invalid or missing automation key' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } }
    )
  }

  const { admin, user } = auth

  if (!isGroqConfigured()) {
    return apiError(503, 'AI drafting is not configured on this deployment.')
  }

  const body = await request.json().catch(() => null)
  const parsed = automationDraftSchema.safeParse(body)

  if (!parsed.success) {
    return apiError(400, 'Invalid automation request', { issues: parsed.error.issues })
  }

  const input = parsed.data
  const origin = await requestOrigin()

  // Zapier retries failed actions. Replay a previous result for the same
  // source event instead of creating a duplicate invoice.
  if (input.external_id) {
    const { data: prior } = await admin
      .from('ai_interactions')
      .select('result_data')
      .eq('user_id', user.id)
      .eq('request_type', 'InvoiceDraft')
      .contains('result_data', { external_id: input.external_id })
      .limit(1)

    const stored = prior?.[0]?.result_data as
      | { draft?: unknown; invoice_id?: string | null; external_id?: string | null }
      | undefined

    if (stored?.draft) {
      let invoice: InvoiceRow | null = null

      if (stored.invoice_id) {
        const { data } = await admin
          .from('invoices')
          .select('id, invoice_number, status, total, currency, due_at, customers(id, name)')
          .eq('id', stored.invoice_id)
          .maybeSingle()

        invoice = (data as InvoiceRow | null) ?? null
      }

      return NextResponse.json({
        ok: true,
        replayed: true,
        message: invoice
          ? `Replayed draft ${invoice.invoice_number} for ${stored.external_id}.`
          : `Replayed a previous draft for ${stored.external_id}.`,
        invoice: invoice ? invoiceSummary(invoice, origin) : null,
        draft: stored.draft,
      })
    }
  }

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count, error: countError } = await admin
    .from('ai_interactions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('request_type', 'InvoiceDraft')
    .gte('created_at', since)

  if (countError) {
    console.error('[automation] could not check rate limit', countError.code, countError.message)
  } else if ((count ?? 0) >= HOURLY_LIMIT) {
    return NextResponse.json(
      {
        error: `This account has reached the AI drafting limit (${HOURLY_LIMIT} per hour).`,
      },
      { status: 429, headers: { 'Retry-After': '3600' } }
    )
  }

  const { data: customerData, error: customerError } = await admin
    .from('customers')
    .select('id, name, email')
    .eq('owner_user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100)

  if (customerError) {
    return databaseErrorResponse(customerError)
  }

  const customers = (customerData ?? []) as CustomerRow[]
  let selectedCustomer: CustomerRow | null = null

  if (input.customer_id) {
    selectedCustomer =
      customers.find((customer) => customer.id === input.customer_id) ?? null

    if (!selectedCustomer) {
      const { data } = await admin
        .from('customers')
        .select('id, name, email')
        .eq('id', input.customer_id)
        .eq('owner_user_id', user.id)
        .maybeSingle()

      if (!data) {
        return apiError(400, 'Customer not found')
      }

      selectedCustomer = data as CustomerRow
    }
  }

  // The sender of the email is a strong signal for an existing customer.
  if (!selectedCustomer && input.from_email) {
    const { data } = await admin
      .from('customers')
      .select('id, name, email')
      .eq('owner_user_id', user.id)
      .ilike('email', input.from_email)
      .limit(1)
      .maybeSingle()

    selectedCustomer = (data as CustomerRow | null) ?? null
  }

  const source = composeAutomationSource(input)
  const currency = input.currency ?? 'USD'

  const recordInteraction = async (
    status: 'Success' | 'Failed',
    result: unknown,
    model: string
  ) => {
    const { error } = await admin.from('ai_interactions').insert({
      user_id: user.id,
      request_type: 'InvoiceDraft',
      model,
      result_status: status,
      input_prompt: source,
      result_data: result,
    })

    if (error) {
      console.error('[automation] could not record interaction', error.code, error.message)
    }
  }

  let content: string
  let model: string

  try {
    const completion = await createGroqCompletion({
      system: buildInvoiceDraftSystemPrompt(),
      user: buildInvoiceDraftUserPrompt({
        prompt: source,
        currency,
        selectedCustomerName: selectedCustomer?.name ?? null,
        customerNames: customers.map((customer) => customer.name),
      }),
    })

    content = completion.content
    model = completion.model
  } catch (error) {
    if (error instanceof GroqApiError) {
      console.error('[automation] Groq request failed', error.status, error.message)
    } else {
      console.error('[automation] Groq request failed', error)
    }

    await recordInteraction('Failed', { error: 'provider_error', external_id: input.external_id }, getGroqModel())
    return apiError(502, 'The AI service is unavailable right now. Please try again.')
  }

  let draft: NormalisedInvoiceDraft

  try {
    draft = normaliseInvoiceDraft(parseJsonObject(content), currency)
  } catch (error) {
    console.error('[automation] invalid draft', error)
    await recordInteraction('Failed', { error: 'invalid_draft', external_id: input.external_id }, model)
    return apiError(502, 'The AI could not produce a usable draft from that text.')
  }

  let matchedCustomer =
    selectedCustomer ??
    (draft.customer_name ? matchCustomer(customers, draft.customer_name) : null)

  const responseDraft = {
    customer_id: matchedCustomer?.id ?? null,
    customer_name: matchedCustomer?.name ?? draft.customer_name,
    currency: draft.currency,
    due_in_days: draft.due_in_days,
    due_date: draft.due_date,
    notes: draft.notes,
    assumptions: draft.assumptions,
    items: draft.items,
  }

  if (!input.create_invoice) {
    await recordInteraction(
      'Success',
      { external_id: input.external_id, draft: responseDraft, invoice_id: null },
      model
    )

    return NextResponse.json({ ok: true, replayed: false, invoice: null, draft: responseDraft })
  }

  if (!matchedCustomer && input.create_customer && draft.customer_name) {
    const { data: created, error: createError } = await admin
      .from('customers')
      .insert({
        owner_user_id: user.id,
        name: draft.customer_name,
        email: input.from_email ?? null,
      })
      .select('id, name, email')
      .single()

    if (createError) {
      console.error('[automation] could not create customer', createError.code, createError.message)
    } else {
      matchedCustomer = created as CustomerRow
    }
  }

  const total = Math.round(
    draft.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0) * 100
  ) / 100

  const { data: invoiceNumber, error: numberError } = await admin.rpc('next_invoice_number', {
    p_owner: user.id,
  })

  if (numberError || !invoiceNumber) {
    console.error('[automation] could not allocate invoice number', numberError?.message)
    return apiError(500, 'Could not create the draft invoice. Please try again.')
  }

  const { data: invoice, error: invoiceError } = await admin
    .from('invoices')
    .insert({
      owner_user_id: user.id,
      customer_id: matchedCustomer?.id ?? null,
      invoice_number: invoiceNumber,
      currency: draft.currency,
      total,
      status: 'Draft',
      due_at: draft.due_date ?? null,
    })
    .select('id, invoice_number, status, total, currency, due_at')
    .single()

  if (invoiceError || !invoice) {
    console.error('[automation] could not create invoice', invoiceError?.code, invoiceError?.message)
    return apiError(500, 'Could not create the draft invoice. Please try again.')
  }

  const { error: itemsError } = await admin.from('invoice_items').insert(
    draft.items.map((item) => ({
      invoice_id: invoice.id,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      line_total: Math.round(item.quantity * item.unit_price * 100) / 100,
    }))
  )

  if (itemsError) {
    console.error('[automation] could not create items', itemsError.code, itemsError.message)
    await admin.from('invoices').delete().eq('id', invoice.id)
    return apiError(500, 'Could not create the draft invoice. Please try again.')
  }

  await recordInteraction(
    'Success',
    {
      external_id: input.external_id,
      draft: responseDraft,
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
    },
    model
  )

  const summary = `Created draft ${invoice.invoice_number} for ${
    matchedCustomer?.name ?? draft.customer_name ?? 'an unmatched customer'
  } (${invoice.currency} ${total.toFixed(2)}). Review and publish it in Kivunra.`

  return NextResponse.json(
    {
      ok: true,
      replayed: false,
      message: summary,
      invoice: invoiceSummary(
        { ...(invoice as InvoiceRow), customers: matchedCustomer ?? null },
        origin
      ),
      draft: responseDraft,
    },
    { status: 201 }
  )
}
