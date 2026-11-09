'use server'

import { signupAction } from '@/lib/auth-actions'

export async function signup(formData: FormData) {
  return signupAction(formData)
}
