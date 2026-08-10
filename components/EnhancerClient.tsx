"use client"

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type {
  CoverageData,
  EnhanceFormErrors,
  EnhancePayload,
  GapAnalysisData,
  PanelKey,
  RecommendationsData,
  RequestPhase,
  SectionStatus,
  StageId,
  StageStatus,
} from '@/lib/types'
import type { BlockTarget } from '@/lib/stream'
import {
  STAGE_ORDER,
  classifyUnknownPayload,
  isHeartbeatMessage,
  resolveBlockTarget,
  statusLabelFor,
} from '@/lib/stream'
import {
  decodeUnicodeEscapes,
  extractBalancedJson,
  normalizeCoverage,
  normalizeGapAnalysis,
  normalizeRecommendations,
} from '@/lib/normalize'
import { StatusChip } from '@/components/StatusChip'
import { ErrorCard } from '@/components/ErrorCard'
import { ProgressChecklist } from '@/components/ProgressChecklist'
import type { ChecklistStage } from '@/components/ProgressChecklist'
import { ResultTabs } from '@/components/ResultTabs'
import { PrintableReport } from '@/components/PrintableReport'

const CONTENT_TYPES = ['Blog Post', 'Landing Page', 'Guide', 'News', 'Product Page', 'Other'] as const

const STAGE_LABELS: Record<StageId, string> = {
  gapanalysis: 'Analyzing gaps',
  recommendations: 'Generating recommendations',
  enhancedarticlewriter: 'Writing enhanced draft',
  coverageverifier: 'Verifying coverage',
}

const INITIAL_STAGES: Record<StageId, StageStatus> = {
  gapanalysis: 'pending',
  recommendations: 'pending',
  enhancedarticlewriter: 'pending',
  coverageverifier: 'pending',
}

const INITIAL_SECTIONS: Record<PanelKey, SectionStatus> = {
  article: 'pending',
  gapanalysis: 'pending',
  recommendations: 'pending',
  coverage: 'pending',
}

const STAGE_FOR_PANEL: Record<PanelKey, StageId> = {
  article: 'enhancedarticlewriter',
  gapanalysis: 'gapanalysis',
  recommendations: 'recommendations',
  coverage: 'coverageverifier',
}

const ALL_PANELS: PanelKey[] = ['article', 'gapanalysis', 'recommendations', 'coverage']

// Metadata keys on stream events that must never be merged as panel outputs.
const RESERVED_KEYS = new Set([
  'blockid',
  'block_id',
  'blockname',
  'chunk',
  'delta',
  'text',
  'event',
  'type',
  'message',
  'status',
  'success',
  'error',
  'timestamp',
  'id',
  'done',
])

const inputBase =
  'w-full rounded-xl border bg-white px-4 py-2.5 text-sm text-ink shadow-sm transition placeholder:text-slate-400 focus:outline-none focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function firstStringOf(rec: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = rec[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

/** Returns the raw (untrimmed) streaming chunk text from a stream event. */
function chunkTextOf(rec: Record<string, unknown>): string {
  for (const key of ['chunk', 'delta', 'text']) {
    const value = rec[key]
    if (typeof value === 'string') return value
  }
  return ''
}

/** Parses a string value that itself contains JSON; returns non-strings unchanged. */
function parseIfJsonLike(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value
  const parsed = extractBalancedJson(trimmed)
  return parsed === null ? value : parsed
}

/**
 * Last-resort salvage: pulls the value for a JSON key straight out of raw
 * stream text. Handles structured values ({...} / [...]) and scalar values
 * (strings, numbers, booleans). Returns undefined when the key is absent.
 */
