export interface BillingCalendarInvoice {
  id: string
  invoice_number: string
  status: string
  total: number
  currency: string
  due_at: string
  customer_name: string | null
}

export interface BillingCalendarPayment {
  id: string
  invoice_id: string
  invoice_number: string
  amount: number
  currency: string
  captured_at: string
  customer_name: string | null
}

export interface BillingCalendarProps {
  invoices: BillingCalendarInvoice[]
  payments: BillingCalendarPayment[]
}
