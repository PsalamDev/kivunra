const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'

/** Override with GROQ_MODEL if this one is retired in your project. */
export const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile'

export function isGroqConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY)
}

export function getGroqModel(): string {
  const configured = process.env.GROQ_MODEL?.trim()
  return configured || DEFAULT_GROQ_MODEL
}

export class GroqApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'GroqApiError'
    this.status = status
  }
}

interface GroqResponse {
  model?: string
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
  error?: {
    message?: string
  }
}

export async function createGroqCompletion(input: {
  system: string
  user: string
  maxTokens?: number
  temperature?: number
}): Promise<{ content: string; model: string }> {
  const apiKey = process.env.GROQ_API_KEY

  if (!apiKey) {
    throw new Error('Groq is not configured')
  }

  const model = getGroqModel()

  const response = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: input.temperature ?? 0.2,
      max_tokens: input.maxTokens ?? 1400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(25_000),
  })

  const text = await response.text()
  let payload: GroqResponse | null = null

  if (text) {
    try {
      payload = JSON.parse(text) as GroqResponse
    } catch {
      // Fall through with a null payload and report the status below.
    }
  }

  if (!response.ok) {
    throw new GroqApiError(
      payload?.error?.message ?? `Groq request failed (${response.status})`,
      response.status
    )
  }

  const content = payload?.choices?.[0]?.message?.content

  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Groq returned an empty response')
  }

  return {
    content,
    model: typeof payload?.model === 'string' ? payload.model : model,
  }
}

/**
 * Models occasionally wrap JSON in prose or a code fence even in JSON mode.
 * Try the raw response first, then the first fenced block, then the outermost
 * object braces.
 */
export function parseJsonObject(content: string): unknown {
  const candidates: string[] = [content.trim()]

  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    candidates.push(fenced[1].trim())
  }

  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start >= 0 && end > start) {
    candidates.push(content.slice(start, end + 1))
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error('Model did not return valid JSON')
}
