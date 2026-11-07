export interface User {
  id: string;
  email: string;
  full_name?: string;
}

export interface Customer {
  id: string;
  owner_user_id: string;
  name: string;
  email?: string;
  created_at: string;
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export interface Invoice {
  id: string;
  owner_user_id: string;
  customer_id?: string;
  invoice_number: string;
  currency: string;
  total: number;
  status: 'Draft' | 'Published' | 'PartiallyPaid' | 'Paid' | 'Cancelled' | 'Overdue';
  due_at?: string;
  public_token_hash?: string;
  created_at: string;
  updated_at: string;
  customer?: Customer;
  items?: InvoiceItem[];
}

export interface PaymentOrder {
  id: string;
  invoice_id: string;
  paypal_order_id?: string;
  expected_amount: number;
  currency: string;
  status: 'Created' | 'PayerApproved' | 'CapturePending' | 'Captured' | 'Failed' | 'Cancelled';
  created_at: string;
}

export interface PaymentRefund {
  id: string;
  payment_capture_id: string;
  paypal_refund_id: string;
  amount: number;
  currency: string;
  status: 'COMPLETED' | 'PENDING' | 'CANCELLED' | 'FAILED';
  reason?: string;
  refunded_at: string;
}

export type NotificationType = 'PaymentReceived' | 'RefundProcessed';

export interface Notification {
  id: string;
  owner_user_id: string;
  type: NotificationType;
  title: string;
  body?: string;
  source_type?: string;
  source_id?: string;
  read_at?: string;
  created_at: string;
}

export interface LedgerEntry {
  id: string;
  owner_user_id: string;
  source_type: 'Invoice' | 'Expense' | 'Manual' | 'Payment' | 'Refund';
  source_id: string;
  direction: 'Income' | 'Expense';
  amount: number;
  currency: string;
  category_id?: string;
  posted_at: string;
}

export interface InvoiceDraft {
  customer_name: string;
  customer_email?: string;
  items: Array<{
    description: string;
    quantity: number;
    unit_price: number;
  }>;
  currency: string;
  due_date?: string;
  notes?: string;
}
