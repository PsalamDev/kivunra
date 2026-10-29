import { NextResponse } from 'next/server'

type DatabaseError = {
  code?: string | null
  message: string
}

export function apiError(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status })
}

/**
 * Translates the error codes raised by our Postgres functions into HTTP
 * responses. Unknown failures are logged and reported generically so internal
 * schema details never leak to the client.
 */
export function databaseErrorResponse(error: DatabaseError) {
  switch (error.code) {
    case '28000':
      return apiError(401, 'Unauthorized')
    case '22023':
      return apiError(400, error.message)
    case 'P0002':
      return apiError(404, error.message || 'Not found')
    case 'PGRST116':
      return apiError(404, 'Not found')
    case '23505':
      return apiError(409, 'That invoice number is already in use. Please try again.')
    default:
      console.error('[database]', error.code ?? 'unknown', error.message)
      return apiError(500, 'Something went wrong. Please try again.')
  }
}
