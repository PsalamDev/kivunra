const LIVE_API_BASE = 'https://api-m.paypal.com'
const SANDBOX_API_BASE = 'https://api-m.sandbox.paypal.com'

/** PayPal does not support every currency Kivunra invoices can use. */
export const PAYPAL_CURRENCIES = ['USD', 'EUR', 'GBP'] as const
export type PayPalCurrency = (typeof PAYPAL_CURRENCIES)[number]

export function isPayPalCurrency(value: string): value is PayPalCurrency {
  return (PAYPAL_CURRENCIES as readonly string[]).includes(value.toUpperCase())
}

export function isPayPalConfigured(): boolean {
  return Boolean(
    process.env.PAYPAL_CLIENT_ID &&
      process.env.PAYPAL_CLIENT_SECRET &&
      process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID
  )
}

export function isPayPalWebhookConfigured(): boolean {
  return isPayPalConfigured() && Boolean(process.env.PAYPAL_WEBHOOK_ID)
}

function apiBase(): string {
  return process.env.PAYPAL_ENVIRONMENT === 'live' ? LIVE_API_BASE : SANDBOX_API_BASE
}

export class PayPalApiError extends Error {
  status: number
  debugId?: string
  details?: unknown

  constructor(message: string, status: number, debugId?: string, details?: unknown) {
    super(message)
    this.name = 'PayPalApiError'
    this.status = status
    this.debugId = debugId
    this.details = details
  }
}

type TokenCache = {
  accessToken: string
  expiresAt: number
}

let tokenCache: TokenCache | null = null

async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && tokenCache && tokenCache.expiresAt > Date.now()) {
    return tokenCache.accessToken
  }

  const clientId = process.env.PAYPAL_CLIENT_ID
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('PayPal is not configured')
  }

  const response = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`PayPal OAuth failed (${response.status}): ${text.slice(0, 200)}`)
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number }

  if (!data.access_token) {
    throw new Error('PayPal OAuth response did not include an access token')
  }

  // Refresh a little early so a token cannot expire mid-request.
  const lifetimeMs = Math.max((data.expires_in ?? 300) * 1000 - 60_000, 30_000)
  tokenCache = { accessToken: data.access_token, expiresAt: Date.now() + lifetimeMs }

  return data.access_token
}

async function paypalFetch<T>(
  path: string,
  init: RequestInit = {},
  retryOnUnauthorized = true
): Promise<T> {
  const token = await getAccessToken()

  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  headers.set('Content-Type', 'application/json')
  headers.set('Accept', 'application/json')

  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  })

  if (response.status === 401 && retryOnUnauthorized) {
    tokenCache = null
    return paypalFetch<T>(path, init, false)
  }

  const text = await response.text()
  let payload: unknown = null

  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = { message: text.slice(0, 300) }
    }
  }

  if (!response.ok) {
    const error = (payload ?? {}) as {
      message?: string
      debug_id?: string
      details?: unknown
    }
    throw new PayPalApiError(
      error.message ?? `PayPal request failed (${response.status})`,
      response.status,
      error.debug_id,
      error.details
    )
  }

  return payload as T
}

export interface PayPalCapture {
  id: string
  status: string
  amount?: {
    currency_code?: string
    value?: string
  }
  custom_id?: string
  invoice_id?: string
  supplementary_data?: {
    related_ids?: {
      order_id?: string
    }
  }
}

export interface PayPalOrder {
  id: string
  status: string
  purchase_units?: Array<{
    payments?: {
      captures?: PayPalCapture[]
    }
  }>
}

function formatAmount(amount: number): string {
  return (Math.round(amount * 100) / 100).toFixed(2)
}

export async function createPayPalOrder(input: {
  invoiceId: string
  invoiceNumber: string
  amount: number
  currency: string
}): Promise<PayPalOrder> {
  const currency = input.currency.toUpperCase()

  if (!isPayPalCurrency(currency)) {
    throw new Error(`PayPal does not support ${input.currency}`)
  }

  return paypalFetch<PayPalOrder>('/v2/checkout/orders', {
    method: 'POST',
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: input.invoiceId,
          custom_id: input.invoiceId,
          description: `Kivunra invoice ${input.invoiceNumber}`.slice(0, 127),
          amount: {
            currency_code: currency,
            value: formatAmount(input.amount),
          },
        },
      ],
      application_context: {
        brand_name: 'Kivunra',
        shipping_preference: 'NO_SHIPPING',
      },
    }),
  })
}

export async function capturePayPalOrder(orderId: string): Promise<PayPalOrder> {
  return paypalFetch<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    body: '{}',
    headers: {
      Prefer: 'return=representation',
    },
  })
}

const ALLOWED_CERT_HOSTS = new Set(['api.paypal.com', 'api.sandbox.paypal.com'])

export async function verifyPayPalWebhookSignature(
  headers: Headers,
  event: unknown
): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID
  if (!webhookId) {
    return false
  }

  const authAlgo = headers.get('paypal-auth-algo')
  const certUrl = headers.get('paypal-cert-url')
  const transmissionId = headers.get('paypal-transmission-id')
  const transmissionSig = headers.get('paypal-transmission-sig')
  const transmissionTime = headers.get('paypal-transmission-time')

  if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) {
    return false
  }

  // The URL is sent back to PayPal for verification, but only trust their
  // certificate hosts.
  let certHost: string
  try {
    certHost = new URL(certUrl).host
  } catch {
    return false
  }

  if (!ALLOWED_CERT_HOSTS.has(certHost)) {
    return false
  }

  const result = await paypalFetch<{ verification_status?: string }>(
    '/v1/notifications/verify-webhook-signature',
    {
      method: 'POST',
      body: JSON.stringify({
        auth_algo: authAlgo,
        cert_url: certUrl,
        transmission_id: transmissionId,
        transmission_sig: transmissionSig,
        transmission_time: transmissionTime,
        webhook_id: webhookId,
        webhook_event: event,
      }),
    }
  )

  return result.verification_status === 'SUCCESS'
}

export function payPalEnvironmentLabel(): string {
  return process.env.PAYPAL_ENVIRONMENT === 'live' ? 'live' : 'sandbox'
}
