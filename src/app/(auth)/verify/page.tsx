import type { Metadata } from 'next'

import { resendCode, verifyCode } from './actions'

export const metadata: Metadata = {
  title: 'Confirm your email | Kivunra',
  robots: { index: false, follow: false },
}

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; error?: string; sent?: string }>
}) {
  const { email, error, sent } = await searchParams

  if (!email) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="w-full max-w-md space-y-6 p-8 text-center">
          <h1 className="text-3xl font-bold text-[#12243A]">Kivunra</h1>
          <p className="text-gray-600">
            We need the email address the code was sent to. Start again from the sign-up page.
          </p>
          <a
            href="/register"
            className="inline-block rounded-lg bg-[#0EA58B] px-6 py-3 font-bold text-white hover:bg-[#0c9480]"
          >
            Create account
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md space-y-8 p-8">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-[#12243A]">Confirm your email</h2>
          <p className="mt-2 text-gray-600">
            We sent a 6-digit code to <span className="font-medium">{email}</span>.
          </p>
        </div>

        {sent && (
          <div className="rounded border border-teal-200 bg-teal-50 px-4 py-3 text-teal-800">
            A new code is on its way. It can take a minute or two to arrive.
          </div>
        )}

        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-red-700">
            {error}
          </div>
        )}

        <form action={verifyCode} className="space-y-4">
          <input type="hidden" name="email" value={email} />
          <div>
            <label htmlFor="code" className="block text-sm font-medium text-gray-700">
              Confirmation code
            </label>
            <input
              id="code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoFocus
              placeholder="000000"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-3 text-center text-2xl tracking-[0.4em] shadow-sm focus:border-[#0EA58B] focus:outline-none focus:ring-[#0EA58B]"
            />
            <p className="mt-1 text-xs text-gray-500">
              The email also contains a confirmation link — either one works.
            </p>
          </div>
          <button
            type="submit"
            className="flex w-full justify-center rounded-md border border-transparent bg-[#0EA58B] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#0c9479] focus:outline-none focus:ring-2 focus:ring-[#0EA58B] focus:ring-offset-2"
          >
            Verify email
          </button>
        </form>

        <form action={resendCode} className="text-center">
          <input type="hidden" name="email" value={email} />
          <p className="text-sm text-gray-600">
            Didn&apos;t get it?{" "}
            <button type="submit" className="font-medium text-[#0EA58B] hover:underline">
              Send a new code
            </button>
          </p>
        </form>

        <p className="text-center text-sm text-gray-600">
          Wrong address?{" "}
          <a href="/register" className="font-medium text-[#0EA58B] hover:underline">
            Start over
          </a>
        </p>
      </div>
    </div>
  )
}
