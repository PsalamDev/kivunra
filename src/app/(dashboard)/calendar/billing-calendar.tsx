'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  BryntumCalendar,
  type BryntumCalendarProps,
} from '@bryntum/calendar-react-community'
import type { EventModelConfig } from '@bryntum/calendar-community'

import '@bryntum/core-community/fontawesome/css/fontawesome.css'
import '@bryntum/core-community/fontawesome/css/solid.css'
import '@bryntum/calendar-community/calendar.css'
import '@bryntum/calendar-community/svalbard-light.css'
import './calendar.css'

import { formatMoney } from '@/lib/format'

import type { BillingCalendarProps, BillingCalendarPayment } from './types'

const INVOICE_COLORS: Record<string, string> = {
  Published: 'b-blue',
  PartiallyPaid: 'b-amber',
  Overdue: 'b-red',
  Paid: 'b-green',
  Draft: 'b-gray',
  Cancelled: 'b-light-gray',
}

const PAYMENT_COLOR = 'b-teal'

function localDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function dayAfter(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
}

/** Invoice due dates are stored as calendar dates, so parse them literally. */
function dueDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const date = new Date(year, month, day)

  return Number.isNaN(date.getTime()) ? null : date
}

function paymentDay(payment: BillingCalendarPayment): Date | null {
  const captured = new Date(payment.captured_at)
  if (Number.isNaN(captured.getTime())) return null

  return localDay(captured)
}

export function BillingCalendar({ invoices, payments }: BillingCalendarProps) {
  const router = useRouter()

  const events = useMemo(() => {
    const dueEvents = invoices.flatMap((invoice): EventModelConfig[] => {
      const start = dueDay(invoice.due_at)
      if (!start) return []

      return [
        {
          id: `due:${invoice.id}`,
          name: `${invoice.invoice_number} · ${formatMoney(invoice.currency, invoice.total)}`,
          startDate: start,
          endDate: dayAfter(start),
          allDay: true,
          eventColor: INVOICE_COLORS[invoice.status] ?? 'b-gray',
          eventStyle: 'calendar',
        },
      ]
    })

    const paymentEvents = payments.flatMap((payment): EventModelConfig[] => {
      const start = paymentDay(payment)
      if (!start) return []

      return [
        {
          id: `pay:${payment.invoice_id}:${payment.id}`,
          name: `Paid ${payment.invoice_number} · ${formatMoney(payment.currency, payment.amount)}`,
          startDate: start,
          endDate: dayAfter(start),
          allDay: true,
          eventColor: PAYMENT_COLOR,
          eventStyle: 'calendar',
        },
      ]
    })

    return [...dueEvents, ...paymentEvents]
  }, [invoices, payments])

  const calendarProps: BryntumCalendarProps = {
    date: new Date(),
    mode: 'month',
    height: '70vh',
    readOnly: true,
    eventEditFeature: false,
    dragFeature: false,
    eventMenuFeature: false,
    scheduleMenuFeature: false,
    events,
    onEventClick: ({ eventRecord }) => {
      const invoiceId = String(eventRecord.id ?? '').split(':')[1]
      if (invoiceId) router.push(`/invoices/${invoiceId}`)
    },
  }

  return (
    <div className="billing-calendar h-[70vh] min-h-[520px] overflow-hidden rounded-xl bg-white ring-1 ring-foreground/10">
      <BryntumCalendar {...calendarProps} />
    </div>
  )
}
