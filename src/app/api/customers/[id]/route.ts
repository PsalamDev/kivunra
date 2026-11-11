import { NextRequest, NextResponse } from 'next/server'

import { apiError, databaseErrorResponse } from '@/lib/api-error'
import { createClient } from '@/lib/supabase/server'
import { updateCustomerSchema } from '@/lib/validation'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Updates a customer's name or email. RLS already scopes the row to its owner,
 * and the owner filter below makes a missing row report a 404 rather than
 * silently updating nothing.
 */
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
  const parsed = updateCustomerSchema.safeParse(body)

  if (!parsed.success) {
    return apiError(400, 'Invalid customer data', { issues: parsed.error.issues })
  }

  const updates: Record<string, unknown> = {}

  if (parsed.data.name !== undefined) {
    updates.name = parsed.data.name
  }

  if (parsed.data.email !== undefined) {
    updates.email = parsed.data.email?.trim() || null
  }

  const { data, error } = await supabase
    .from('customers')
    .update(updates)
    .eq('id', id)
    .eq('owner_user_id', user.id)
    .select('id, name, email, created_at')
    .maybeSingle()

  if (error) {
    return databaseErrorResponse(error)
  }

  if (!data) {
    return apiError(404, 'Customer not found')
  }

  return NextResponse.json({ customer: data })
}
