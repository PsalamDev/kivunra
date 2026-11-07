import { z } from 'zod'

/**
 * Owner refund request. `amount` defaults to the full captured amount when
 * omitted.
 */
export const applyRefundSchema = z.object({
  capture_id: z.uuid(),
  amount: z.coerce
    .number()
    .finite()
    .positive('Refund amount must be greater than 0')
    .max(1_000_000_000)
    .optional(),
  reason: z.string().trim().max(200).optional(),
})

export type ApplyRefundRequest = z.infer<typeof applyRefundSchema>
