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
              const response = await fetch(`/api/pay/${token}/order`, { method: 'POST' })
              const data = (await response.json().catch(() => null)) as
                | { id?: string; error?: string }
                | null

              if (!response.ok || !data?.id) {
                setBusy(false)
                throw new Error(data?.error || 'Could not start checkout')
              }

              return data.id
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
              const response = await fetch(`/api/pay/${token}/capture`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderID }),
              })
              const data = (await response.json().catch(() => null)) as
                | { status?: string; invoice_status?: string; error?: string }
                | null

              if (!response.ok) {
                setError(data?.error || 'Payment could not be completed. Please try again.')
                return
              }

              if (data?.status === 'COMPLETED') {
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
