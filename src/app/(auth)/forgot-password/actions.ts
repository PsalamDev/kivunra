'use server'

import { requestPasswordResetAction } from '@/lib/auth-actions'

export async function requestReset(formData: FormData) {
  return requestPasswordResetAction(formData)
}
