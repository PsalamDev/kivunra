'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { friendlyAuthError } from '@/lib/auth-errors'
import { createClient } from '@/lib/supabase/server'

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '')
}

async function currentUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return { supabase, user }
}

export async function updateJournalName(formData: FormData): Promise<void> {
  const journalName = text(formData, 'journal_name').replace(/\s+/g, ' ').trim()

  if (journalName.length < 2) {
    redirect('/settings?error=' + encodeURIComponent('Enter a journal name of at least 2 characters.'))
  }

  if (journalName.length > 80) {
    redirect('/settings?error=' + encodeURIComponent('Keep the journal name under 80 characters.'))
  }

  const { supabase, user } = await currentUser()

  if (!user) {
    redirect('/login?next=/settings')
  }

  const { error } = await supabase.auth.updateUser({ data: { journal_name: journalName } })

  if (error) {
    const message = friendlyAuthError(
      error.message,
      'Could not save your journal name. Please try again.'
    )
    redirect('/settings?error=' + encodeURIComponent(message))
  }

  revalidatePath('/', 'layout')
  redirect('/settings?saved=journal')
}

export async function changePassword(formData: FormData): Promise<void> {
  const currentPassword = text(formData, 'current_password')
  const password = text(formData, 'password')
  const confirmation = text(formData, 'confirm_password')

  const { supabase, user } = await currentUser()

  if (!user) {
    redirect('/login?next=/settings')
  }

  if (!currentPassword) {
    redirect('/settings?error=' + encodeURIComponent('Enter your current password.'))
  }

  if (password.length < 6) {
    redirect('/settings?error=' + encodeURIComponent('Use at least 6 characters for the new password.'))
  }

  if (password !== confirmation) {
    redirect('/settings?error=' + encodeURIComponent('The new passwords do not match.'))
  }

  // Supabase does not require the old password to change it, so prove the
  // request comes from someone who knows it.
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email ?? '',
    password: currentPassword,
  })

  if (signInError) {
    redirect('/settings?error=' + encodeURIComponent('Your current password is incorrect.'))
  }

  const { error } = await supabase.auth.updateUser({ password })

  if (error) {
    const message = friendlyAuthError(
      error.message,
      'Could not update your password. Please try again.'
    )
    redirect('/settings?error=' + encodeURIComponent(message))
  }

  revalidatePath('/', 'layout')
  redirect('/settings?saved=password')
}
