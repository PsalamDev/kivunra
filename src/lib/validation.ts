import { z } from 'zod'

import { INVOICE_STATUSES } from './invoices'

const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'NGN'] as const

const dateLike = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date')

export const invoiceItemSchema = z.object({
  description: z.string().trim().min(1, 'Description is required').max(500),
  quantity: z.coerce.number().finite().positive('Quantity must be greater than 0').max(1_000_000),
  unit_price: z.coerce.number().finite().min(0, 'Unit price cannot be negative').max(1_000_000_000),
})

export const createInvoiceSchema = z.object({
  customer_id: z.uuid().nullish(),
  items: z.array(invoiceItemSchema).min(1, 'At least one item is required').max(200),
  currency: z.enum(SUPPORTED_CURRENCIES).default('USD'),
  due_at: dateLike.nullish(),
})

export const updateInvoiceSchema = z
  .object({
    status: z.enum(INVOICE_STATUSES).optional(),
    items: z.array(invoiceItemSchema).min(1, 'At least one item is required').max(200).optional(),
    customer_id: z.uuid().nullish(),
    due_at: dateLike.nullish(),
  })
  .refine((value) => Object.keys(value).length > 0, 'No fields to update')

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>
