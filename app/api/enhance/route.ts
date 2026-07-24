import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const UPSTREAM_URL =
  'https://test-agent.thearena.ai/api/workflows/9aafe5d7-1d24-477a-ad3f-0be9bf79c04f/execute'
const SIM_API_KEY = 'sk-sim-jYKjvV7VAToCX_MNfI00-2sGNmcyDZAS'

const SELECTED_OUTPUTS = [
  'recommendations.recommendations',
  'enhancedarticlewriter.content',
  'coverageverifier.criteria',
  'coverageverifier.overall_score',
  'coverageverifier.passed',
  'coverageverifier.summary',
  'gapanalysis.competitor_strengths',
  'gapanalysis.coverage_gaps',
  'gapanalysis.underdeveloped_sections',
]

interface IncomingBody {
  article_url?: unknown
  article_text?: unknown
  content_type?: unknown
}

export async function POST(request: Request): Promise<Response> {
  let body: IncomingBody
  try {
    body = (await request.json()) as IncomingBody
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const articleUrl = typeof body.article_url === 'string' ? body.article_url.trim() : ''
  const articleText = typeof body.article_text === 'string' ? body.article_text.trim() : ''
  const contentType = typeof body.content_type === 'string' ? body.content_type.trim() : ''

  if (!articleUrl || !articleText || !contentType) {
    return Response.json(
      { error: 'article_url, article_text, and content_type are all required.' },
      { status: 400 },
    )
  }

  try {
    await prisma.enhancementLog.create({ data: { articleUrl, contentType } })
  } catch {
    // Logging is non-critical — never block the enhancement request.
  }

  let upstream: Response
  try {
    upstream = await fetch(UPSTREAM_URL, {
      method: 'POST',
      headers: {
        'X-API-Key': SIM_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        article_url: articleUrl,
        article_text: articleText,
        content_type: contentType,
        stream: true,
        selectedOutputs: SELECTED_OUTPUTS,
      }),
    })
  } catch {
    return Response.json(
      { error: 'Could not reach the enhancement service. Please try again.' },
      { status: 502 },
    )
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '')
    const status = upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502
    return Response.json(
      {
        error: `The enhancement service returned an error (${upstream.status}).`,
        detail: detail.slice(0, 500),
      },
      { status },
    )
  }

  const upstreamContentType = upstream.headers.get('content-type') ?? ''

  // Non-streamed JSON fallback — forward the JSON body as-is.
  if (upstreamContentType.includes('application/json')) {
    const text = await upstream.text()
    return new Response(text, {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  }

  if (!upstream.body) {
    const text = await upstream.text()
    return new Response(text, {
      headers: { 'Content-Type': upstreamContentType || 'text/plain; charset=utf-8' },
    })
  }

  // Pipe the upstream ReadableStream straight through — never buffer the whole body.
  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
