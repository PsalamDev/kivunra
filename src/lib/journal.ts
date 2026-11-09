import { cache } from 'react'

import { createAdminClient, isServiceRoleConfigured } from './supabase/admin'

/**
 * Name shown as the issuer on invoices and receipts.
 *
 * It lives in the auth user's metadata (set at signup) so it is available
 * everywhere the owner is known, including public invoice pages that render
 * without a session. `full_name` remains a fallback for accounts created
 * before journal names existed.
 */
export const DEFAULT_JOURNAL_NAME = 'Kivunra'

export function journalNameFromMetadata(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  const journalName = metadata?.journal_name
  return typeof journalName === 'string' && journalName.trim() ? journalName.trim() : null
}

function fullNameFromMetadata(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  const fullName = metadata?.full_name
  return typeof fullName === 'string' && fullName.trim() ? fullName.trim() : null
}

/**
 * Name used in the invoice email body ("X sent you an invoice"). Journal name
 * wins; accounts created before it existed fall back to their profile name.
 */
export function invoiceSenderName(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  return journalNameFromMetadata(metadata) ?? fullNameFromMetadata(metadata)
}

/**
 * Issuer name for an invoice owner. Cached per request so a page that renders
 * several pieces of invoice chrome only performs one lookup.
 */
export const getJournalName = cache(async (ownerUserId: string): Promise<string> => {
  if (!isServiceRoleConfigured()) {
    return DEFAULT_JOURNAL_NAME
  }

  try {
    const admin = createAdminClient()
    const { data, error } = await admin.auth.admin.getUserById(ownerUserId)

    if (error) {
      return DEFAULT_JOURNAL_NAME
    }

    return journalNameFromMetadata(data.user?.user_metadata) ?? DEFAULT_JOURNAL_NAME
  } catch {
    return DEFAULT_JOURNAL_NAME
  }
})
