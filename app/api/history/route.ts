import { getArenaEmailId } from '@/lib/arena-email'
import { ARENA_ACCESS_DENIED_MESSAGE } from '@/lib/arena-email-constants'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const HISTORY_URL =
  'https://agent.thearena.ai/api/workflows/38458816-0871-4c2f-8545-39654a5530cc/execute'
const SIM_API_KEY = 'sk-sim-Vk9yj3QfVSZxJ8lulZTYK549u5ThZo9u'

/**
 * Fetches the visitor's previous Article Enhancer runs from the build-history
 * workflow, keyed by the Arena email cookie set by middleware. Returns the
 * upstream JSON body unchanged so the client can normalize it tolerantly.
 */
export async function GET(): Promise<Response> {
  const email = await getArenaEmailId()
  if (!email) {
    return Response.json({ error: ARENA_ACCESS_DENIED_MESSAGE }, { status: 401 })
  }

  let upstream: Response
  try {
    upstream = await fetch(HISTORY_URL, {
      method: 'POST',
      headers: {
        'X-API-Key': SIM_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        type: 'article_enhancer',
        stream: false,
        selectedOutputs: ['buildhistory.result'],
      }),
      cache: 'no-store',
    })
  } catch {
    return Response.json(
      { error: 'Could not reach the history service. Please try again.' },
      { status: 502 },
    )
  }

  const text = await upstream.text().catch(() => '')

  if (!upstream.ok) {
    const status = upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502
    return Response.json(
      {
        error: `The history service returned an error (${upstream.status}).`,
        detail: text.slice(0, 500),
      },
      { status },
    )
  }

  let data: unknown
  try {
    data = JSON.parse(text) as unknown
  } catch {
    // Upstream returned a non-JSON body — wrap it so the client can still
    // attempt salvage parsing on the raw text.
    data = { result: text }
  }

  return Response.json(data)
}
