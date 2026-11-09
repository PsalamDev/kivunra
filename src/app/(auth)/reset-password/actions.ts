'use server'

import { updatePasswordAction } from '@/lib/auth-actions'

export async function updatePassword(formData: FormData) {
  return updatePasswordAction(formData)
}
