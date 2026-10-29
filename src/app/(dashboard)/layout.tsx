import Link from 'next/link'
import { redirect } from 'next/navigation'

import { signout } from '@/app/(auth)/login/actions'
import { createClient, isSupabaseConfigured } from '@/lib/supabase/server'

// Every dashboard page is per-user; never prerender or cache them.
export const dynamic = 'force-dynamic'

function SetupRequired() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="max-w-lg w-full bg-white rounded-lg shadow p-8">
        <h1 className="text-2xl font-bold text-[#12243A] mb-2">Connect Supabase</h1>
        <p className="text-gray-600 mb-4">
          Kivunra needs a Supabase project before the dashboard can load.
        </p>
        <ol className="list-decimal list-inside text-sm text-gray-700 space-y-2">
          <li>
            Copy <code className="bg-gray-100 px-1 rounded">.env.example</code> to{' '}
            <code className="bg-gray-100 px-1 rounded">.env.local</code>
          </li>
          <li>Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY</li>
          <li>
            Run <code className="bg-gray-100 px-1 rounded">supabase/migrations/*.sql</code> against the
            project
          </li>
          <li>Restart the dev server</li>
        </ol>
      </div>
    </div>
  )
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  if (!isSupabaseConfigured()) {
    return <SetupRequired />
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-[#12243A] text-white p-4">
        <div className="container mx-auto flex flex-wrap justify-between items-center gap-3">
          <h1 className="text-xl font-bold">Kivunra</h1>
          <div className="flex flex-wrap gap-4 items-center">
            <Link href="/dashboard" className="hover:text-[#0EA58B]">Dashboard</Link>
            <Link href="/invoices" className="hover:text-[#0EA58B]">Invoices</Link>
            <Link href="/customers" className="hover:text-[#0EA58B]">Customers</Link>
            <Link href="/payments" className="hover:text-[#0EA58B]">Payments</Link>
            <Link href="/insights" className="hover:text-[#0EA58B]">Insights</Link>
            <span className="text-sm text-gray-300">{user.email}</span>
            <form action={signout}>
              <button type="submit" className="hover:text-[#0EA58B] text-sm">Sign out</button>
            </form>
          </div>
        </div>
      </nav>
      {children}
    </div>
  )
}
