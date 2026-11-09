import { formatDate, formatMoney } from './format'

/**
 * Transactional email with a provider switch.
 *
 * - Brevo: set BREVO_API_KEY. Brevo can verify a single sender address, so a
 *   custom domain is not required (recommended for deliverability though).
 * - Resend: set RESEND_API_KEY. The shared `onboarding@resend.dev` sender can
 *   only deliver to the Resend account owner.
 *
 * `EMAIL_PROVIDER` picks explicitly (`brevo` | `resend`). When unset, Brevo is
 * preferred if its key exists, otherwise Resend. `INVOICE_EMAIL_FROM` is the
 * verified sender for whichever provider is active.
 */

const DEFAULT_RESEND_BASE = 'https://api.resend.com'
const DEFAULT_BREVO_BASE = 'https://api.brevo.com'

/** Connection-level failures prove the request never reached the provider. */
const CONNECT_ERROR_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'UND_ERR_CONNECT_TIMEOUT',
])

type EmailProvider = 'brevo' | 'resend'

export class EmailDeliveryError extends Error {
  readonly status: number

  constructor(message: string, status = 502) {
    super(message)
    this.name = 'EmailDeliveryError'
    this.status = status
  }
}

function configuredProvider(): EmailProvider | null {
  const explicit = process.env.EMAIL_PROVIDER?.trim().toLowerCase()

  if (explicit === 'brevo') {
    return process.env.BREVO_API_KEY ? 'brevo' : null
  }

  if (explicit === 'resend') {
    return process.env.RESEND_API_KEY ? 'resend' : null
  }

  if (process.env.BREVO_API_KEY) {
    return 'brevo'
  }

  if (process.env.RESEND_API_KEY) {
    return 'resend'
  }

  return null
}

export function isEmailConfigured(): boolean {
  return Boolean(configuredProvider() && process.env.INVOICE_EMAIL_FROM)
}

function isConnectError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  const cause = (error as { cause?: unknown }).cause
  const code =
    cause && typeof cause === 'object' && 'code' in cause
      ? String((cause as { code?: unknown }).code)
      : ''

  return CONNECT_ERROR_CODES.has(code)
}

function providerError(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as { message?: unknown }).message
    if (typeof message === 'string' && message) {
      return message
    }
  }

  return `Email provider rejected the message (${status}).`
}

async function postWithRetry(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  attempts = 3
): Promise<Record<string, unknown> | null> {
  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      })

      const payload = (await response.json().catch(() => null)) as
        | Record<string, unknown>
        | null

      if (!response.ok) {
        throw new EmailDeliveryError(providerError(payload, response.status), 502)
      }

      return payload
    } catch (error) {
      lastError = error

      if (
        error instanceof EmailDeliveryError ||
        attempt === attempts ||
        !isConnectError(error)
      ) {
        throw error
      }

      await new Promise((resolve) => setTimeout(resolve, 300 * attempt))
    }
  }

  throw lastError
}

function parseSender(from: string): { name: string; email: string } {
  const match = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/)

  if (match) {
    const name = match[1].replace(/^"|"$/g, '').trim() || 'Kivunra'
    return { name, email: match[2].trim() }
  }

  return { name: 'Kivunra', email: from.trim() }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface InvoiceEmailItem {
  description: string
  quantity: number | string
  line_total: number | string | null
}

export interface InvoiceEmailInput {
  to: string
  customerName: string | null
  invoiceNumber: string
  currency: string
  amountDue: number
  dueAt: string | null
  payUrl: string
  senderName: string | null
  replyTo: string | null
  items: InvoiceEmailItem[]
}

async function sendWithResend(input: {
  from: string
  to: string
  subject: string
  html: string
  text: string
  replyTo: string | null
}): Promise<string | null> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    throw new EmailDeliveryError('Resend is not configured on this deployment.', 503)
  }

  const base = (process.env.RESEND_API_URL?.trim() || DEFAULT_RESEND_BASE).replace(/\/$/, '')
  const payload = await postWithRetry(
    `${base}/emails`,
    { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    {
      from: input.from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    }
  )

  return typeof payload?.id === 'string' ? payload.id : null
}

