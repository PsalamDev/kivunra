'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

interface PayPalButtonsInstance {
  render: (target: HTMLElement) => Promise<void>
  close: () => void
}

interface PayPalSdk {
  Buttons: (config: {
    style?: Record<string, string | number>
    createOrder: () => Promise<string>
    onApprove: (data: { orderID: string }) => Promise<void>
    onCancel?: () => void
    onError?: (error: unknown) => void
  }) => PayPalButtonsInstance
}

declare global {
  interface Window {
    paypal?: PayPalSdk
  }
}

const sdkPromises = new Map<string, Promise<PayPalSdk>>()

/** Gateway/network failures worth retrying; the server-side calls are idempotent. */
const RETRYABLE_STATUSES = new Set([502, 503, 504])

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function postForJson<T>(
  url: string,
  body: unknown,
  attempts = 3
): Promise<{ ok: boolean; status: number; data: T | null }> {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const data = (await response.json().catch(() => null)) as T | null

      if (RETRYABLE_STATUSES.has(response.status) && attempt < attempts) {
        await sleep(600 * attempt)
        continue
      }

      return { ok: response.ok, status: response.status, data }
    } catch (error) {
      lastError = error

      if (attempt === attempts) {
        break
      }

      await sleep(600 * attempt)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Network request failed')
}

function loadPayPalSdk(clientId: string, currency: string): Promise<PayPalSdk> {
  if (window.paypal) {
    return Promise.resolve(window.paypal)
  }

  const key = `${clientId}:${currency}`
  const cached = sdkPromises.get(key)
  if (cached) return cached

  const promise = new Promise<PayPalSdk>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-kivunra-paypal]')

    if (existing) {
      existing.addEventListener('load', () => {
        if (window.paypal) resolve(window.paypal)
        else reject(new Error('PayPal SDK did not initialise'))
      })
      existing.addEventListener('error', () => reject(new Error('PayPal SDK failed to load')))
      return
    }

    const script = document.createElement('script')
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(
      clientId
    )}&currency=${encodeURIComponent(currency)}&intent=capture&components=buttons&disable-funding=credit`
    script.async = true
    script.dataset.kivunraPaypal = 'true'
    script.onload = () => {
      if (window.paypal) resolve(window.paypal)
      else reject(new Error('PayPal SDK did not initialise'))
    }
    script.onerror = () => reject(new Error('PayPal SDK failed to load'))
    document.head.appendChild(script)
  })

  sdkPromises.set(key, promise)
  promise.catch(() => sdkPromises.delete(key))
  return promise
}

export function PayPalCheckout({
  token,
  clientId,
  currency,
  amountLabel,
}: {
  token: string
  clientId: string
  currency: string
  amountLabel: string
}) {
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement>(null)
  const orderInFlight = useRef(false)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [receiptReady, setReceiptReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    let buttons: PayPalButtonsInstance | null = null

    setReady(false)
    setError(null)

    loadPayPalSdk(clientId, currency)
      .then((paypal) => {
        if (cancelled || !containerRef.current) return

        containerRef.current.innerHTML = ''

        buttons = paypal.Buttons({
          style: {
            layout: 'vertical',
            color: 'gold',
            shape: 'rect',
            label: 'paypal',
            height: 45,
          },
          createOrder: async () => {
            setBusy(true)
            setError(null)

            try {
              const result = await postForJson<{ id?: string; error?: string }>(
                `/api/pay/${token}/order`,
                undefined
              )

              if (!result.ok || !result.data?.id) {
                setBusy(false)
                throw new Error(result.data?.error || 'Could not start checkout')
              }

              return result.data.id
            } catch (createError) {
              setBusy(false)
              setError(
                createError instanceof Error && createError.message
                  ? createError.message
                  : 'Could not start checkout. Please try again.'
              )
              throw createError
            }
          },
          onApprove: async ({ orderID }) => {
            if (orderInFlight.current) return
            orderInFlight.current = true
            setBusy(true)
            setError(null)

            try {
              const result = await postForJson<{
                status?: string
                invoice_status?: string
                error?: string
              }>(`/api/pay/${token}/capture`, { orderID })

              if (!result.ok) {
                setError(result.data?.error || 'Payment could not be completed. Please try again.')
                return
              }

              const data = result.data

              if (data?.status === 'COMPLETED') {
                setReceiptReady(true)
                setMessage(
                  data.invoice_status === 'Paid'
                    ? 'Payment received in full — thank you.'
                    : 'Partial payment received — thank you.'
                )
              } else {
                setMessage('Your payment is pending confirmation. This page will update once it clears.')
              }

              router.refresh()
            } finally {
              orderInFlight.current = false
              setBusy(false)
            }
          },
          onCancel: () => {
            setBusy(false)
          },
          onError: (paypalError) => {
            console.error('[paypal] buttons error', paypalError)
            setBusy(false)
            setError('Something went wrong with PayPal. Please try again.')
          },
        })

        buttons
          .render(containerRef.current)
          .then(() => {
            if (!cancelled) setReady(true)
          })
          .catch(() => setError('Could not load PayPal checkout. Please refresh and try again.'))
      })
      .catch(() => {
        if (!cancelled) {
          setError('Could not load PayPal checkout. Please refresh and try again.')
        }
      })

    return () => {
      cancelled = true
      buttons?.close()
    }
  }, [clientId, currency, token, router])

  return (
    <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 text-center">
        <p className="text-sm text-gray-600">Pay securely with PayPal</p>
        <p className="text-lg font-bold text-[#12243A]">{amountLabel}</p>
      </div>

      <div
        ref={containerRef}
        className={busy ? 'pointer-events-none opacity-60' : undefined}
      />

      {!ready && !error && (
        <p className="text-center text-sm text-gray-500">Loading PayPal…</p>
      )}

      {message && (
        <p role="status" className="mt-3 text-center text-sm font-medium text-green-700">
          {message}
        </p>
      )}

      {receiptReady && (
        <p className="mt-2 text-center text-sm">
          <a href={`/pay/${token}/receipt`} className="font-medium text-[#0EA58B] hover:underline">
            View receipt
          </a>
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 text-center text-sm text-red-700">
          {error}
        </p>
      )}

      <p className="mt-3 text-center text-xs text-gray-400">
        You will be redirected to PayPal to complete this payment.
      </p>
    </div>
  )
}
