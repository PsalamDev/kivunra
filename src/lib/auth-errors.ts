/**
 * Supabase returns provider-level wording ("email rate limit exceeded",
 * "Invalid login credentials") that means nothing to an end user. These map the
 * common cases onto something actionable while leaving unknown messages intact.
 */
type Friendly = [RegExp, string | ((match: RegExpMatchArray) => string)]

const FRIENDLY: Friendly[] = [
  [
    /email rate limit exceeded/i,
    'We have sent too many confirmation emails in the last hour. Try again shortly, or sign in if your account is already confirmed.',
  ],
  [
    /email not confirmed/i,
    'Your email is not confirmed yet. Enter the code we emailed you, or open the confirmation link, then sign in.',
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
    /token has expired or is invalid/i,
    'That code is incorrect or has expired. Check the newest email, or send a new code.',
  ],
  [
    /invalid (otp|token)/i,
    'That code is incorrect or has expired. Check the newest email, or send a new code.',
  ],
  [
    /for security purposes, you can only request this after (\d+) seconds/i,
    (match) => `Please wait ${match[1]} seconds before requesting another one.`,
  ],
]

export function friendlyAuthError(message: string, fallback: string): string {
  for (const [pattern, replacement] of FRIENDLY) {
    const match = message.match(pattern)
    if (!match) continue

    return typeof replacement === 'string' ? replacement : replacement(match)
  }

  return message || fallback
}
