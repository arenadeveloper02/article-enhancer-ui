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
    setSections((prev) => {
      if (prev[panel] === 'streaming' || prev[panel] === 'done' || prev[panel] === 'empty') return prev
      return { ...prev, [panel]: 'streaming' }
    })
  }

  function applyGap(data: GapAnalysisData): void {
    if (isGapEmpty(data)) return
    if (gapRef.current && gapTotal(data) < gapTotal(gapRef.current)) {
      dataPresentRef.current.gapanalysis = true
      return
    }
    gapRef.current = data
    dataPresentRef.current.gapanalysis = true
    setGapData(data)
  }

  function applyRec(data: RecommendationsData): void {
    if (data.recommendations.length === 0) return
    if (recRef.current && data.recommendations.length < recRef.current.recommendations.length) {
      dataPresentRef.current.recommendations = true
      return
    }
    recRef.current = data
    dataPresentRef.current.recommendations = true
    setRecData(data)
  }

  function applyCov(data: CoverageData): void {
    if (isCovEmpty(data)) return
    covRef.current = data
    dataPresentRef.current.coverage = true
    setCoverage(data)
  }

  /** Re-normalizes a panel's accumulated text and pushes it into state. */
  function applyPanelText(panel: PanelKey): void {
    const accumulated = targetAccumRef.current[panel]
    if (!accumulated.trim()) return
    if (panel === 'article') {
      const text = articleFromAccumulated(accumulated)
      if (text.trim()) {
        dataPresentRef.current.article = true
        setContent(text)
      }
      return
    }
    if (panel === 'gapanalysis') {
      applyGap(normalizeGapAnalysis(accumulated))
      return
    }
    if (panel === 'recommendations') {
      applyRec(normalizeRecommendations(accumulated))
      return
    }
    applyCov(normalizeCoverage(accumulated))
  }

  /** Applies any usable data found in the merged structured outputs. */
  function applyMergedOutputs(): void {
    const merged = finalOutputRef.current
    if (!merged) return

    const articleValue = findMergedValue(merged, [
      'enhancedarticlewriter.content',
      'enhanced_article',
      'content',
    ])
    if (articleValue !== undefined) {
      const text = articleTextFrom(parseIfJsonLike(articleValue))
      if (text.trim()) {
        dataPresentRef.current.article = true
        setContent(text)
      }
    }

    const strengths = findMergedValue(merged, ['gapanalysis.competitor_strengths', 'competitor_strengths'])
    const gaps = findMergedValue(merged, ['gapanalysis.coverage_gaps', 'coverage_gaps'])
    const underdeveloped = findMergedValue(merged, [
      'gapanalysis.underdeveloped_sections',
      'underdeveloped_sections',
    ])
    if (strengths !== undefined || gaps !== undefined || underdeveloped !== undefined) {
      applyGap(
        normalizeGapAnalysis({
          competitor_strengths: strengths,
          coverage_gaps: gaps,
          underdeveloped_sections: underdeveloped,
        }),
      )
    }

    const recList = findMergedValue(merged, ['recommendations.recommendations', 'recommendations'])
    const citations = findMergedValue(merged, [
      'recommendations.citation_opportunities',
      'citation_opportunities',
    ])
    const faqs = findMergedValue(merged, ['recommendations.faq_suggestions', 'faq_suggestions'])
    if (recList !== undefined || citations !== undefined || faqs !== undefined) {
      applyRec(
        normalizeRecommendations({
          recommendations: recList,
          citation_opportunities: citations,
          faq_suggestions: faqs,
        }),
      )
    }

    const score = findMergedValue(merged, ['coverageverifier.overall_score', 'overall_score'])
    const passed = findMergedValue(merged, ['coverageverifier.passed', 'passed'])
    const summary = findMergedValue(merged, ['coverageverifier.summary', 'summary'])
    const criteria = findMergedValue(merged, ['coverageverifier.criteria', 'criteria'])
    if (score !== undefined || passed !== undefined || summary !== undefined || criteria !== undefined) {
      applyCov(
        normalizeCoverage({ overall_score: score, passed, summary, criteria }),
      )
    }
  }

  /** Mines the raw transcript for a panel that never received routable data. */
  function salvagePanel(panel: PanelKey): void {
    const raw = rawTranscriptRef.current
    if (!raw) return
    if (panel === 'article') {
      const value = extractKeyValue(raw, 'content') ?? extractKeyValue(raw, 'enhanced_article')
      const text = articleTextFrom(value)
      if (text.trim()) {
        dataPresentRef.current.article = true
        setContent(text)
      }
      return
    }
    if (panel === 'gapanalysis') {
      applyGap(
        normalizeGapAnalysis({
          competitor_strengths: extractKeyValue(raw, 'competitor_strengths'),
          coverage_gaps: extractKeyValue(raw, 'coverage_gaps'),
          underdeveloped_sections: extractKeyValue(raw, 'underdeveloped_sections'),
        }),
      )
      return
    }
    if (panel === 'recommendations') {
      applyRec(
        normalizeRecommendations({
          recommendations: extractKeyValue(raw, 'recommendations'),
          citation_opportunities: extractKeyValue(raw, 'citation_opportunities'),
          faq_suggestions: extractKeyValue(raw, 'faq_suggestions'),
        }),
      )
      return
    }
    applyCov(
      normalizeCoverage({
        overall_score: extractKeyValue(raw, 'overall_score'),
        passed: extractKeyValue(raw, 'passed'),
        summary: extractKeyValue(raw, 'summary'),
        criteria: extractKeyValue(raw, 'criteria'),
      }),
    )
  }

  function finalizeRun(): void {
    if (doneRef.current) return
    doneRef.current = true
    applyMergedOutputs()
    for (const panel of ALL_PANELS) {
      if (!dataPresentRef.current[panel]) {
        applyPanelText(panel)
      }
      if (!dataPresentRef.current[panel]) {
        salvagePanel(panel)
      }
    }
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

  /** Handles one decoded stream payload (the part after `data:` in SSE). */
  function processEvent(payload: string): void {
    const trimmed = payload.trim()
    if (!trimmed) return
    if (trimmed === '[DONE]' || trimmed === 'DONE') {
      finalizeRun()
      return
    }
    rawTranscriptRef.current += `${trimmed}\n`

    const parsed = extractBalancedJson(trimmed)
    const rec = asRecord(parsed)
    if (!rec) {
      // Plain-text chunk with no JSON envelope.
      if (isHeartbeatMessage(trimmed)) {
        setStatusMessage(trimmed)
        return
      }
      looseTextRef.current += `${trimmed}\n`
      const panel = classifyUnknownPayload(looseTextRef.current)
      if (panel) {
        targetAccumRef.current[panel] += `${trimmed}\n`
        markStageActive(STAGE_FOR_PANEL[panel])
        markPanelStreaming(panel)
        applyPanelText(panel)
      }
      return
    }

    // Merge any structured outputs the event carries and apply immediately.
    const merged = finalOutputRef.current ?? {}
    collectStructured(rec, merged, 0)
    finalOutputRef.current = merged
    applyMergedOutputs()

    const chunk = chunkTextOf(rec)
    const blockId = firstStringOf(rec, [
      'blockId',
      'block_id',
      'blockid',
      'blockName',
      'blockname',
      'block_name',
    ])

    if (blockId) {
      blockAccumRef.current[blockId] = (blockAccumRef.current[blockId] ?? '') + chunk
      let target: BlockTarget | null = blockTargetRef.current[blockId] ?? resolveBlockTarget(blockId)
      if (!target) {
        target = classifyUnknownPayload(blockAccumRef.current[blockId])
      }
      if (!target) return
      blockTargetRef.current[blockId] = target
      if (!isPanelKey(target)) {
        setStatusMessage(statusLabelFor(target))
        return
      }
      markStageActive(STAGE_FOR_PANEL[target])
      markPanelStreaming(target)
      if (chunk) {
        targetAccumRef.current[target] += chunk
        applyPanelText(target)
      }
      return
    }

    if (chunk) {
      if (isHeartbeatMessage(chunk)) {
        setStatusMessage(chunk.trim())
        return
      }
      looseTextRef.current += chunk
      const panel = classifyUnknownPayload(looseTextRef.current)
      if (panel) {
        targetAccumRef.current[panel] += chunk
        markStageActive(STAGE_FOR_PANEL[panel])
        markPanelStreaming(panel)
        applyPanelText(panel)
      }
      return
    }

    const statusText = firstStringOf(rec, ['status', 'message'])
    if (statusText && isHeartbeatMessage(statusText)) {
      setStatusMessage(statusText)
    }
  }

  function handleLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    if (trimmed.startsWith('data:')) {
      processEvent(trimmed.slice(5).trim())
      return
    }
    if (trimmed.startsWith('event:') || trimmed.startsWith('id:') || trimmed.startsWith(':')) {
      return
    }
    processEvent(trimmed)
  }

  async function runStream(payload: EnhancePayload): Promise<void> {
    resetRun()
    lastPayloadRef.current = payload
    setPhase('streaming')
    startRef.current = Date.now()
    setStatusMessage('Contacting the enhancement agent…')

    abortRef.current?.abort()
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
        // Non-streamed fallback: apply the whole JSON body at once.
        const data: unknown = await res.json()
        rawTranscriptRef.current += `${JSON.stringify(data)}\n`
        const rec = asRecord(data)
        if (rec) {
          const merged = finalOutputRef.current ?? {}
          collectStructured(rec, merged, 0)
          finalOutputRef.current = merged
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
      let reading = true
      while (reading) {
        const { done, value } = await reader.read()
        if (done) {
          reading = false
          continue
        }
        buffer += decoder.decode(value, { stream: true })
        let newlineIndex = buffer.indexOf('\n')
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex)
          buffer = buffer.slice(newlineIndex + 1)
          handleLine(line)
          newlineIndex = buffer.indexOf('\n')
        }
      }
      buffer += decoder.decode()
      if (buffer.trim()) handleLine(buffer)
      finalizeRun()
    } catch (err) {
      if (controller.signal.aborted) return
      setPhase('error')
      setErrorMessage(
        err instanceof Error ? err.message : 'Something went wrong while enhancing the article.',
      )
    }
  }

  /**
   * Validation: Article URL and Article text are BOTH optional fields, but at
   * least ONE of the two must be provided when the user clicks the
   * "Enhance article" CTA. A provided URL must still be a valid http(s) URL.
   */
  function validate(): EnhancePayload | null {
    const nextErrors: EnhanceFormErrors = {}
    const url = articleUrl.trim()
    const text = articleText.trim()

    if (!url && !text) {
      const message = 'Provide an article URL or paste the article text — at least one is required.'
      nextErrors.articleUrl = message
      nextErrors.articleText = message
    } else if (url) {
      try {
        const parsedUrl = new URL(url)
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          nextErrors.articleUrl = 'Enter a valid http(s) URL.'
        }
      } catch {
        nextErrors.articleUrl = 'Enter a valid URL (including https://).'
      }
    }

    if (!contentType) {
      nextErrors.contentType = 'Select a content type.'
    }
    if (contentType === 'Other' && !otherType.trim()) {
      nextErrors.otherType = 'Describe the content type.'
    }

    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return null
    return {
      article_url: url,
      article_text: text,
      content_type: contentType === 'Other' ? otherType.trim() : contentType,
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (phase === 'streaming') return
    const payload = validate()
    if (!payload) return
    setSubmittedUrl(payload.article_url)
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
      // Fonts API unavailable — print with whatever is loaded.
    }
    window.print()
  }

  const checklistStages: ChecklistStage[] = STAGE_ORDER.map((id) => ({
    id,
    label: STAGE_LABELS[id],
    status: stages[id],
  }))

  const showResults = phase === 'streaming' || phase === 'done'

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="screen-only">
        <form
          onSubmit={handleSubmit}
          noValidate
          className="card-enter rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8"
        >
          <div className="space-y-5">
            <div>
              <label htmlFor="article-url" className="mb-1.5 block text-sm font-semibold text-ink">
                Article URL <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <input
                id="article-url"
                type="url"
                value={articleUrl}
                onChange={(event) => setArticleUrl(event.target.value)}
                placeholder="https://example.com/article"
                disabled={phase === 'streaming'}
                aria-invalid={Boolean(errors.articleUrl)}
                className={`${inputBase} ${errors.articleUrl ? 'border-rose-300' : 'border-slate-200'}`}
              />
              {errors.articleUrl ? (
                <p role="alert" className="mt-1.5 text-xs font-medium text-rose-600">
                  {errors.articleUrl}
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor="article-text" className="mb-1.5 block text-sm font-semibold text-ink">
                Article text <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <textarea
                id="article-text"
                rows={8}
                value={articleText}
                onChange={(event) => setArticleText(event.target.value)}
                placeholder="Paste the full article text here…"
                disabled={phase === 'streaming'}
                aria-invalid={Boolean(errors.articleText)}
                className={`${inputBase} resize-y ${errors.articleText ? 'border-rose-300' : 'border-slate-200'}`}
              />
              {errors.articleText ? (
                <p role="alert" className="mt-1.5 text-xs font-medium text-rose-600">
                  {errors.articleText}
                </p>
              ) : null}
            </div>

            <p className="text-xs leading-relaxed text-slate-400">
              Provide the article URL or paste the article text — at least one is required.
            </p>

            <div>
              <label htmlFor="content-type" className="mb-1.5 block text-sm font-semibold text-ink">
                Content type
              </label>
              <select
                id="content-type"
                value={contentType}
                onChange={(event) => setContentType(event.target.value)}
                disabled={phase === 'streaming'}
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
                <p role="alert" className="mt-1.5 text-xs font-medium text-rose-600">
                  {errors.contentType}
                </p>
              ) : null}
            </div>

            {contentType === 'Other' ? (
              <div>
                <label htmlFor="other-type" className="mb-1.5 block text-sm font-semibold text-ink">
                  Describe the content type
                </label>
                <input
                  id="other-type"
                  type="text"
                  value={otherType}
                  onChange={(event) => setOtherType(event.target.value)}
                  placeholder="e.g. Case Study"
                  disabled={phase === 'streaming'}
                  aria-invalid={Boolean(errors.otherType)}
                  className={`${inputBase} ${errors.otherType ? 'border-rose-300' : 'border-slate-200'}`}
                />
                {errors.otherType ? (
                  <p role="alert" className="mt-1.5 text-xs font-medium text-rose-600">
                    {errors.otherType}
                  </p>
                ) : null}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={phase === 'streaming'}
              className="inline-flex w-full items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-deep focus:outline-none focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {phase === 'streaming' ? 'Enhancing…' : 'Enhance article'}
            </button>
          </div>
        </form>

        {phase === 'streaming' ? (
          <div className="mt-6 space-y-4">
            <StatusChip message={statusMessage || 'Working on it…'} elapsedSeconds={elapsed} />
            <ProgressChecklist stages={checklistStages} />
          </div>
        ) : null}

        {phase === 'error' ? (
          <div className="mt-6">
            <ErrorCard message={errorMessage} onRetry={handleRetry} />
          </div>
        ) : null}
      </div>

      {showResults ? (
        <div className="mt-8">
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
        </div>
      ) : null}

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
