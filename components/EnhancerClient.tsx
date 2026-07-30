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
  }

  function markStageActive(stage: StageId): void {
    setStages((prev) => {
      const index = STAGE_ORDER.indexOf(stage)
      let changed = false
      const next = { ...prev }
      for (let i = 0; i < STAGE_ORDER.length; i++) {
        const id = STAGE_ORDER[i]
        if (i < index && next[id] !== 'done') {
          next[id] = 'done'
          changed = true
        }
        if (i === index && next[id] === 'pending') {
          next[id] = 'active'
          changed = true
        }
      }
      return changed ? next : prev
    })
  }

  function markPanelStreaming(panel: PanelKey): void {
    if (doneRef.current) return
    setSections((prev) => (prev[panel] === 'streaming' ? prev : { ...prev, [panel]: 'streaming' }))
    markStageActive(STAGE_FOR_PANEL[panel])
  }

  /** Re-normalizes a panel's accumulated text and pushes any usable data into state. */
  function applyPanel(panel: PanelKey): void {
    markPanelStreaming(panel)
    const text = targetAccumRef.current[panel]
    if (!text.trim()) return
    if (panel === 'article') {
      const article = articleFromAccumulated(text)
      if (article.trim()) {
        dataPresentRef.current.article = true
        setContent(article)
      }
      return
    }
    if (panel === 'gapanalysis') {
      const data = normalizeGapAnalysis(text)
      if (!isGapEmpty(data)) {
        gapRef.current = data
        dataPresentRef.current.gapanalysis = true
        setGapData(data)
      }
      return
    }
    if (panel === 'recommendations') {
      const data = normalizeRecommendations(text)
      if (data.recommendations.length > 0) {
        recRef.current = data
        dataPresentRef.current.recommendations = true
        setRecData(data)
      }
      return
    }
    const data = normalizeCoverage(text)
    if (!isCovEmpty(data)) {
      covRef.current = data
      dataPresentRef.current.coverage = true
      setCoverage(data)
    }
  }

  /** Routes a streamed chunk to its panel (by blockId prefix, name, or content heuristics). */
  function routeChunk(blockId: string, chunk: string): void {
    if (!chunk) return
    const known = blockTargetRef.current[blockId]
    if (known) {
      if (known === 'status-theme' || known === 'status-research') {
        setStatusMessage(statusLabelFor(known))
        return
      }
      targetAccumRef.current[known] += chunk
      applyPanel(known)
      return
    }
    const accumulated = (blockAccumRef.current[blockId] ?? '') + chunk
    blockAccumRef.current[blockId] = accumulated
    let target: BlockTarget | null = resolveBlockTarget(blockId)
    if (!target) target = classifyUnknownPayload(accumulated)
    if (!target) return
    blockTargetRef.current[blockId] = target
    if (target === 'status-theme' || target === 'status-research') {
      setStatusMessage(statusLabelFor(target))
      return
    }
    targetAccumRef.current[target] += accumulated
    blockAccumRef.current[blockId] = ''
    applyPanel(target)
  }

  /** Applies whatever structured outputs have been merged so far to every panel. */
  function applyMergedOutputs(): void {
    const merged = finalOutputRef.current
    if (!merged) return

    if (!dataPresentRef.current.article || content.trim().length === 0) {
      const articleValue = findMergedValue(merged, [
        'enhancedarticlewriter.content',
        'enhanced_article',
        'enhancedarticle',
        'article',
        'content',
      ])
      const article = articleTextFrom(parseIfJsonLike(articleValue))
      if (article.trim()) {
        dataPresentRef.current.article = true
        setContent(article)
        markPanelStreaming('article')
      }
    }

    const strengths = findMergedValue(merged, ['gapanalysis.competitor_strengths', 'competitor_strengths'])
    const gaps = findMergedValue(merged, ['gapanalysis.coverage_gaps', 'coverage_gaps'])
    const underdeveloped = findMergedValue(merged, [
      'gapanalysis.underdeveloped_sections',
      'underdeveloped_sections',
    ])
    if (strengths !== undefined || gaps !== undefined || underdeveloped !== undefined) {
      const gap = normalizeGapAnalysis({
        competitor_strengths: strengths,
        coverage_gaps: gaps,
        underdeveloped_sections: underdeveloped,
      })
      if (!isGapEmpty(gap)) {
        gapRef.current = gap
        dataPresentRef.current.gapanalysis = true
        setGapData(gap)
        markPanelStreaming('gapanalysis')
      }
    }

    // Recommendations combine THREE upstream outputs so the tab always shows
    // its three sections: citation_opportunities, faq_suggestions, and the
    // primary recommendations list.
    const recList = findMergedValue(merged, ['recommendations.recommendations', 'recommendations'])
    const citations = findMergedValue(merged, [
      'recommendations.citation_opportunities',
      'citation_opportunities',
    ])
    const faqs = findMergedValue(merged, ['recommendations.faq_suggestions', 'faq_suggestions'])
    if (recList !== undefined || citations !== undefined || faqs !== undefined) {
      const rec = normalizeRecommendations({
        recommendations: recList,
        citation_opportunities: citations,
        faq_suggestions: faqs,
      })
      if (rec.recommendations.length > 0) {
        recRef.current = rec
        dataPresentRef.current.recommendations = true
        setRecData(rec)
        markPanelStreaming('recommendations')
      }
    }

    const overallScore = findMergedValue(merged, ['coverageverifier.overall_score', 'overall_score'])
    const passed = findMergedValue(merged, ['coverageverifier.passed', 'passed'])
    const summary = findMergedValue(merged, ['coverageverifier.summary', 'summary'])
    const criteria = findMergedValue(merged, ['coverageverifier.criteria', 'criteria'])
    if (overallScore !== undefined || passed !== undefined || summary !== undefined || criteria !== undefined) {
      const cov = normalizeCoverage({
        overall_score: overallScore,
        passed,
        summary,
        criteria,
      })
      if (!isCovEmpty(cov)) {
        covRef.current = cov
        dataPresentRef.current.coverage = true
        setCoverage(cov)
        markPanelStreaming('coverage')
      }
    }
  }

  /** Final salvage pass: mines the raw transcript for any panel that stayed empty. */
  function salvageFromTranscript(): void {
    const raw = rawTranscriptRef.current + '\n' + looseTextRef.current
    if (!raw.trim()) return
    if (!dataPresentRef.current.article) {
      const value = extractKeyValue(raw, 'content') ?? extractKeyValue(raw, 'enhanced_article')
      const article = articleTextFrom(value)
      if (article.trim()) {
        dataPresentRef.current.article = true
        setContent(article)
      }
    }
    if (!dataPresentRef.current.gapanalysis) {
      const gap = normalizeGapAnalysis({
        competitor_strengths: extractKeyValue(raw, 'competitor_strengths'),
        coverage_gaps: extractKeyValue(raw, 'coverage_gaps'),
        underdeveloped_sections: extractKeyValue(raw, 'underdeveloped_sections'),
      })
      if (!isGapEmpty(gap)) {
        dataPresentRef.current.gapanalysis = true
        setGapData(gap)
      }
    }
    if (!dataPresentRef.current.recommendations) {
      const rec = normalizeRecommendations({
        recommendations: extractKeyValue(raw, 'recommendations'),
        citation_opportunities: extractKeyValue(raw, 'citation_opportunities'),
        faq_suggestions: extractKeyValue(raw, 'faq_suggestions'),
      })
      if (rec.recommendations.length > 0) {
        dataPresentRef.current.recommendations = true
        setRecData(rec)
      }
    }
    if (!dataPresentRef.current.coverage) {
      const cov = normalizeCoverage({
        overall_score: extractKeyValue(raw, 'overall_score'),
        passed: extractKeyValue(raw, 'passed'),
        summary: extractKeyValue(raw, 'summary'),
        criteria: extractKeyValue(raw, 'criteria'),
      })
      if (!isCovEmpty(cov)) {
        dataPresentRef.current.coverage = true
        setCoverage(cov)
      }
    }
  }

  function finalizeRun(): void {
    if (doneRef.current) return
    doneRef.current = true
    salvageFromTranscript()
    setStages({
      gapanalysis: 'done',
      recommendations: 'done',
      enhancedarticlewriter: 'done',
      coverageverifier: 'done',
    })
    setSections(() => {
      const next = { ...INITIAL_SECTIONS }
      for (const panel of ALL_PANELS) {
        next[panel] = dataPresentRef.current[panel] ? 'done' : 'empty'
      }
      return next
    })
    setStatusMessage('')
    setPhase('done')
  }

  /** Handles one line of the SSE / NDJSON stream. */
  function handleStreamLine(line: string): void {
    if (doneRef.current) return
    const trimmed = line.trim()
    if (!trimmed) return
    if (/^(event|id|retry):/.test(trimmed)) return
    const dataText = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed
    if (!dataText) return
    if (dataText === '[DONE]') {
      finalizeRun()
      return
    }
    rawTranscriptRef.current += `\n${dataText}`

    const parsed = extractBalancedJson(dataText)
    const rec = asRecord(parsed)
    if (!rec) {
      // Plain text payload — heartbeat messages update the status chip;
      // everything else routes through the loose-text classifier.
      if (isHeartbeatMessage(dataText)) {
        setStatusMessage(dataText)
        return
      }
      looseTextRef.current += dataText
      routeChunk('loose-text-block', dataText)
      return
    }

    const blockId = firstStringOf(rec, ['blockId', 'block_id', 'blockid', 'blockName', 'blockname', 'block'])
    const chunk = chunkTextOf(rec)
    const message = firstStringOf(rec, ['message', 'status'])

    if (message && !chunk) {
      setStatusMessage(message)
    }

    if (chunk) {
      if (!blockId && isHeartbeatMessage(chunk)) {
        setStatusMessage(chunk.trim())
      } else {
        routeChunk(blockId || 'unknown-block', chunk)
      }
    }

    // Merge any structured outputs carried on this event and apply them
    // immediately — panels render as soon as usable data appears.
    const merged = finalOutputRef.current ?? {}
    collectStructured(rec, merged, 0)
    finalOutputRef.current = merged
    applyMergedOutputs()

    const doneFlag = rec['done']
    const eventName = firstStringOf(rec, ['event', 'type'])
    if (doneFlag === true || eventName === 'done' || eventName === 'complete') {
      finalizeRun()
    }
  }

  function validate(): EnhanceFormErrors {
    const next: EnhanceFormErrors = {}
    const url = articleUrl.trim()
    if (!url) {
      next.articleUrl = 'Please enter the article URL.'
    } else {
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          next.articleUrl = 'The URL must start with http:// or https://.'
        }
      } catch {
        next.articleUrl = 'Please enter a valid URL (including https://).'
      }
    }
    if (!contentType) {
      next.contentType = 'Please choose a content type.'
    }
    if (contentType === 'Other' && !otherType.trim()) {
      next.otherType = 'Please describe the content type.'
    }
    return next
  }

  async function startRun(payload: EnhancePayload): Promise<void> {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    resetRun()
    lastPayloadRef.current = payload
    setSubmittedUrl(payload.article_url)
    setPhase('streaming')
    setStatusMessage('Contacting the enhancement agent…')
    startRef.current = Date.now()
    markStageActive('gapanalysis')

    try {
      const res = await fetch('/api/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error || `The enhancement service returned an error (${res.status}).`)
      }

      const resContentType = res.headers.get('content-type') ?? ''
      if (resContentType.includes('application/json')) {
        // Non-streamed fallback: apply the whole JSON body at once.
        const data: unknown = await res.json()
        try {
          rawTranscriptRef.current += `\n${JSON.stringify(data)}`
        } catch {
          // Ignore serialization issues — salvage still runs on what we have.
        }
        const rec = asRecord(data)
        if (rec) {
          const merged = finalOutputRef.current ?? {}
          collectStructured(rec, merged, 0)
          finalOutputRef.current = merged
          applyMergedOutputs()
        }
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
        for (const singleLine of lines) {
          handleStreamLine(singleLine)
        }
      }
      buffer += decoder.decode()
      if (buffer.trim()) {
        handleStreamLine(buffer)
      }
      finalizeRun()
    } catch (err) {
      if (controller.signal.aborted) return
      setPhase('error')
      setStatusMessage('')
      setErrorMessage(
        err instanceof Error ? err.message : 'Something went wrong while enhancing the article. Please try again.',
      )
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    // preventDefault keeps the browser from performing a native form
    // navigation — the run streams inline on THIS page, never full-screen.
    event.preventDefault()
    const validation = validate()
    setErrors(validation)
    if (Object.keys(validation).length > 0) return
    await startRun({
      article_url: articleUrl.trim(),
      article_text: articleText.trim(),
      content_type: contentType === 'Other' ? otherType.trim() : contentType,
    })
  }

  function handleRetry(): void {
    const payload = lastPayloadRef.current
    if (payload) {
      void startRun(payload)
    } else {
      setPhase('idle')
      setErrorMessage('')
    }
  }

  async function handleExport(): Promise<void> {
    try {
      await document.fonts.ready
    } catch {
      // Fonts API unavailable — print with whatever is loaded.
    }
    window.print()
  }

  const started = phase !== 'idle'
  const showResults = started && phase !== 'error'
  const checklistStages: ChecklistStage[] = STAGE_ORDER.map((id) => ({
    id,
    label: STAGE_LABELS[id],
    status: stages[id],
  }))
  const streaming = phase === 'streaming'

  return (
    <div className="mx-auto max-w-4xl">
      <div className="screen-only space-y-6">
        <form
          onSubmit={(event) => {
            void handleSubmit(event)
          }}
          noValidate
          className="card-enter rounded-2xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="article-url" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-soft">
                Article URL
              </label>
              <input
                id="article-url"
                type="url"
                inputMode="url"
                autoComplete="off"
                value={articleUrl}
                onChange={(event) => setArticleUrl(event.target.value)}
                placeholder="https://example.com/blog/my-article"
                disabled={streaming}
                aria-invalid={Boolean(errors.articleUrl)}
                className={`${inputBase} ${errors.articleUrl ? 'border-rose-300' : 'border-slate-200'}`}
              />
              {errors.articleUrl ? (
                <p role="alert" className="mt-1 text-xs font-medium text-rose-600">
                  {errors.articleUrl}
                </p>
              ) : null}
            </div>
            <div>
              <label htmlFor="content-type" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-soft">
                Content type
              </label>
              <select
                id="content-type"
                value={contentType}
                onChange={(event) => setContentType(event.target.value)}
                disabled={streaming}
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
                <p role="alert" className="mt-1 text-xs font-medium text-rose-600">
                  {errors.contentType}
                </p>
              ) : null}
            </div>
            {contentType === 'Other' ? (
              <div>
                <label htmlFor="other-type" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-soft">
                  Describe the content type
                </label>
                <input
                  id="other-type"
                  type="text"
                  value={otherType}
                  onChange={(event) => setOtherType(event.target.value)}
                  placeholder="e.g. Case study"
                  disabled={streaming}
                  aria-invalid={Boolean(errors.otherType)}
                  className={`${inputBase} ${errors.otherType ? 'border-rose-300' : 'border-slate-200'}`}
                />
                {errors.otherType ? (
                  <p role="alert" className="mt-1 text-xs font-medium text-rose-600">
                    {errors.otherType}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="sm:col-span-2">
              <label htmlFor="article-text" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-soft">
                Article text <span className="font-normal normal-case text-slate-400">(optional)</span>
              </label>
              <textarea
                id="article-text"
                rows={6}
                value={articleText}
                onChange={(event) => setArticleText(event.target.value)}
                placeholder="Paste the article text here, or leave empty and the agent will read it from the URL."
                disabled={streaming}
                className={`${inputBase} resize-y border-slate-200`}
              />
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-400">
              Results stream live below on this page — no new window, no full-screen takeover.
            </p>
            <button
              type="submit"
              disabled={streaming}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-deep focus:outline-none focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {streaming ? (
                <>
                  <span
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none"
                  />
                  Enhancing…
                </>
              ) : (
                'Enhance article'
              )}
            </button>
          </div>
        </form>

        {streaming ? (
          <div className="flex justify-center">
            <StatusChip message={statusMessage || 'Working on it…'} elapsedSeconds={elapsed} />
          </div>
        ) : null}

        {showResults ? <ProgressChecklist stages={checklistStages} /> : null}

        {phase === 'error' ? <ErrorCard message={errorMessage} onRetry={handleRetry} /> : null}

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
