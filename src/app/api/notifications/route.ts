import { NextRequest, NextResponse } from 'next/server'

import { apiError, databaseErrorResponse } from '@/lib/api-error'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface NotificationRow {
  id: string
  type: string
  title: string
  body: string | null
  source_type: string | null
  source_id: string | null
  read_at: string | null
  created_at: string
}

/** Recent in-app notifications plus the unread badge count. */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return apiError(401, 'Unauthorized')
  }

  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, title, body, source_type, source_id, read_at, created_at')
    .eq('owner_user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    return databaseErrorResponse(error)
  }

  const { count, error: countError } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('owner_user_id', user.id)
    .is('read_at', null)

  if (countError) {
    return databaseErrorResponse(countError)
  }

  return NextResponse.json({
    notifications: (data ?? []) as NotificationRow[],
    unread: count ?? 0,
  })
}

/**
 * Marks one notification (body.id) or every unread notification as read.
 * RLS restricts the update to the signed-in owner.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return apiError(401, 'Unauthorized')
  }

  const body = await request.json().catch(() => null)
  const id = typeof body?.id === 'string' ? body.id : null

  let query = supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('owner_user_id', user.id)
    .is('read_at', null)

  if (id) {
    query = query.eq('id', id)
  }

  const { error } = await query

  if (error) {
    return databaseErrorResponse(error)
  }

  return NextResponse.json({ success: true })
}
