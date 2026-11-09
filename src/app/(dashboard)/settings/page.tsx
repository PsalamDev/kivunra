import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { AutomationKeyCard } from '@/components/automation-key-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { automationKeyConfigured, automationKeyCreatedAt } from '@/lib/automation'
import { journalNameFromMetadata } from '@/lib/journal'
import { createClient } from '@/lib/supabase/server'

import { changePassword, updateJournalName } from './actions'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Settings | Kivunra',
  robots: { index: false, follow: false },
}

const fieldClass =
  'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-[#0EA58B] focus:outline-none focus:ring-[#0EA58B]'

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; message?: string }>
}) {
  const { saved, error, message } = await searchParams

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login?next=/settings')
  }

  const journalName = journalNameFromMetadata(user.user_metadata) ?? ''
  const automationConfigured = automationKeyConfigured(user.user_metadata)
  const automationCreatedAt = automationKeyCreatedAt(user.user_metadata)
  const savedMessage =
    saved === 'journal'
      ? 'Journal name saved. It will appear on new and existing public invoices.'
      : saved === 'password'
        ? 'Password updated.'
        : null

  return (
    <div className="container mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div>
        <h2 className="text-2xl font-bold text-[#12243A]">Settings</h2>
        <p className="mt-1 text-sm text-gray-600">
          Your journal name is the issuer shown on every invoice, receipt and pay page.
        </p>
      </div>

      {(savedMessage || message) && (
        <div className="rounded border border-green-200 bg-green-50 px-4 py-3 text-green-700">
          {savedMessage ?? message}
        </div>
      )}

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-red-700">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Journal</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updateJournalName} className="space-y-4">
            <div>
              <label htmlFor="journal_name" className="block text-sm font-medium text-gray-700">
                Journal name
              </label>
              <input
                id="journal_name"
                name="journal_name"
                type="text"
                required
                minLength={2}
                maxLength={80}
                defaultValue={journalName}
                placeholder="Brightline Studio"
                className={fieldClass}
              />
              <p className="mt-1 text-xs text-gray-500">
                Shown as the issuer on invoices and receipts. Changing it also changes the name in
                invoice emails.
              </p>
            </div>
            <button
              type="submit"
              className="rounded-md bg-[#0EA58B] px-4 py-2 text-sm font-medium text-white hover:bg-[#0c9479] focus:outline-none focus:ring-2 focus:ring-[#0EA58B] focus:ring-offset-2"
            >
              Save journal name
            </button>
          </form>
        </CardContent>
      </Card>

      <AutomationKeyCard configured={automationConfigured} createdAt={automationCreatedAt} />

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent>
          <div>
            <p className="text-sm font-medium text-gray-700">Email address</p>
            <p className="mt-1 text-sm text-[#12243A]">{user.email}</p>
            <p className="mt-1 text-xs text-gray-500">
              Contact support if you need to change the email on this account.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={changePassword} className="space-y-4">
            <div>
              <label htmlFor="current_password" className="block text-sm font-medium text-gray-700">
                Current password
              </label>
              <input
                id="current_password"
                name="current_password"
                type="password"
                required
                autoComplete="current-password"
                className={fieldClass}
              />
            </div>
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
                className={fieldClass}
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
                className={fieldClass}
              />
            </div>
            <button
              type="submit"
              className="rounded-md bg-[#12243A] px-4 py-2 text-sm font-medium text-white hover:bg-[#1c3454] focus:outline-none focus:ring-2 focus:ring-[#12243A] focus:ring-offset-2"
            >
              Update password
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
