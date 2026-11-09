'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, KeyRound, RotateCw, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface AutomationKeyCardProps {
  configured: boolean
  createdAt: string | null
}

async function readError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null
  return payload?.error ?? 'Something went wrong. Please try again.'
}

export function AutomationKeyCard({ configured, createdAt }: AutomationKeyCardProps) {
  const [hasKey, setHasKey] = useState(configured)
  const [keyCreatedAt, setKeyCreatedAt] = useState(createdAt)
  const [issuedKey, setIssuedKey] = useState<string | null>(null)
  const [origin, setOrigin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  const generate = async () => {
    setLoading(true)
    setError(null)
    setCopied(false)

    try {
      const response = await fetch('/api/automation/key', { method: 'POST' })

      if (!response.ok) {
        setError(await readError(response))
        return
      }

      const payload = (await response.json()) as { key: string; created_at: string }
      setIssuedKey(payload.key)
      setHasKey(true)
      setKeyCreatedAt(payload.created_at)
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const revoke = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/automation/key', { method: 'DELETE' })

      if (!response.ok) {
        setError(await readError(response))
        return
      }

      setIssuedKey(null)
      setHasKey(false)
      setKeyCreatedAt(null)
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const copyKey = async () => {
    if (!issuedKey) return

    try {
      await navigator.clipboard.writeText(issuedKey)
      setCopied(true)
    } catch {
      setError('Copy failed. Select the key and copy it manually.')
    }
  }

  const webhookUrl = `${origin || 'https://your-app'}/api/automation/invoice-draft`

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-[#0EA58B]" />
          Automation (Zapier)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-gray-600">
          Connect Zapier so a new client email becomes a Draft invoice. Send the email body to this
          endpoint with your key in the <code className="rounded bg-gray-100 px-1">Authorization</code>{' '}
          header.
        </p>

        <div>
          <p className="text-sm font-medium text-gray-700">Webhook URL</p>
          <code className="mt-1 block break-all rounded bg-gray-100 px-3 py-2 text-xs text-[#12243A]">
            {webhookUrl}
          </code>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-gray-200 px-3 py-2">
          <div>
            <p className="text-sm font-medium text-gray-700">
              {hasKey ? 'Key active' : 'No key yet'}
            </p>
            <p className="text-xs text-gray-500">
              {hasKey && keyCreatedAt
                ? `Created ${keyCreatedAt.slice(0, 10)}. Rotating invalidates the old key.`
                : 'Generate a key to let Zapier draft invoices on your behalf.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {hasKey && (
              <Button type="button" variant="outline" size="sm" onClick={revoke} disabled={loading}>
                <Trash2 className="mr-2 h-4 w-4" />
                Revoke
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              onClick={generate}
              disabled={loading}
              className="bg-[#0EA58B] hover:bg-[#0c9479]"
            >
              <RotateCw className="mr-2 h-4 w-4" />
              {loading ? 'Working...' : hasKey ? 'Rotate key' : 'Generate key'}
            </Button>
          </div>
        </div>

        {issuedKey && (
          <div className="space-y-2 rounded border border-amber-200 bg-amber-50 px-3 py-3">
            <p className="text-sm font-medium text-amber-900">
              Copy this key now. It is not shown again.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded bg-white px-3 py-2 text-xs text-[#12243A]">
                {issuedKey}
              </code>
              <Button type="button" variant="outline" size="sm" onClick={copyKey}>
                {copied ? (
                  <>
                    <Check className="mr-2 h-4 w-4" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="mr-2 h-4 w-4" /> Copy
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-amber-800">
              Store it in Zapier only. Anyone with this key can create drafts in your journal.
            </p>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <p className="text-xs text-gray-500">
          The endpoint creates a Draft invoice, never a published or emailed one. It recognizes your
          existing customers by email and can add a new customer when you ask it to.
        </p>
      </CardContent>
    </Card>
  )
}
