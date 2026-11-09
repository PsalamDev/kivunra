'use server'

import { loginAction, signupAction, signoutAction } from '@/lib/auth-actions'

export async function login(formData: FormData) {
  return loginAction(formData)
}

export async function signup(formData: FormData) {
  return signupAction(formData)
}

export async function signout() {
  return signoutAction()
}
