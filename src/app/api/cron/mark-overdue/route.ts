import { NextRequest, NextResponse } from 'next/server'

import { apiError } from '@/lib/api-error'
import { markOverdueInvoices } from '@/lib/overdue'
import { createAdminClient, isServiceRoleConfigured } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/**
 * Daily safety net for accounts that are not browsing the app. Vercel Cron
 * sends `Authorization: Bearer $CRON_SECRET`; list views also mark overdue
 * invoices lazily so the status is fresh between runs.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET

  if (!secret) {
    return apiError(503, 'CRON_SECRET is not configured on this deployment.')
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return apiError(401, 'Unauthorized')
  }

  if (!isServiceRoleConfigured()) {
    return apiError(503, 'Supabase service role is not configured.')
  }

  const updated = await markOverdueInvoices(createAdminClient())

  return NextResponse.json({ updated })
}
