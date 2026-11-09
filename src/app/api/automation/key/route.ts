import { NextRequest, NextResponse } from 'next/server'

import { apiError } from '@/lib/api-error'
import {
  AUTOMATION_KEY_CREATED_METADATA,
  AUTOMATION_KEY_METADATA,
  automationKeyConfigured,
  automationKeyCreatedAt,
  generateAutomationKey,
} from '@/lib/automation'
import { createAdminClient, isServiceRoleConfigured } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Cookie-authenticated endpoint behind the Settings → Automation card.
 * The plaintext key is returned exactly once; only its hash is stored.
 */
async function currentUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return user
}

/** Reject cross-site form posts that reuse the owner's session cookie. */
function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin')

  if (!origin) {
    return false
  }

  try {
    return new URL(origin).host === request.nextUrl.host
  } catch {
    return false
  }
}

function serviceRoleGuard() {
  if (!isServiceRoleConfigured()) {
    return apiError(503, 'Automation keys are not available on this deployment.')
  }

  return null
}

export async function GET() {
  const user = await currentUser()

  if (!user) {
    return apiError(401, 'Unauthorized')
  }

  return NextResponse.json({
    configured: automationKeyConfigured(user.user_metadata),
    created_at: automationKeyCreatedAt(user.user_metadata),
  })
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return apiError(403, 'Forbidden')
  }

  const user = await currentUser()

  if (!user) {
    return apiError(401, 'Unauthorized')
  }

  const guard = serviceRoleGuard()

  if (guard) {
    return guard
  }

  const { token, hash } = generateAutomationKey(user.id)
  const createdAt = new Date().toISOString()
  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...user.user_metadata,
      [AUTOMATION_KEY_METADATA]: hash,
      [AUTOMATION_KEY_CREATED_METADATA]: createdAt,
    },
  })

  if (error) {
    console.error('[automation] could not store key', error.message)
    return apiError(500, 'Could not create the automation key. Please try again.')
  }

  return NextResponse.json({ key: token, created_at: createdAt })
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) {
    return apiError(403, 'Forbidden')
  }

  const user = await currentUser()

  if (!user) {
    return apiError(401, 'Unauthorized')
  }

  const guard = serviceRoleGuard()

  if (guard) {
    return guard
  }

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...user.user_metadata,
      [AUTOMATION_KEY_METADATA]: null,
      [AUTOMATION_KEY_CREATED_METADATA]: null,
    },
  })

  if (error) {
    console.error('[automation] could not revoke key', error.message)
    return apiError(500, 'Could not revoke the automation key. Please try again.')
  }

  return NextResponse.json({ revoked: true })
}
