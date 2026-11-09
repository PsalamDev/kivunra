'use server'

import { resendCodeAction, verifyCodeAction } from '@/lib/auth-actions'

export async function verifyCode(formData: FormData) {
  return verifyCodeAction(formData)
}

export async function resendCode(formData: FormData) {
  return resendCodeAction(formData)
}