function extractKeyValue(text: string, key: string): unknown {
  const token = `"${key}"`
  let from = 0
  while (from < text.length) {
    const idx = text.indexOf(token, from)
    if (idx === -1) return undefined
    const colon = text.indexOf(':', idx + token.length)
    if (colon === -1) return undefined
    const rest = text.slice(colon + 1, colon + 1 + 60000).replace(/^\s+/, '')
    if (rest.startsWith('{') || rest.startsWith('[')) {
      const structured = extractBalancedJson(rest)
      if (structured !== null) return structured
    } else {
      const scalar = rest.match(/^(?:"((?:[^"\\]|\\.)*)"|(-?\d+(?:\.\d+)?)|(true|false))/)
      if (scalar) {
        if (scalar[1] !== undefined) return decodeUnicodeEscapes(scalar[1].replace(/\\"/g, '"'))
        if (scalar[2] !== undefined) return Number(scalar[2])
        return scalar[3] === 'true'
      }
    }
    from = idx + token.length
  }
  return undefined
}

/** Extracts a plain article string from an arbitrary payload value. */
function articleTextFrom(value: unknown): string {
  if (typeof value === 'string') return value
  const rec = asRecord(value)
  if (rec) {
    for (const key of ['content', 'article', 'enhanced_article', 'markdown', 'text', 'body']) {
      const inner = rec[key]
      if (typeof inner === 'string' && inner.trim()) return inner
    }
  }
  return ''
}

/**
 * Derives displayable article text from accumulated stream text. Handles both
 * plain markdown chunks and JSON-wrapped payloads like {"content":"..."}
 * (including progressive, not-yet-closed JSON while streaming).
 */
function articleFromAccumulated(accumulated: string): string {
  const trimmed = accumulated.trim()
  if (trimmed.startsWith('{')) {
    const value = extractKeyValue(trimmed, 'content')
    if (typeof value === 'string' && value.trim()) return value
    const match = trimmed.match(/^\{\s*"content"\s*:\s*"([\s\S]*)$/)
    if (match) {
      const partial = match[1].replace(/"\s*\}?\s*$/, '')
      return decodeUnicodeEscapes(partial.replace(/\\n/g, '\n').replace(/\\"/g, '"'))
    }
  }
  return accumulated
}

function isGapEmpty(data: GapAnalysisData): boolean {
  return (
    data.competitor_strengths.length === 0 &&
    data.coverage_gaps.length === 0 &&
    data.underdeveloped_sections.length === 0
  )
}

function isCovEmpty(data: CoverageData): boolean {
  return (
    data.overall_score === null &&
    data.passed === null &&
    data.summary === null &&
    data.criteria.length === 0
  )
}

function gapTotal(data: GapAnalysisData): number {
  return (
    data.competitor_strengths.length + data.coverage_gaps.length + data.underdeveloped_sections.length
  )
}

/** Narrows a BlockTarget to a renderable panel (excludes status-* targets). */
function isPanelKey(target: BlockTarget): target is PanelKey {
  return target !== 'status-theme' && target !== 'status-research'
}

/** Tolerant lookup across merged structured outputs (exact, dotted, nested). */
function findMergedValue(merged: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const lower = key.toLowerCase()
    if (lower in merged) return merged[lower]
  }
  for (const [entryKey, entryValue] of Object.entries(merged)) {
    for (const key of keys) {
      const lower = key.toLowerCase()
      const short = lower.split('.').pop() ?? lower
      if (entryKey.endsWith(`.${short}`)) return entryValue
    }
    const rec = asRecord(entryValue)
    if (rec) {
      for (const key of keys) {
        const short = key.toLowerCase().split('.').pop() ?? ''
        if (short && short in rec) return rec[short]
      }
    }
  }
  return undefined
}

/** Recursively merges non-reserved keys (and output/result/data envelopes) into `merged`. */
function collectStructured(
  obj: Record<string, unknown>,
  merged: Record<string, unknown>,
  depth: number,
): void {
  if (depth > 4) return
  for (const [key, rawValue] of Object.entries(obj)) {
    const lower = key.toLowerCase()
    if (RESERVED_KEYS.has(lower)) continue
    const value = parseIfJsonLike(rawValue)
    if (lower === 'output' || lower === 'outputs' || lower === 'result' || lower === 'data') {
      const rec = asRecord(value)
      if (rec) {
        collectStructured(rec, merged, depth + 1)
        continue
      }
    }
    merged[lower] = value
  }
}

export function EnhancerClient() {
  const [articleUrl, setArticleUrl] = useState('')
  const [articleText, setArticleText] = useState('')
  const [contentType, setContentType] = useState('')
  const [otherType, setOtherType] = useState('')
  const [errors, setErrors] = useState<EnhanceFormErrors>({})
  const [phase, setPhase] = useState<RequestPhase>('idle')
  const [content, setContent] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [stages, setStages] = useState<Record<StageId, StageStatus>>({ ...INITIAL_STAGES })
  const [sections, setSections] = useState<Record<PanelKey, SectionStatus>>({ ...INITIAL_SECTIONS })
  const [gapData, setGapData] = useState<GapAnalysisData | null>(null)
  const [recData, setRecData] = useState<RecommendationsData | null>(null)
  const [coverage, setCoverage] = useState<CoverageData | null>(null)
  const [submittedUrl, setSubmittedUrl] = useState('')

  const abortRef = useRef<AbortController | null>(null)
  const startRef = useRef(0)
  const targetAccumRef = useRef<Record<PanelKey, string>>({
    article: '',
    gapanalysis: '',
    recommendations: '',
    coverage: '',
  })
  const blockAccumRef = useRef<Record<string, string>>({})
  const blockTargetRef = useRef<Record<string, BlockTarget>>({})
  const gapRef = useRef<GapAnalysisData | null>(null)
  const recRef = useRef<RecommendationsData | null>(null)
  const covRef = useRef<CoverageData | null>(null)
  const dataPresentRef = useRef<Record<PanelKey, boolean>>({
    article: false,
    gapanalysis: false,
    recommendations: false,
    coverage: false,
  })
  const doneRef = useRef(false)
  // Full raw transcript of every stream payload - the salvage pass mines this
  // when a panel never received routable data.
  const rawTranscriptRef = useRef('')
  // Merged structured outputs from ANY event carrying dotted keys, panel-name
  // keys, or output/result/data envelopes. Applied after every event so the
  // UI renders as soon as usable data appears - not only at [DONE].
  const finalOutputRef = useRef<Record<string, unknown> | null>(null)
  const looseTextRef = useRef('')
  const lastPayloadRef = useRef<EnhancePayload | null>(null)
  // UI FIX (post-stream blanking): the Enhanced Article content must NEVER
  // regress or blank out once it has been shown. Every article update flows
  // through updateArticle(), which keeps the longest non-empty text seen so
  // far - a shorter or empty late payload (e.g. the finalize/[DONE] pass) can
  // never wipe the already-rendered article from the tab.
  const articleTextRef = useRef('')

  useEffect(() => {
    if (phase !== 'streaming') return
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [phase])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  function resetRun(): void {
    setContent('')
    setStatusMessage('')
    setElapsed(0)
    setErrorMessage('')
    setStages({ ...INITIAL_STAGES })
    setSections({ ...INITIAL_SECTIONS })
    setGapData(null)
    setRecData(null)
    setCoverage(null)
    targetAccumRef.current = { article: '', gapanalysis: '', recommendations: '', coverage: '' }
    blockAccumRef.current = {}
    blockTargetRef.current = {}
    gapRef.current = null
    recRef.current = null
    covRef.current = null
    dataPresentRef.current = { article: false, gapanalysis: false, recommendations: false, coverage: false }
    doneRef.current = false
    rawTranscriptRef.current = ''
    finalOutputRef.current = null
    looseTextRef.current = ''
    articleTextRef.current = ''
  }

  function markStageActive(stage: StageId): void {
    setStages((prev) => {
      if (prev[stage] !== 'pending') return prev
      const next: Record<StageId, StageStatus> = { ...prev, [stage]: 'active' }
      return next
    })
  }

  function markStageDone(stage: StageId): void {
    setStages((prev) => {
      if (prev[stage] === 'done') return prev
      const next: Record<StageId, StageStatus> = { ...prev, [stage]: 'done' }
      return next
    })
  }

  function markSectionStreaming(panel: PanelKey): void {
    setSections((prev) => {
      if (prev[panel] === 'streaming' || prev[panel] === 'done') return prev
      const next: Record<PanelKey, SectionStatus> = { ...prev, [panel]: 'streaming' }
      return next
    })
    markStageActive(STAGE_FOR_PANEL[panel])
  }

  /** Monotonic article updates: keep the longest non-empty text seen so far. */
  function updateArticle(text: string): void {
    const next = typeof text === 'string' ? text : ''
    if (!next.trim()) return
    if (next.length >= articleTextRef.current.length) {
      articleTextRef.current = next
      setContent(next)
    }
    dataPresentRef.current.article = true
    markSectionStreaming('article')
  }

  function applyGap(raw: unknown): void {
    const data = normalizeGapAnalysis(raw)
    if (isGapEmpty(data)) return
    const prev = gapRef.current
    if (prev && gapTotal(prev) > gapTotal(data)) return
    gapRef.current = data
    setGapData(data)
    dataPresentRef.current.gapanalysis = true
    markSectionStreaming('gapanalysis')
  }

  function applyRec(raw: unknown): void {
    const data = normalizeRecommendations(raw)
    if (data.recommendations.length === 0) return
    const prev = recRef.current
    if (prev && prev.recommendations.length > data.recommendations.length) return
    recRef.current = data
    setRecData(data)
    dataPresentRef.current.recommendations = true
    markSectionStreaming('recommendations')
  }

  function applyCoverage(raw: unknown): void {
    const data = normalizeCoverage(raw)
    if (isCovEmpty(data)) return
    covRef.current = data
    setCoverage(data)
    dataPresentRef.current.coverage = true
    markSectionStreaming('coverage')
  }

  /** Re-derives every panel from the merged structured outputs collected so far. */
  function applyMergedOutputs(): void {
    const merged = finalOutputRef.current
    if (!merged) return

    const articleValue = findMergedValue(merged, [
      'enhancedarticlewriter.content',
      'enhanced_article',
      'content',
      'article',
    ])
    const articleFromMerged = articleTextFrom(parseIfJsonLike(articleValue))
    if (articleFromMerged.trim()) updateArticle(articleFromMerged)

    const strengths = findMergedValue(merged, ['gapanalysis.competitor_strengths', 'competitor_strengths'])
    const gaps = findMergedValue(merged, ['gapanalysis.coverage_gaps', 'coverage_gaps'])
    const under = findMergedValue(merged, [
      'gapanalysis.underdeveloped_sections',
      'underdeveloped_sections',
    ])
    if (strengths !== undefined || gaps !== undefined || under !== undefined) {
      applyGap({
        competitor_strengths: strengths,
        coverage_gaps: gaps,
        underdeveloped_sections: under,
      })
    }

    const recs = findMergedValue(merged, ['recommendations.recommendations', 'recommendations'])
    const citations = findMergedValue(merged, [
      'recommendations.citation_opportunities',
      'citation_opportunities',
    ])
    const faqs = findMergedValue(merged, ['recommendations.faq_suggestions', 'faq_suggestions'])
    if (recs !== undefined || citations !== undefined || faqs !== undefined) {
      applyRec({
        recommendations: recs,
        citation_opportunities: citations,
        faq_suggestions: faqs,
      })
    }

    const score = findMergedValue(merged, ['coverageverifier.overall_score', 'overall_score'])
    const passed = findMergedValue(merged, ['coverageverifier.passed', 'passed'])
    const summary = findMergedValue(merged, ['coverageverifier.summary', 'summary'])
    const criteria = findMergedValue(merged, ['coverageverifier.criteria', 'criteria'])
    if (score !== undefined || passed !== undefined || summary !== undefined || criteria !== undefined) {
      applyCoverage({ overall_score: score, passed, summary, criteria })
    }
  }

  /** Routes a streamed text chunk into the accumulated buffer for a panel. */
  function routeChunkToPanel(panel: PanelKey, chunk: string): void {
    targetAccumRef.current[panel] += chunk
    if (panel === 'article') {
      updateArticle(articleFromAccumulated(targetAccumRef.current.article))
      return
    }
    markSectionStreaming(panel)
    const accumulated = targetAccumRef.current[panel]
    if (panel === 'gapanalysis') {
      applyGap(accumulated)
    } else if (panel === 'recommendations') {
      applyRec(accumulated)
    } else {
      applyCoverage(accumulated)
    }
  }

  function handleStreamEvent(payload: unknown): void {
    if (typeof payload === 'string') {
      rawTranscriptRef.current += payload
      if (isHeartbeatMessage(payload)) {
        setStatusMessage(payload.trim())
        return
      }
      looseTextRef.current += payload
      const classified = classifyUnknownPayload(looseTextRef.current)
      if (classified) {
        routeChunkToPanel(classified, looseTextRef.current)
        looseTextRef.current = ''
      }
      return
    }

    const rec = asRecord(payload)
    if (!rec) return
    try {
      rawTranscriptRef.current += JSON.stringify(payload)
    } catch {
      // Circular or unserializable payloads are skipped from the transcript.
    }

    // Merge any structured outputs this event carries and re-derive panels.
    const merged = finalOutputRef.current ?? {}
    collectStructured(rec, merged, 0)
    finalOutputRef.current = merged
    applyMergedOutputs()

    const blockId = firstStringOf(rec, ['blockId', 'block_id', 'blockid', 'blockName', 'blockname'])
    const chunk = chunkTextOf(rec)

    if (blockId) {
      let target: BlockTarget | null = blockTargetRef.current[blockId] ?? resolveBlockTarget(blockId)
      if (target) blockTargetRef.current[blockId] = target
      if (chunk) {
        blockAccumRef.current[blockId] = (blockAccumRef.current[blockId] ?? '') + chunk
        if (target && isPanelKey(target)) {
          routeChunkToPanel(target, chunk)
        } else if (target) {
          // Status-only blocks: surface a friendly progress label, never content.
          if (!isHeartbeatMessage(chunk)) setStatusMessage(statusLabelFor(target))
        } else {
          const classified = classifyUnknownPayload(blockAccumRef.current[blockId])
          if (classified) {
            blockTargetRef.current[blockId] = classified
            routeChunkToPanel(classified, blockAccumRef.current[blockId])
            target = classified
          }
        }
      }
      const eventName = firstStringOf(rec, ['event', 'type']).toLowerCase()
      if (eventName.includes('end') || eventName.includes('complete') || rec['done'] === true) {
        const finalTarget = blockTargetRef.current[blockId]
        if (finalTarget && isPanelKey(finalTarget)) {
          markStageDone(STAGE_FOR_PANEL[finalTarget])
        }
      }
    } else if (chunk) {
      if (isHeartbeatMessage(chunk)) {
        setStatusMessage(chunk.trim())
      } else {
        looseTextRef.current += chunk
        const classified = classifyUnknownPayload(looseTextRef.current)
        if (classified) {
          routeChunkToPanel(classified, looseTextRef.current)
          looseTextRef.current = ''
        }
      }
    }

    const status = firstStringOf(rec, ['status', 'message'])
    if (status && !isHeartbeatMessage(status)) {
      setStatusMessage(status)
    }
  }

  /** Final salvage + section/stage settlement once the stream ends. */
  function finalizeRun(): void {
    if (doneRef.current) return
    doneRef.current = true

    applyMergedOutputs()

    const raw = rawTranscriptRef.current
    if (!dataPresentRef.current.article) {
      const value = extractKeyValue(raw, 'content')
      const text = articleTextFrom(value)
      if (text.trim()) {
        updateArticle(text)
      } else {
        const loose = looseTextRef.current.trim()
        if (loose.length > 160 && !loose.startsWith('{') && !loose.startsWith('[')) {
          updateArticle(looseTextRef.current)
        }
      }
    }
    if (!dataPresentRef.current.gapanalysis && raw) {
      applyGap({
        competitor_strengths: extractKeyValue(raw, 'competitor_strengths'),
        coverage_gaps: extractKeyValue(raw, 'coverage_gaps'),
        underdeveloped_sections: extractKeyValue(raw, 'underdeveloped_sections'),
      })
    }
    if (!dataPresentRef.current.recommendations && raw) {
      applyRec({
        recommendations: extractKeyValue(raw, 'recommendations'),
        citation_opportunities: extractKeyValue(raw, 'citation_opportunities'),
        faq_suggestions: extractKeyValue(raw, 'faq_suggestions'),
      })
    }
    if (!dataPresentRef.current.coverage && raw) {
      applyCoverage({
        overall_score: extractKeyValue(raw, 'overall_score'),
        passed: extractKeyValue(raw, 'passed'),
        summary: extractKeyValue(raw, 'summary'),
        criteria: extractKeyValue(raw, 'criteria'),
      })
    }

    setSections((prev) => {
      const next: Record<PanelKey, SectionStatus> = { ...prev }
      for (const panel of ALL_PANELS) {
        next[panel] = dataPresentRef.current[panel] ? 'done' : 'empty'
      }
      return next
    })
    setStages(() => {
      const next: Record<StageId, StageStatus> = { ...INITIAL_STAGES }
      for (const stage of STAGE_ORDER) next[stage] = 'done'
      return next
    })
    setStatusMessage('')
    setPhase('done')
  }

  function processStreamLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    const data = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed
    if (!data) return
    if (data === '[DONE]') {
      finalizeRun()
      return
    }
    const parsed = extractBalancedJson(data)
    if (parsed !== null) {
      handleStreamEvent(parsed)
    } else {
      handleStreamEvent(data)
    }
  }

  async function runStream(payload: EnhancePayload): Promise<void> {
    abortRef.current?.abort()
    resetRun()
    lastPayloadRef.current = payload
    setPhase('streaming')
    setStatusMessage('Starting enhancement…')
    startRef.current = Date.now()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const res = await fetch('/api/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error || `Enhancement request failed (${res.status}).`)
      }
      const responseType = res.headers.get('content-type') ?? ''
      if (responseType.includes('application/json')) {
        const data: unknown = await res.json()
        handleStreamEvent(data)
        finalizeRun()
        return
      }
      if (!res.body) {
        throw new Error('The enhancement service returned an empty response.')
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          processStreamLine(line)
        }
        if (doneRef.current) break
      }
      if (!doneRef.current && buffer.trim()) {
        processStreamLine(buffer)
      }
      finalizeRun()
    } catch (err) {
      if (controller.signal.aborted) return
      setPhase('error')
      setErrorMessage(err instanceof Error ? err.message : 'The enhancement request failed.')
    }
  }

  function validate(): EnhanceFormErrors {
    const next: EnhanceFormErrors = {}
    const url = articleUrl.trim()
    const text = articleText.trim()
    if (!url && !text) {
      next.articleUrl = 'Provide an article URL or paste the article text below.'
      next.articleText = 'Provide an article URL above or paste the article text.'
    } else if (url) {
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          next.articleUrl = 'Enter a valid http(s) URL.'
        }
      } catch {
        next.articleUrl = 'Enter a valid URL (including https://).'
      }
    }
    if (!contentType) {
      next.contentType = 'Choose a content type.'
    } else if (contentType === 'Other' && !otherType.trim()) {
      next.otherType = 'Describe the content type.'
    }
    return next
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const nextErrors = validate()
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    const resolvedType = contentType === 'Other' ? otherType.trim() : contentType
    const payload: EnhancePayload = {
      article_url: articleUrl.trim(),
      article_text: articleText.trim(),
      content_type: resolvedType,
    }
    setSubmittedUrl(articleUrl.trim())
    void runStream(payload)
  }

  function handleRetry(): void {
    const payload = lastPayloadRef.current
    if (payload) {
      void runStream(payload)
    } else {
      setPhase('idle')
      setErrorMessage('')
    }
  }

  async function handleExport(): Promise<void> {
    try {
      await document.fonts.ready
    } catch {
      // Fonts API unavailable - print with whatever is loaded.
    }
    window.print()
  }

  const busy = phase === 'streaming'
  const showResults = phase === 'streaming' || phase === 'done'

  const checklistStages: ChecklistStage[] = STAGE_ORDER.map((id) => ({
    id,
    label: STAGE_LABELS[id],
    status: stages[id],
  }))

  return (
    <div>
      <div className="screen-only">
        <form
          onSubmit={handleSubmit}
          noValidate
          aria-label="Enhance an article"
          className="card-enter mb-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8"
        >
          <div className="grid gap-5">
            <div>
              <label htmlFor="article-url" className="mb-1.5 block text-sm font-medium text-ink">
                Article URL
              </label>
              <input
                id="article-url"
                type="url"
                value={articleUrl}
                onChange={(event) => setArticleUrl(event.target.value)}
                disabled={busy}
                placeholder="https://example.com/blog/my-article"
                aria-invalid={Boolean(errors.articleUrl)}
                className={`${inputBase} ${errors.articleUrl ? 'border-rose-300' : 'border-slate-200'}`}
              />
              {errors.articleUrl ? (
                <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.articleUrl}</p>
              ) : null}
            </div>
            <div>
              <label htmlFor="article-text" className="mb-1.5 block text-sm font-medium text-ink">
                Article text{' '}
                <span className="font-normal text-ink-soft">(optional when a URL is provided)</span>
              </label>
              <textarea
                id="article-text"
                rows={6}
                value={articleText}
                onChange={(event) => setArticleText(event.target.value)}
                disabled={busy}
                placeholder="Paste the full article text here…"
                aria-invalid={Boolean(errors.articleText)}
                className={`${inputBase} resize-y ${errors.articleText ? 'border-rose-300' : 'border-slate-200'}`}
              />
              {errors.articleText ? (
                <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.articleText}</p>
              ) : null}
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label htmlFor="content-type" className="mb-1.5 block text-sm font-medium text-ink">
                  Content type
                </label>
                <select
                  id="content-type"
                  value={contentType}
                  onChange={(event) => setContentType(event.target.value)}
                  disabled={busy}
                  aria-invalid={Boolean(errors.contentType)}
                  className={`${inputBase} ${errors.contentType ? 'border-rose-300' : 'border-slate-200'}`}
                >
                  <option value="">Select a content type…</option>
                  {CONTENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                {errors.contentType ? (
                  <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.contentType}</p>
                ) : null}
              </div>
              {contentType === 'Other' ? (
                <div>
                  <label htmlFor="other-type" className="mb-1.5 block text-sm font-medium text-ink">
                    Describe the content type
                  </label>
                  <input
                    id="other-type"
                    type="text"
                    value={otherType}
                    onChange={(event) => setOtherType(event.target.value)}
                    disabled={busy}
                    placeholder="e.g. Case study"
                    aria-invalid={Boolean(errors.otherType)}
                    className={`${inputBase} ${errors.otherType ? 'border-rose-300' : 'border-slate-200'}`}
                  />
                  {errors.otherType ? (
                    <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.otherType}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                {busy ? (
                  <StatusChip
                    message={statusMessage || 'Enhancing your article…'}
                    elapsedSeconds={elapsed}
                    phase={phase}
                  />
                ) : null}
              </div>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-deep focus:outline-none focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? (
                  <span
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none"
                  />
                ) : null}
                {busy ? 'Enhancing…' : 'Enhance article'}
              </button>
            </div>
          </div>
        </form>

        {phase === 'error' ? (
          <div className="mb-6">
            <ErrorCard message={errorMessage || 'Something went wrong.'} onRetry={handleRetry} />
          </div>
        ) : null}

        {showResults ? (
          <div className="mb-6">
            <ProgressChecklist stages={checklistStages} />
          </div>
        ) : null}

        {showResults ? (
          <ResultTabs
            content={content}
            articleStatus={sections.article}
            coverageData={coverage}
            coverageStatus={sections.coverage}
            gapData={gapData}
            gapStatus={sections.gapanalysis}
            recData={recData}
            recStatus={sections.recommendations}
            articleUrl={submittedUrl || undefined}
            onExport={() => {
              void handleExport()
            }}
          />
        ) : null}
      </div>

      <PrintableReport
        content={content}
        articleStatus={sections.article}
        coverageData={coverage}
        coverageStatus={sections.coverage}
        gapData={gapData}
        gapStatus={sections.gapanalysis}
        recData={recData}
        recStatus={sections.recommendations}
        articleUrl={submittedUrl || undefined}
      />
    </div>
  )
}
