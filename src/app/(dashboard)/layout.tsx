import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { signout } from '@/app/(auth)/login/actions'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-[#12243A] text-white p-4">
        <div className="container mx-auto flex justify-between items-center">
          <h1 className="text-xl font-bold">Kivunra</h1>
          <div className="flex gap-4 items-center">
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
