import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { friendlyAuthError } from '@/lib/auth-errors'
import { requestOrigin, safeNextPath } from '@/lib/auth-origin'
import { createClient } from '@/lib/supabase/server'

/**
 * Shared implementations for the auth server actions. Kept out of the
 * `'use server'` modules so both login and register can import them; each
 * module re-exports a thin async wrapper that Next turns into an action.
 */

function credentials(formData: FormData) {
  return {
    email: String(formData.get('email') ?? '')
      .trim()
      .toLowerCase(),
    password: String(formData.get('password') ?? ''),
  }
}

export async function loginAction(formData: FormData): Promise<void> {
  const supabase = await createClient()
  const { email, password } = credentials(formData)
  const next = safeNextPath(formData.get('next') as string | null)

  if (!email || !password) {
    redirect('/login?error=' + encodeURIComponent('Enter your email and password.'))
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    const message = friendlyAuthError(error.message, 'Could not sign you in. Please try again.')
    redirect('/login?error=' + encodeURIComponent(message))
  }

  revalidatePath('/', 'layout')
  redirect(next)
}

export async function signupAction(formData: FormData): Promise<void> {
  const supabase = await createClient()
  const { email, password } = credentials(formData)
  const journalName = String(formData.get('journal_name') ?? '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!email || !password) {
    redirect('/register?error=' + encodeURIComponent('Enter an email and password.'))
  }

  if (password.length < 6) {
    redirect(
      '/register?error=' + encodeURIComponent('Use at least 6 characters for your password.')
    )
  }

  if (journalName.length < 2) {
    redirect('/register?error=' + encodeURIComponent('Enter your journal or business name.'))
  }

  if (journalName.length > 80) {
    redirect(
      '/register?error=' + encodeURIComponent('Keep the journal name under 80 characters.')
    )
  }

  const origin = await requestOrigin()

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Without this the confirmation link falls back to the project's Site URL
      // (often localhost), which dead-ends once the app is deployed.
      emailRedirectTo: `${origin}/auth/callback?next=/dashboard`,
      // The journal name is the issuer shown on invoices. It is kept on the
      // user until they confirm, then used everywhere the owner is resolved.
      data: { journal_name: journalName },
    },
  })

  if (error) {
    const message = friendlyAuthError(
      error.message,
      'Could not create your account. Please try again.'
    )
    redirect('/register?error=' + encodeURIComponent(message))
  }

  // When "Confirm email" is off Supabase returns a live session immediately.
  if (data.session) {
    revalidatePath('/', 'layout')
    redirect('/dashboard')
  }

  // Supabase does not reveal that an address is taken, but it returns the
  // existing user with an empty identities array.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    redirect(
      '/login?message=' +
        encodeURIComponent('That email is already registered. Sign in or reset your password.')
    )
  }

  redirect(`/verify?email=${encodeURIComponent(email)}&sent=1`)
}

/** Back to the code screen, preserving the address the code was sent to. */
function verifyPath(email: string, params: Record<string, string | undefined> = {}): string {
  const search = new URLSearchParams({ email })
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value)
  }
  return `/verify?${search.toString()}`
}

export async function verifyCodeAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase()
  const token = String(formData.get('code') ?? '').replace(/\s+/g, '')

  if (!email) {
    redirect('/register')
  }

  if (!/^\d{6}$/.test(token)) {
    redirect(verifyPath(email, { error: 'Enter the 6-digit code from your email.' }))
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'signup' })

  if (error) {
    const message = friendlyAuthError(
      error.message,
      'That code could not be verified. Request a new one and try again.'
    )
    redirect(verifyPath(email, { error: message }))
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

export async function resendCodeAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase()

  if (!email) {
    redirect('/register')
  }

  const origin = await requestOrigin()
  const supabase = await createClient()

  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: `${origin}/auth/callback?next=/dashboard` },
  })

  if (error) {
    const message = friendlyAuthError(error.message, 'Could not resend the code. Please try again.')
    redirect(verifyPath(email, { error: message }))
  }

  redirect(verifyPath(email, { sent: '1' }))
}

export async function signoutAction(): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}
