import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { z } from 'zod'

import { SUPPORTED_CURRENCIES } from './validation'

/**
 * Automation keys are shown once and stored only as a SHA-256 hash inside the
 * owner's Supabase user metadata. The user id is embedded in the token so a
 * request can be authenticated without a lookup table or a migration.
 */
export const AUTOMATION_KEY_PREFIX = 'kvz'
export const AUTOMATION_KEY_METADATA = 'automation_key_hash'
export const AUTOMATION_KEY_CREATED_METADATA = 'automation_key_created_at'

export const automationDraftSchema = z.object({
  text: z
    .string()
    .trim()
    .min(10, 'Provide at least 10 characters of source text')
    .max(6000, 'Keep the source text under 6000 characters'),
  subject: z.string().trim().max(300).optional(),
  from_email: z.email().max(320).optional(),
  customer_id: z.uuid().nullish(),
  currency: z.enum(SUPPORTED_CURRENCIES).optional(),
  create_customer: z.boolean().default(false),
  create_invoice: z.boolean().default(true),
  external_id: z.string().trim().min(1).max(200).optional(),
})

export type AutomationDraftInput = z.infer<typeof automationDraftSchema>

export function hashAutomationSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

export function generateAutomationKey(userId: string): { token: string; hash: string } {
  const secret = randomBytes(32).toString('hex')

  return {
    token: `${AUTOMATION_KEY_PREFIX}_${userId}_${secret}`,
    hash: hashAutomationSecret(secret),
  }
}

export function parseAutomationToken(token: string): { userId: string; secret: string } | null {
  const match = /^kvz_([0-9a-fA-F-]{36})_([0-9a-f]{64})$/.exec(token.trim())

  if (!match) {
    return null
  }

  return { userId: match[1], secret: match[2] }
}

export function automationSecretMatches(
  secret: string,
  storedHash: string | null | undefined
): boolean {
  if (!storedHash) {
    return false
  }

  const computed = Buffer.from(hashAutomationSecret(secret), 'hex')
  const stored = Buffer.from(storedHash, 'hex')

  return computed.length === stored.length && timingSafeEqual(computed, stored)
}

/** Adds the email envelope to the source text the model sees. */
export function composeAutomationSource(input: {
  text: string
  subject?: string
  from_email?: string
}): string {
  const lines: string[] = []

  if (input.subject) {
    lines.push(`Subject: ${input.subject}`)
  }

  if (input.from_email) {
    lines.push(`From: ${input.from_email}`)
  }

  if (lines.length > 0) {
    lines.push('', input.text)
    return lines.join('\n')
  }

  return input.text
}

export function automationKeyConfigured(metadata: Record<string, unknown> | null | undefined) {
  return typeof metadata?.[AUTOMATION_KEY_METADATA] === 'string'
}

export function automationKeyCreatedAt(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  const value = metadata?.[AUTOMATION_KEY_CREATED_METADATA]
  return typeof value === 'string' ? value : null
}
