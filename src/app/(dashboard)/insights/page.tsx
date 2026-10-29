import Link from 'next/link'
import { redirect } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatMonthLabel, formatMoney } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'

import { MonthlyChart, type MonthlyPoint } from './monthly-chart'

const MONTH_WINDOW = 6
const OUTSTANDING_STATUSES = ['Published', 'PartiallyPaid', 'Overdue']

interface InsightInvoice {
  status: string
  total: number | string | null
  currency: string
  created_at: string
}

function monthBuckets() {
  const now = new Date()
  const buckets: Array<{ key: string; label: string; start: Date }> = []

  for (let offset = MONTH_WINDOW - 1; offset >= 0; offset -= 1) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1))
    buckets.push({
      key: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`,
      label: formatMonthLabel(start),
      start,
    })
  }

  return buckets
}

export default async function InsightsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const buckets = monthBuckets()
  const rangeStart = buckets[0].start.toISOString()

  const { data, error } = await supabase
    .from('invoices')
    .select('status, total, currency, created_at')
    .eq('owner_user_id', user.id)
    .gte('created_at', rangeStart)

  const invoices = (data ?? []) as InsightInvoice[]

  const currencyCounts = new Map<string, number>()
  for (const invoice of invoices) {
    currencyCounts.set(invoice.currency, (currencyCounts.get(invoice.currency) ?? 0) + 1)
  }
  const primaryCurrency =
    [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'USD'

  const scoped = invoices.filter((invoice) => invoice.currency === primaryCurrency)
  const invoicedTotal = scoped.reduce((sum, invoice) => sum + Number(invoice.total ?? 0), 0)
  const collectedTotal = scoped
    .filter((invoice) => invoice.status === 'Paid')
    .reduce((sum, invoice) => sum + Number(invoice.total ?? 0), 0)
  const outstandingTotal = scoped
    .filter((invoice) => OUTSTANDING_STATUSES.includes(invoice.status))
    .reduce((sum, invoice) => sum + Number(invoice.total ?? 0), 0)

  const points: MonthlyPoint[] = buckets.map((bucket) => ({
    month: bucket.label,
    invoiced: 0,
    collected: 0,
  }))
  const indexByKey = new Map(buckets.map((bucket, index) => [bucket.key, index]))

  for (const invoice of scoped) {
    const key = String(invoice.created_at).slice(0, 7)
    const index = indexByKey.get(key)
    if (index === undefined) continue

    const amount = Number(invoice.total ?? 0)
    points[index].invoiced += amount
    if (invoice.status === 'Paid') {
      points[index].collected += amount
    }
  }

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-[#12243A]">Insights</h2>
        {currencyCounts.size > 1 && (
          <p className="text-sm text-gray-500">
            Showing {primaryCurrency} (most active currency)
          </p>
        )}
      </div>

      {error ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-red-700">Could not load your insights. Please refresh and try again.</p>
          </CardContent>
        </Card>
      ) : invoices.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-gray-500">
              No invoice activity in the last {MONTH_WINDOW} months yet.{' '}
              <Link href="/invoices/new" className="text-[#0EA58B] hover:underline">
                Create an invoice
              </Link>{' '}
              to start tracking trends.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-gray-500">Invoiced</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-[#12243A]">
                  {formatMoney(primaryCurrency, invoicedTotal)}
                </p>
                <p className="text-sm text-gray-500 mt-2">Last {MONTH_WINDOW} months</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-gray-500">Collected</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-[#12243A]">
                  {formatMoney(primaryCurrency, collectedTotal)}
                </p>
                <p className="text-sm text-gray-500 mt-2">
                  {invoicedTotal > 0
                    ? `${Math.round((collectedTotal / invoicedTotal) * 100)}% of invoiced`
                    : 'No invoices yet'}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-gray-500">Outstanding</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-[#12243A]">
                  {formatMoney(primaryCurrency, outstandingTotal)}
                </p>
                <p className="text-sm text-gray-500 mt-2">Published or partially paid</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Monthly Activity — {primaryCurrency}</CardTitle>
            </CardHeader>
            <CardContent>
              <MonthlyChart data={points} currency={primaryCurrency} />
            </CardContent>
          </Card>

          <div className="mt-6">
            <Link href="/invoices">
              <Button variant="outline">View all invoices</Button>
            </Link>
          </div>
        </>
      )}
    </main>
  )
}
