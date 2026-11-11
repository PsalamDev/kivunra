import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { formatMoney } from '@/lib/format'
import { getJournalName } from '@/lib/journal'
import { completedCapturedAmount, invoiceAmountDue, loadPublicInvoice, refundedAmount } from '@/lib/public-invoice'
import { isInvoiceTokenShape } from '@/lib/public-token'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Payment status | Kivunra',
  robots: { index: false, follow: false },
}

function Icon({ kind }: { kind: 'success' | 'pending' | 'empty' }) {
  if (kind === 'success') {
    return (
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-8 w-8 text-green-600"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </div>
    )
  }

  if (kind === 'pending') {
    return (
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-8 w-8 text-amber-600"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </div>
    )
  }

  return (
    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-8 w-8 text-gray-400"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8h.01M11 12h1v4h1" />
      </svg>
    </div>
  )
}

/**
 * Confirmation shown right after PayPal returns, before the receipt.
 *
 * The status is presentation only: it comes from the capture response, while
 * the amounts below are re-read from the database on every render.
 */
export default async function PaymentSuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { token } = await params
  const query = await searchParams

  if (!isInvoiceTokenShape(token)) {
    notFound()
  }

  const loaded = await loadPublicInvoice(token)

  if (!loaded.ok) {
    if (loaded.reason === 'not_found') {
      notFound()
    }

    return (
      <div className="min-h-screen bg-gray-50 py-12">
        <div className="container mx-auto max-w-lg px-4">
          <div className="rounded-lg bg-white p-8 text-center shadow">
            <h1 className="mb-2 text-xl font-bold text-[#12243A]">Kivunra</h1>
            <p className="text-gray-600">We could not load this invoice. Please try again later.</p>
          </div>
        </div>
      </div>
    )
  }

  const invoice = loaded.invoice
  const journalName = await getJournalName(invoice.owner_user_id)

  if (invoice.status === 'Draft' || invoice.status === 'Cancelled') {
    notFound()
  }

  const captures = (invoice.payment_orders ?? [])
    .flatMap((order) => order.payment_captures ?? [])
    .filter((capture) => capture.status === 'COMPLETED')

  const paidToDate = Math.max(
    0,
    Math.round((completedCapturedAmount(invoice) - refundedAmount(invoice)) * 100) / 100
  )
  const amountDue = invoiceAmountDue(invoice)
  const pending = query.status === 'pending'
  const hasPayment = captures.length > 0

  const state: 'success' | 'pending' | 'empty' = pending
    ? 'pending'
    : hasPayment
      ? 'success'
      : 'empty'

  const heading =
    state === 'pending'
      ? 'Payment pending'
      : state === 'success'
        ? amountDue > 0.01
          ? 'Partial payment received'
          : 'Payment successful'
        : 'No payment found'

  const detail =
    state === 'pending'
      ? 'PayPal is still confirming this payment. This page will update once it clears.'
      : state === 'success'
        ? `Thank you — your payment for invoice ${invoice.invoice_number} has been received.`
        : `We could not find a completed payment for invoice ${invoice.invoice_number}.`

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="container mx-auto max-w-lg px-4">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-[#12243A]">{journalName}</h1>
          <p className="text-sm text-gray-500">Payment status</p>
        </div>

        <div className="rounded-lg bg-white p-8 text-center shadow">
          <Icon kind={state} />

          <h2 className="mb-2 text-xl font-bold text-[#12243A]">{heading}</h2>
          <p className="mb-6 text-gray-600">{detail}</p>

          {state !== 'empty' && (
            <dl className="mb-6 space-y-2 rounded-lg bg-gray-50 p-4 text-left text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-600">Invoice</dt>
                <dd className="font-medium text-[#12243A]">{invoice.invoice_number}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">Paid to date</dt>
                <dd className="font-medium text-[#12243A]">
                  {formatMoney(invoice.currency, paidToDate)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">Amount due</dt>
                <dd className="font-medium text-[#12243A]">
                  {formatMoney(invoice.currency, amountDue)}
                </dd>
              </div>
            </dl>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            {hasPayment && (
              <a
                href={`/pay/${token}/receipt`}
                className="inline-block rounded-lg bg-[#0EA58B] px-6 py-3 font-bold text-white hover:bg-[#0c9480]"
              >
                View receipt
              </a>
            )}
            {hasPayment && (
              <a
                href={`/api/pay/${token}/receipt`}
                className="inline-block rounded-lg border border-gray-300 px-6 py-3 font-medium text-[#12243A] hover:bg-gray-50"
              >
                Download PDF
              </a>
            )}
            <a
              href={`/pay/${token}`}
              className="inline-block rounded-lg border border-gray-300 px-6 py-3 font-medium text-[#12243A] hover:bg-gray-50"
            >
              Back to invoice
            </a>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">Secured by Kivunra</p>
      </div>
    </div>
  )
}
