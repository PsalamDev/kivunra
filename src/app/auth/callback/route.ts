import { NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'

import { safeNextPath } from '@/lib/auth-origin'
import { createClient } from '@/lib/supabase/server'

/**
 * Landing point for Supabase email links (confirmation, magic link, recovery).
 *
 * Two shapes are supported because the project's email templates decide which
 * one arrives: a PKCE `code` query parameter, or `token_hash` + `type` when the
 * template uses the OTP variant. Both end with a session cookie set server-side.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const next = safeNextPath(searchParams.get('next'))
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null

  const forwardedHost = request.headers.get('x-forwarded-host')
  const base =
    process.env.NODE_ENV === 'development'
      ? origin
      : forwardedHost
        ? `https://${forwardedHost}`
        : origin

  const supabase = await createClient()

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${base}${next}`)
    }
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    if (!error) {
      return NextResponse.redirect(`${base}${next}`)
    }
  }

  return NextResponse.redirect(`${base}/auth/auth-code-error`)
}
