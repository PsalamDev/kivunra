import { createHash, createHmac } from 'node:crypto'

const MIN_SECRET_LENGTH = 32

function getSecret(): string {
  const secret = process.env.INVOICE_TOKEN_SECRET

  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `INVOICE_TOKEN_SECRET must be set to a random value of at least ${MIN_SECRET_LENGTH} characters`
    )
  }

  return secret
}

export function isInvoiceTokenConfigured(): boolean {
  const secret = process.env.INVOICE_TOKEN_SECRET
  return Boolean(secret && secret.length >= MIN_SECRET_LENGTH)
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/

/** Cheap shape check so malformed tokens never reach the database. */
export function isInvoiceTokenShape(token: string): boolean {
  return TOKEN_PATTERN.test(token)
}

/**
 * Deterministic capability token for an invoice.
 *
 * Deterministic (HMAC of the invoice id) so the owner can be shown the same
 * pay link at any time, while only the SHA-256 hash is persisted. Guessing is
 * infeasible without INVOICE_TOKEN_SECRET.
 */
export function createInvoiceToken(invoiceId: string): string {
  return createHmac('sha256', getSecret())
    .update(`invoice:${invoiceId}`)
    .digest('base64url')
}

export function hashInvoiceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
