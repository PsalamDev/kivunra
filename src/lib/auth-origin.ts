import { headers } from 'next/headers'

/**
 * Absolute origin of the current request.
 *
 * Confirmation and password-reset links must point at the host the user is
 * actually on. NEXT_PUBLIC_APP_URL is deliberately not used: it can be a tunnel
 * or a staging alias, which would send people to the wrong deployment.
 */
export async function requestOrigin(): Promise<string> {
  const store = await headers()
  const forwardedHost = store.get('x-forwarded-host')
  const host = forwardedHost ?? store.get('host')
  const proto = store.get('x-forwarded-proto') ?? (host?.startsWith('localhost') ? 'http' : 'https')

  if (!host) {
    return 'http://localhost:3000'
  }

  return `${proto}://${host}`
}

/** Only allow same-site relative paths as post-auth destinations. */
export function safeNextPath(value: string | null | undefined, fallback = '/dashboard'): string {
  if (!value) return fallback
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return fallback
  }
  return value
}
