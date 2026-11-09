import type { SupabaseClient } from '@supabase/supabase-js'

/** Statuses that should flip to Overdue once the due date has passed. */
export const OPEN_INVOICE_STATUSES = ['Published', 'PartiallyPaid'] as const

/**
 * Midnight UTC today. Invoices due today are not overdue yet; only those whose
 * due date (a calendar date) is strictly before today are.
 */
function startOfTodayUtc(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
}

/**
 * Flags open invoices whose due date has passed. Safe to call often: the update
 * only touches rows that still need it. Pass an owner id from a user-scoped
 * client; omit it from the service-role cron job to cover every account.
 */
export async function markOverdueInvoices(
  supabase: SupabaseClient,
  ownerUserId?: string
): Promise<number> {
  let query = supabase
    .from('invoices')
    .update({ status: 'Overdue' })
    .in('status', [...OPEN_INVOICE_STATUSES])
    .not('due_at', 'is', null)
    .lt('due_at', startOfTodayUtc())
    .select('id')

  if (ownerUserId) {
    query = query.eq('owner_user_id', ownerUserId)
  }

  const { data, error } = await query

  if (error) {
    console.error('[invoices] could not mark overdue invoices', error.code, error.message)
    return 0
  }

  return data?.length ?? 0
}
