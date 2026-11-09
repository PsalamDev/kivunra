import { redirect } from 'next/navigation'

import { InvoiceForm } from '@/components/invoice-form'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function NewInvoicePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login?next=/invoices/new')
  }

  const { data: customers } = await supabase
    .from('customers')
    .select('id, name, email')
    .eq('owner_user_id', user.id)
    .order('name')

  return <InvoiceForm mode="create" customers={customers ?? []} allowAiDraft />
}
