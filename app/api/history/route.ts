import { prisma } from '@/lib/prisma'
import { getArenaEmailId } from '@/lib/arena-email'
import { ARENA_ACCESS_DENIED_MESSAGE } from '@/lib/arena-email-constants'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const HISTORY_URL =
  'https://agent.thearena.ai/api/workflows/38458816-0871-4c2f-8545-39654a5530cc/execute'
const SIM_API_KEY = 'sk-sim-Vk9yj3QfVSZxJ8lulZTYK549u5ThZo9u'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const TIMESTAMP_KEYS = [
  'createdAt',
  'created_at',
  'timestamp',
  'generated_at',
  'date',
  'time',
  'updated_at',
]

function hasOwnTimestamp(rec: Record<string, unknown>): boolean {
  return TIMESTAMP_KEYS.some((key) => {
    const value = rec[key]
    return (typeof value === 'string' && value.trim().length > 0) || typeof value === 'number'
  })
}

function entryArticleUrl(rec: Record<string, unknown>): string {
  for (const key of ['article_url', 'url']) {
    const direct = rec[key]
    if (typeof direct === 'string' && direct.trim()) return direct.trim()
  }
  const input = rec['input']
  if (isRecord(input)) {
    for (const key of ['article_url', 'url']) {
      const nested = input[key]
      if (typeof nested === 'string' && nested.trim()) return nested.trim()
    }
  }
  return ''
}

/**
 * Loads the persisted run timestamps for this visitor from EnhancementLog
 * (createdAt is written at execution time by /api/enhance). Keyed by
 * lowercased article URL, newest first, so repeated runs of the same URL map
 * to distinct timestamps in reverse-chronological order.
 */
async function loadCreatedAtByUrl(email: string): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  try {
    const logs = await prisma.enhancementLog.findMany({
      where: { email },
      orderBy: { createdAt: 'desc' },
      select: { articleUrl: true, createdAt: true },
    })
    for (const log of logs) {
      const key = log.articleUrl.trim().toLowerCase()
      if (!key) continue
      const existing = map.get(key)
      if (existing) {
        existing.push(log.createdAt.toISOString())
      } else {
        map.set(key, [log.createdAt.toISOString()])
      }
    }
  } catch {
    // Database unavailable — history still returns without enrichment.
  }
  return map
}

/**
 * Walks the upstream payload and attaches a createdAt ISO timestamp to every
 * history-entry-like object (identified by its article_url / input.article_url)
 * that does not already carry a timestamp. Upstream-provided createdAt values
 * are always preserved untouched.
 */
function attachCreatedAt(node: unknown, byUrl: Map<string, string[]>, depth: number): void {
  if (depth > 8 || node === null || node === undefined) return
  if (Array.isArray(node)) {
    for (const item of node) attachCreatedAt(item, byUrl, depth + 1)
    return
  }
  if (!isRecord(node)) return
  const url = entryArticleUrl(node)
  if (url && !hasOwnTimestamp(node)) {
    const stamps = byUrl.get(url.toLowerCase())
    if (stamps && stamps.length > 0) {
      // Consume newest-first; when only one timestamp remains, reuse it for
      // any further entries with the same URL rather than dropping them.
      const stamp = stamps.length > 1 ? stamps.shift() : stamps[0]
      if (typeof stamp === 'string') {
        node['createdAt'] = stamp
      }
    }
  }
  for (const value of Object.values(node)) attachCreatedAt(value, byUrl, depth + 1)
}

/**
 * Fetches the visitor's previous Article Enhancer runs from the build-history
 * workflow, keyed by the Arena email cookie set by middleware. Each run in the
 * response is enriched with a createdAt timestamp (persisted at execution time
 * in EnhancementLog) when the upstream entry lacks one, then returned so the
 * client can normalize it tolerantly.
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

  const byUrl = await loadCreatedAtByUrl(email)
  if (byUrl.size > 0) {
    attachCreatedAt(data, byUrl, 0)
  }

  return Response.json(data)
}
