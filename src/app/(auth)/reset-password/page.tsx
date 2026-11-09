import type { Metadata } from 'next'

import { createClient, isSupabaseConfigured } from '@/lib/supabase/server'

import { updatePassword } from './actions'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Choose a new password | Kivunra',
  robots: { index: false, follow: false },
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  const supabase = isSupabaseConfigured() ? await createClient() : null
  const {
    data: { user },
  } = supabase ? await supabase.auth.getUser() : { data: { user: null } }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="w-full max-w-md space-y-6 p-8 text-center">
          <h1 className="text-3xl font-bold text-[#12243A]">Kivunra</h1>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
            <h2 className="mb-2 text-lg font-semibold text-amber-900">
              This reset link has expired or was already used
            </h2>
            <p className="text-sm text-amber-800">
              Request a new link and open it on this device within the hour.
            </p>
          </div>
          <a
            href="/forgot-password"
            className="inline-block rounded-lg bg-[#0EA58B] px-6 py-3 font-bold text-white hover:bg-[#0c9480]"
          >
            Request a new link
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md space-y-8 p-8">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-[#12243A]">Choose a new password</h2>
          <p className="mt-2 text-gray-600">Signed in as {user.email}</p>
        </div>

        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-red-700">
            {error}
          </div>
        )}

        <form action={updatePassword} className="space-y-6">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
              New password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-[#0EA58B] focus:outline-none focus:ring-[#0EA58B]"
            />
            <p className="mt-1 text-xs text-gray-500">At least 6 characters.</p>
          </div>
          <div>
            <label htmlFor="confirm_password" className="block text-sm font-medium text-gray-700">
              Confirm new password
            </label>
            <input
              id="confirm_password"
              name="confirm_password"
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-[#0EA58B] focus:outline-none focus:ring-[#0EA58B]"
            />
          </div>
          <button
            type="submit"
            className="flex w-full justify-center rounded-md border border-transparent bg-[#0EA58B] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#0c9479] focus:outline-none focus:ring-2 focus:ring-[#0EA58B] focus:ring-offset-2"
          >
            Update password
          </button>
        </form>
      </div>
    </div>
  )
}
