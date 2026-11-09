import type { Metadata } from 'next'

import { requestReset } from './actions'

export const metadata: Metadata = {
  title: 'Reset your password | Kivunra',
  robots: { index: false, follow: false },
}

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>
}) {
  const { sent, error } = await searchParams

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md space-y-8 p-8">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-[#12243A]">Reset your password</h2>
          <p className="mt-2 text-gray-600">
            Enter the email you signed up with and we&apos;ll send a reset link.
          </p>
        </div>

        {sent && (
          <div className="rounded border border-green-200 bg-green-50 px-4 py-3 text-green-700">
            If an account exists for that address, a reset link is on its way. Check your spam
            folder if it hasn&apos;t arrived in a few minutes.
          </div>
        )}

        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-red-700">
            {error}
          </div>
        )}

        <form action={requestReset} className="space-y-6">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-[#0EA58B] focus:outline-none focus:ring-[#0EA58B]"
            />
          </div>
          <button
            type="submit"
            className="flex w-full justify-center rounded-md border border-transparent bg-[#0EA58B] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#0c9479] focus:outline-none focus:ring-2 focus:ring-[#0EA58B] focus:ring-offset-2"
          >
            Send reset link
          </button>
        </form>

        <p className="text-center text-sm text-gray-600">
          Remembered it?{" "}
          <a href="/login" className="font-medium text-[#0EA58B] hover:underline">
            Back to sign in
          </a>
        </p>
      </div>
    </div>
  )
}
