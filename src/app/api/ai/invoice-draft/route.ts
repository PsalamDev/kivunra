import { NextRequest, NextResponse } from 'next/server'

import { apiError, databaseErrorResponse } from '@/lib/api-error'
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
  invoiceDraftRequestSchema,
  matchCustomer,
  normaliseInvoiceDraft,
  type NormalisedInvoiceDraft,
} from '@/lib/invoice-draft'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const HOURLY_LIMIT = 20

interface CustomerRow {
  id: string
  name: string
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return apiError(401, 'Unauthorized')
  }

  if (!isGroqConfigured()) {
    return apiError(503, 'AI drafting is not configured on this deployment.')
  }

  const body = await request.json().catch(() => null)
  const parsed = invoiceDraftRequestSchema.safeParse(body)

  if (!parsed.success) {
    return apiError(400, 'Invalid draft request', { issues: parsed.error.issues })
  }

  const { prompt, customer_id } = parsed.data
  const currency = parsed.data.currency ?? 'USD'

  // Durable per-user limit; unlike an in-memory bucket this survives
  // serverless instances and restarts.
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count, error: countError } = await supabase
    .from('ai_interactions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('request_type', 'InvoiceDraft')
    .gte('created_at', since)

  if (countError) {
    console.error('[ai] could not check rate limit', countError.code, countError.message)
  } else if ((count ?? 0) >= HOURLY_LIMIT) {
    return NextResponse.json(
      {
        error: `You have reached the AI drafting limit (${HOURLY_LIMIT} per hour). Please try again later.`,
      },
      { status: 429, headers: { 'Retry-After': '3600' } }
    )
  }

  const { data: customerData, error: customerError } = await supabase
    .from('customers')
    .select('id, name')
    .eq('owner_user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100)

  if (customerError) {
    return databaseErrorResponse(customerError)
  }

  const customers = (customerData ?? []) as CustomerRow[]

  let selectedCustomer: CustomerRow | null = null

  if (customer_id) {
    selectedCustomer = customers.find((customer) => customer.id === customer_id) ?? null

    if (!selectedCustomer) {
      const { data, error } = await supabase
        .from('customers')
        .select('id, name')
        .eq('id', customer_id)
        .eq('owner_user_id', user.id)
        .maybeSingle()

      if (error) {
        return databaseErrorResponse(error)
      }

      if (!data) {
        return apiError(400, 'Customer not found')
      }

      selectedCustomer = data as CustomerRow
    }
  }

  const recordInteraction = async (
    status: 'Success' | 'Failed',
    result: unknown,
    model: string
  ) => {
    const { error } = await supabase.from('ai_interactions').insert({
      user_id: user.id,
      request_type: 'InvoiceDraft',
      model,
      result_status: status,
      input_prompt: prompt,
      result_data: result,
    })

    if (error) {
      console.error('[ai] could not record interaction', error.code, error.message)
    }
  }

  let content: string
  let model: string

  try {
    const completion = await createGroqCompletion({
      system: buildInvoiceDraftSystemPrompt(),
      user: buildInvoiceDraftUserPrompt({
        prompt,
        currency,
        selectedCustomerName: selectedCustomer?.name ?? null,
        customerNames: customers.map((customer) => customer.name),
      }),
    })

    content = completion.content
    model = completion.model
  } catch (error) {
    if (error instanceof GroqApiError) {
      console.error('[ai] Groq request failed', error.status, error.message)
    } else {
      console.error('[ai] Groq request failed', error)
    }

    await recordInteraction('Failed', { error: 'provider_error' }, getGroqModel())
    return apiError(502, 'The AI service is unavailable right now. Please try again.')
  }

  let draft: NormalisedInvoiceDraft

  try {
    draft = normaliseInvoiceDraft(parseJsonObject(content), currency)
  } catch (error) {
    console.error('[ai] invalid draft', error)
    await recordInteraction('Failed', { error: 'invalid_draft' }, model)
    return apiError(502, 'The AI could not produce a usable draft. Try rephrasing the request.')
  }

  const matchedCustomer =
    selectedCustomer ??
    (draft.customer_name ? matchCustomer(customers, draft.customer_name) : null)

  const responseDraft = {
    customer_id: matchedCustomer?.id ?? null,
    customer_name: matchedCustomer?.name ?? draft.customer_name,
    currency: draft.currency,
    due_in_days: draft.due_in_days,
    due_date: draft.due_date,
    notes: draft.notes,
    items: draft.items,
  }

  await recordInteraction('Success', responseDraft, model)

  return NextResponse.json({ draft: responseDraft })
}
