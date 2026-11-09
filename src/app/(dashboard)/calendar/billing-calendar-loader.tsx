'use client'

import dynamic from 'next/dynamic'

import type { BillingCalendarProps } from './types'

// Bryntum touches `window` as soon as it is imported, so the widget can only
// exist in the browser. Keeping this loader as a Client Component lets Next
// skip SSR for the heavy Calendar chunk without blocking the page render.
const BillingCalendar = dynamic(
  () => import('./billing-calendar').then((module) => module.BillingCalendar),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[70vh] min-h-[520px] items-center justify-center rounded-xl bg-white ring-1 ring-foreground/10">
        <p className="text-sm text-gray-500">Loading billing calendar…</p>
      </div>
    ),
  }
)

export function BillingCalendarLoader(props: BillingCalendarProps) {
  return <BillingCalendar {...props} />
}
