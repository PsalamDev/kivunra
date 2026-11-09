'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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
  // A stray newline from a hosting dashboard makes PayPal answer 400, so the
  // id is normalised before it reaches the SDK URL.
  const id = clientId.trim()

  if (!id) {
    return Promise.reject(new Error('PayPal client id is missing'))
  }

  if (window.paypal) {
    return Promise.resolve(window.paypal)
  }

  const key = `${id}:${currency}`
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
      id
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
  returnedOrderId,
}: {
  token: string
  clientId: string
  currency: string
  amountLabel: string
  /** PayPal order id from `?token=` when PayPal redirected the payer back. */
  returnedOrderId?: string | null
}) {
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement>(null)
  const orderInFlight = useRef(false)
  const returnHandled = useRef(false)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const captureOrder = useCallback(
    async (orderID: string) => {
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
          setMessage(
            data.invoice_status === 'Paid'
              ? 'Payment received in full — thank you.'
              : 'Partial payment received — thank you.'
          )
          router.replace(`/pay/${token}/success`)
        } else {
          setMessage('Your payment is pending confirmation. This page will update once it clears.')
          router.replace(`/pay/${token}/success?status=pending`)
        }
      } finally {
        orderInFlight.current = false
        setBusy(false)
      }
    },
    [router, token]
  )

  // When PayPal redirects back after approval the order is only APPROVED, so
  // the money must still be captured. Do it once on mount, then show the receipt.
  useEffect(() => {
    if (!returnedOrderId || returnHandled.current) return
    returnHandled.current = true
    void captureOrder(returnedOrderId)
  }, [captureOrder, returnedOrderId])

  useEffect(() => {
    let cancelled = false
    let buttons: PayPalButtonsInstance | null = null
    let observer: MutationObserver | null = null
    let renderTimeout: ReturnType<typeof setTimeout> | null = null

    const clearWatch = () => {
      observer?.disconnect()
      observer = null
      if (renderTimeout) clearTimeout(renderTimeout)
      renderTimeout = null
    }

    // PayPal's render() promise does not always settle even when the button is
    // on screen, so readiness is also detected from the container itself.
    const markRendered = () => {
      if (cancelled) return
      clearWatch()
      setReady(true)
      setError(null)
    }

    const fail = (message: string) => {
      if (cancelled) return
      clearWatch()
      setError(message)
    }

    setReady(false)
    setError(null)

    loadPayPalSdk(clientId, currency)
      .then((paypal) => {
        if (cancelled || !containerRef.current) return

        const container = containerRef.current
        container.innerHTML = ''

        observer = new MutationObserver(() => {
          if (container.childElementCount > 0) markRendered()
        })
        observer.observe(container, { childList: true, subtree: true })

        renderTimeout = setTimeout(() => {
          if (!cancelled && container.childElementCount === 0) {
            fail('Could not load PayPal checkout. Please try again.')
          }
        }, 20_000)

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
            await captureOrder(orderID)
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
          .render(container)
          .then(markRendered)
          .catch(() => fail('Could not load PayPal checkout. Please try again.'))
      })
      .catch(() => {
        fail('Could not load PayPal checkout. Please try again.')
      })

    return () => {
      cancelled = true
      clearWatch()
      buttons?.close()
    }
  }, [attempt, captureOrder, clientId, currency, token])

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
        <div className="mt-3 text-center">
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            className="mt-2 text-sm font-medium text-[#0EA58B] hover:underline"
          >
            Try again
          </button>
        </div>
      )}

      <p className="mt-3 text-center text-xs text-gray-400">
        You will be redirected to PayPal to complete this payment.
      </p>
    </div>
  )
}
