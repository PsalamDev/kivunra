/**
 * Supabase returns provider-level wording ("email rate limit exceeded",
 * "Invalid login credentials") that means nothing to an end user. These map the
 * common cases onto something actionable while leaving unknown messages intact.
 */
const FRIENDLY: Array<[RegExp, string]> = [
  [
    /email rate limit exceeded/i,
    'We have sent too many confirmation emails in the last hour. Try again shortly, or sign in if your account is already confirmed.',
  ],
  [
    /email not confirmed/i,
    'Your email is not confirmed yet. Open the confirmation link we emailed you, then sign in.',
  ],
  [
    /invalid login credentials/i,
    'That email and password do not match an account.',
  ],
  [
    /user already registered/i,
    'An account with this email already exists. Sign in instead.',
  ],
  [
    /password should be at least (\d+) characters/i,
    'Your password is too short.',
  ],
  [
    /signups? not allowed/i,
    'New signups are disabled for this project.',
  ],
  [
    /unable to validate email address/i,
    'That email address is not valid.',
  ],
  [
    /for security purposes, you can only request this after (\d+) seconds/i,
    'Please wait a moment before trying again.',
  ],
]

export function friendlyAuthError(message: string, fallback: string): string {
  for (const [pattern, text] of FRIENDLY) {
    if (pattern.test(message)) {
      return text
    }
  }

  return message || fallback
}
