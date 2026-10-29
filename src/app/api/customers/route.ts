import { NextRequest, NextResponse } from 'next/server'

import { apiError, databaseErrorResponse } from '@/lib/api-error'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return apiError(401, 'Unauthorized')
  }

  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('owner_user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    return databaseErrorResponse(error)
  }

  return NextResponse.json({ customers: data ?? [] })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return apiError(401, 'Unauthorized')
  }

  const body = (await request.json().catch(() => null)) as
    | { name?: unknown; email?: unknown }
    | null

  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const email = typeof body?.email === 'string' ? body.email.trim() : ''

  if (!name) {
    return apiError(400, 'Name is required')
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return apiError(400, 'Enter a valid email address')
  }

  const { data, error } = await supabase
    .from('customers')
    .insert({
      owner_user_id: user.id,
      name,
      email: email || null,
    })
    .select()
    .single()

  if (error) {
    return databaseErrorResponse(error)
  }

  return NextResponse.json({ customer: data }, { status: 201 })
}
