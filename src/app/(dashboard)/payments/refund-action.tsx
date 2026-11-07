'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface RefundActionProps {
  captureId: string
  captureAmount: number
  refundedAmount: number
  currency: string
}

function toAmountInput(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2)
}

/**
 * Inline full/partial refund form for a completed capture. Retries are safe:
 * PayPal refund ids are unique, so a duplicate click can never pay twice.
 */
export function RefundAction({
  captureId,
  captureAmount,
  refundedAmount,
  currency,
}: RefundActionProps) {
  const router = useRouter()
  const remaining = Math.max(0, Math.round((captureAmount - refundedAmount) * 100) / 100)
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(toAmountInput(remaining))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const remainingLabel = `${currency} ${toAmountInput(remaining)}`

  if (done) {
    return <span className="text-xs text-green-700">Refund requested</span>
  }

  if (remaining <= 0.01) {
    return <span className="text-xs text-gray-500">Fully refunded</span>
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Refund
      </Button>
    )
  }

  const submit = async () => {
    const parsed = Number(amount)

    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > remaining + 0.01) {
      setError(`Enter an amount between 0.00 and ${toAmountInput(remaining)}.`)
      return
    }

    setBusy(true)
    setError(null)

    try {
      const res = await fetch('/api/refunds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capture_id: captureId, amount: parsed }),
      })

      const data = (await res.json().catch(() => null)) as { error?: string } | null

      if (!res.ok) {
        setError(data?.error || 'Could not request the refund. Please try again.')
        return
      }

      setDone(true)
      router.refresh()
    } catch (err) {
      console.error('Error requesting refund:', err)
      setError('Could not request the refund. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 py-1">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 whitespace-nowrap">
          {remainingLabel} left
        </span>
        <Input
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
          className="w-24 h-8 text-sm"
          aria-label="Refund amount"
        />
        <Button type="button" size="sm" onClick={submit} disabled={busy}>
          {busy ? 'Refunding...' : 'Confirm'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setOpen(false)
            setError(null)
          }}
          disabled={busy}
        >
          Cancel
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
