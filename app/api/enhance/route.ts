import { prisma } from '@/lib/prisma'
import { getArenaEmailId } from '@/lib/arena-email'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const UPSTREAM_URL =
  'https://agent.thearena.ai/api/workflows/03418966-7c53-40da-86ea-597e9926e302/execute'
const SIM_API_KEY = 'sk-sim-Vk9yj3QfVSZxJ8lulZTYK549u5ThZo9u'

const SELECTED_OUTPUTS = [
  'enhancedarticlewriter.content',
  'coverageverifier.citations_count',
  'coverageverifier.citations_found',
  'coverageverifier.criteria',
  'coverageverifier.faq_added',
  'coverageverifier.faq_questions_added',
  'coverageverifier.overall_score',
  'coverageverifier.passed',
  'coverageverifier.summary',
  'recommendations.citation_opportunities',
  'recommendations.faq_suggestions',
  'recommendations.recommendations',
  'gapanalysis.competitor_strengths',
  'gapanalysis.coverage_gaps',
  'gapanalysis.underdeveloped_sections',
]

interface IncomingBody {
  article_url?: unknown
  article_text?: unknown
  content_type?: unknown
  email?: unknown
}

export async function POST(request: Request): Promise<Response> {
  let body: IncomingBody
  try {
    body = (await request.json()) as IncomingBody
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const articleUrl = typeof body.article_url === 'string' ? body.article_url.trim() : ''
  // Article text is OPTIONAL — when omitted the agent reads the article from the URL.
  const articleText = typeof body.article_text === 'string' ? body.article_text.trim() : ''
  const contentType = typeof body.content_type === 'string' ? body.content_type.trim() : ''

  if (!articleUrl || !contentType) {
    return Response.json(
      { error: 'article_url and content_type are required.' },
      { status: 400 },
    )
  }

  // Resolve the Arena email for this visitor: an explicit value in the body
  // wins, otherwise fall back to the arena_email_id cookie set by middleware.
  const emailFromBody = typeof body.email === 'string' ? body.email.trim() : ''
  const emailFromCookie = (await getArenaEmailId()) ?? ''
  const email = emailFromBody || emailFromCookie

  try {
    // The EnhancementLog row's createdAt (@default(now())) persists the run
    // timestamp at execution time — /api/history reads it back to enrich each
    // history entry with a createdAt value.
    await prisma.enhancementLog.create({
      data: { articleUrl, contentType, email: email || null },
    })
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
        email,
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