async function sendWithBrevo(input: {
  from: string
  to: string
  subject: string
  html: string
  text: string
  replyTo: string | null
}): Promise<string | null> {
  const apiKey = process.env.BREVO_API_KEY?.trim()
  if (!apiKey) {
    throw new EmailDeliveryError('Brevo is not configured on this deployment.', 503)
  }

  const base = (process.env.BREVO_API_URL?.trim() || DEFAULT_BREVO_BASE).replace(/\/$/, '')
  const payload = await postWithRetry(
    `${base}/v3/smtp/email`,
    {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    {
      sender: parseSender(input.from),
      to: [{ email: input.to }],
      subject: input.subject,
      htmlContent: input.html,
      textContent: input.text,
      ...(input.replyTo ? { replyTo: { email: input.replyTo } } : {}),
    }
  )

  return typeof payload?.messageId === 'string' ? payload.messageId : null
}

export async function sendInvoiceEmail(input: InvoiceEmailInput): Promise<string | null> {
  const provider = configuredProvider()
  const from = process.env.INVOICE_EMAIL_FROM?.trim()

  if (!provider || !from) {
    throw new EmailDeliveryError('Email sending is not configured on this deployment.', 503)
  }

  const amount = formatMoney(input.currency, input.amountDue)
  const due = input.dueAt ? formatDate(input.dueAt) : null
  const greeting = input.customerName ? `Hi ${input.customerName},` : 'Hi,'
  const sender = input.senderName || 'Your client'
  const subject = `Invoice ${input.invoiceNumber}: ${amount} due`

  const itemRows = input.items
    .map((item) => {
      const lineTotal = Number(item.line_total ?? 0)
      return `<tr>
        <td style="padding:8px 0;color:#374151;border-bottom:1px solid #E5E7EB;">${escapeHtml(
          item.description
        )}</td>
        <td style="padding:8px 0;color:#6B7280;text-align:right;border-bottom:1px solid #E5E7EB;">${escapeHtml(
          String(item.quantity)
        )}</td>
        <td style="padding:8px 0;color:#111827;text-align:right;border-bottom:1px solid #E5E7EB;">${escapeHtml(
          formatMoney(input.currency, lineTotal)
        )}</td>
      </tr>`
    })
    .join('')

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#F9FAFB;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:12px;padding:32px;border:1px solid #E5E7EB;">
      <p style="margin:0 0 4px;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#0EA58B;font-weight:bold;">Kivunra</p>
      <h1 style="margin:0 0 20px;font-size:22px;color:#111827;">Invoice ${escapeHtml(
        input.invoiceNumber
      )}</h1>
      <p style="margin:0 0 12px;color:#374151;">${escapeHtml(greeting)}</p>
      <p style="margin:0 0 20px;color:#374151;">
        ${escapeHtml(sender)} sent you an invoice for
        <strong>${escapeHtml(amount)}</strong>${due ? `, due by ${escapeHtml(due)}` : ''}.
      </p>
      ${
        itemRows
          ? `<table style="width:100%;border-collapse:collapse;margin:0 0 24px;font-size:14px;">
        <thead>
          <tr>
            <th style="padding:0 0 8px;text-align:left;font-size:12px;color:#6B7280;font-weight:normal;">Description</th>
            <th style="padding:0 0 8px;text-align:right;font-size:12px;color:#6B7280;font-weight:normal;">Qty</th>
            <th style="padding:0 0 8px;text-align:right;font-size:12px;color:#6B7280;font-weight:normal;">Amount</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>`
          : ''
      }
      <a href="${escapeHtml(input.payUrl)}"
         style="display:inline-block;background:#0EA58B;color:#FFFFFF;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:8px;">
        View and pay ${escapeHtml(amount)}
      </a>
      <p style="margin:24px 0 0;font-size:13px;color:#6B7280;">
        Or open this secure link:<br />
        <a href="${escapeHtml(input.payUrl)}" style="color:#0EA58B;word-break:break-all;">${escapeHtml(
          input.payUrl
        )}</a>
      </p>
      <p style="margin:24px 0 0;font-size:12px;color:#9CA3AF;">
        Paid with PayPal. The link is unique to this invoice and does not require an account.
      </p>
    </div>
  </body>
</html>`

  const text = [
    greeting,
    '',
    `${sender} sent you invoice ${input.invoiceNumber} for ${amount}${
      due ? `, due by ${due}` : ''
    }.`,
    '',
    `View and pay securely: ${input.payUrl}`,
    '',
    'Paid with PayPal. The link is unique to this invoice and does not require an account.',
  ].join('\n')

  const message = {
    from,
    to: input.to,
    subject,
    html,
    text,
    replyTo: input.replyTo,
  }

  return provider === 'brevo' ? sendWithBrevo(message) : sendWithResend(message)
}
