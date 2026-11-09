import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Confirmation link expired | Kivunra',
  robots: { index: false, follow: false },
}

export default function AuthCodeErrorPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md space-y-6 p-8 text-center">
        <h1 className="text-3xl font-bold text-[#12243A]">Kivunra</h1>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
          <h2 className="mb-2 text-lg font-semibold text-amber-900">
            This link has expired or was already used
          </h2>
          <p className="text-sm text-amber-800">
            Confirmation links work once and expire after a while. Sign in to request a new one, or
            create your account again if you never finished.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <a
            href="/login"
            className="rounded-lg bg-[#0EA58B] px-6 py-3 font-bold text-white hover:bg-[#0c9480]"
          >
            Go to sign in
          </a>
          <a
            href="/register"
            className="rounded-lg border border-gray-300 px-6 py-3 font-medium text-[#12243A] hover:bg-gray-50"
          >
            Create account
          </a>
        </div>
      </div>
    </div>
  )
}
