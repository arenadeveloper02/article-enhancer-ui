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
  function applyPanelData(panel: PanelKey): void {
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
      const data = normalizeGapAnalysis(accumulated)
      if (!isGapEmpty(data)) {
        dataPresentRef.current.gapanalysis = true
        gapRef.current = data
        setGapData(data)
      }
      return
    }
    if (panel === 'recommendations') {
      const data = normalizeRecommendations(accumulated)
      if (data.recommendations.length > 0) {
        dataPresentRef.current.recommendations = true
        recRef.current = data
        setRecData(data)
      }
      return
    }
    const data = normalizeCoverage(accumulated)
    if (!isCovEmpty(data)) {
      dataPresentRef.current.coverage = true
      covRef.current = data
      setCoverage(data)
    }
  }

  /** Routes merged structured outputs into any panel that has no data yet. */
  function applyMergedOutputs(): void {
    const merged = finalOutputRef.current
    if (!merged) return
    if (!dataPresentRef.current.article) {
      const value = findMergedValue(merged, [
        'enhancedarticlewriter.content',
        'enhanced_article',
        'article',
        'content',
      ])
      const text = articleTextFrom(parseIfJsonLike(value))
      if (text.trim()) {
        dataPresentRef.current.article = true
        markPanelStreaming('article')
        setContent(text)
      }
    }
    if (!dataPresentRef.current.gapanalysis) {
      const data = normalizeGapAnalysis(merged)
      if (!isGapEmpty(data)) {
        dataPresentRef.current.gapanalysis = true
        gapRef.current = data
        markPanelStreaming('gapanalysis')
        setGapData(data)
      }
    }
    if (!dataPresentRef.current.recommendations) {
      const data = normalizeRecommendations(merged)
      if (data.recommendations.length > 0) {
        dataPresentRef.current.recommendations = true
        recRef.current = data
        markPanelStreaming('recommendations')
        setRecData(data)
      }
    }
    if (!dataPresentRef.current.coverage) {
      const data = normalizeCoverage(merged)
      if (!isCovEmpty(data)) {
        dataPresentRef.current.coverage = true
        covRef.current = data
        markPanelStreaming('coverage')
        setCoverage(data)
      }
    }
  }

  /** Last-chance salvage from the raw transcript for panels that never got data. */
  function salvageFromTranscript(): void {
    const transcript = rawTranscriptRef.current
    if (!transcript.trim()) return
    if (!dataPresentRef.current.article) {
      const value = extractKeyValue(transcript, 'content')
      const text = articleTextFrom(value)
      if (text.trim()) {
        dataPresentRef.current.article = true
        setContent(text)
      }
    }
    if (!dataPresentRef.current.gapanalysis) {
      const data = normalizeGapAnalysis(transcript)
      if (!isGapEmpty(data)) {
        dataPresentRef.current.gapanalysis = true
        gapRef.current = data
        setGapData(data)
      }
    }
    if (!dataPresentRef.current.recommendations) {
      const data = normalizeRecommendations(transcript)
      if (data.recommendations.length > 0) {
        dataPresentRef.current.recommendations = true
        recRef.current = data
        setRecData(data)
      }
    }
    if (!dataPresentRef.current.coverage) {
      const data = normalizeCoverage(transcript)
      if (!isCovEmpty(data)) {
        dataPresentRef.current.coverage = true
        covRef.current = data
        setCoverage(data)
      }
    }
  }

  function handleEventRecord(rec: Record<string, unknown>): void {
    const blockId = firstStringOf(rec, ['blockId', 'block_id', 'blockid', 'blockName', 'blockname', 'id'])
    const chunk = chunkTextOf(rec)
    const message = firstStringOf(rec, ['message', 'status'])
    if (message && isHeartbeatMessage(message)) {
      setStatusMessage(message)
    }

    // Merge any structured (non-reserved) keys so the panels can render as
    // soon as usable data appears — not only at [DONE].
    const merged: Record<string, unknown> = finalOutputRef.current ?? {}
    collectStructured(rec, merged, 0)
    finalOutputRef.current = merged

    const target: BlockTarget | null = blockId
      ? (blockTargetRef.current[blockId] ?? resolveBlockTarget(blockId))
      : null
    if (blockId && target) blockTargetRef.current[blockId] = target

    if (chunk) {
      if (target === 'status-theme' || target === 'status-research') {
        setStatusMessage(statusLabelFor(target))
      } else if (target) {
        targetAccumRef.current[target] += chunk
        markPanelStreaming(target)
        applyPanelData(target)
      } else if (blockId) {
        blockAccumRef.current[blockId] = (blockAccumRef.current[blockId] ?? '') + chunk
        const classified = classifyUnknownPayload(blockAccumRef.current[blockId])
        if (classified) {
          blockTargetRef.current[blockId] = classified
          targetAccumRef.current[classified] += blockAccumRef.current[blockId]
          blockAccumRef.current[blockId] = ''
          markPanelStreaming(classified)
          applyPanelData(classified)
        }
      } else if (!isHeartbeatMessage(chunk)) {
        looseTextRef.current += chunk
        const classified = classifyUnknownPayload(looseTextRef.current)
        if (classified) {
          targetAccumRef.current[classified] += looseTextRef.current
          looseTextRef.current = ''
          markPanelStreaming(classified)
          applyPanelData(classified)
        }
      }
    }

    applyMergedOutputs()
  }

  function processLine(rawLine: string): void {
    const line = rawLine.trim()
    if (!line) return
    const payloadText = line.startsWith('data:') ? line.slice(5).trim() : line
    if (!payloadText) return
    if (payloadText === '[DONE]') {
      doneRef.current = true
      return
    }
    rawTranscriptRef.current += `${payloadText}\n`
    let parsed: unknown
    try {
      parsed = JSON.parse(payloadText) as unknown
    } catch {
      parsed = extractBalancedJson(payloadText)
    }
    const rec = asRecord(parsed)
    if (!rec) {
      if (isHeartbeatMessage(payloadText)) {
        setStatusMessage(payloadText)
        return
      }
      looseTextRef.current += payloadText
      const classified = classifyUnknownPayload(looseTextRef.current)
      if (classified) {
        targetAccumRef.current[classified] += looseTextRef.current
        looseTextRef.current = ''
        markPanelStreaming(classified)
        applyPanelData(classified)
      }
      return
    }
    handleEventRecord(rec)
  }

  function finalizeRun(): void {
    doneRef.current = true
    salvageFromTranscript()
    applyMergedOutputs()
    setStages((prev) => {
      const next = { ...prev }
      for (const id of STAGE_ORDER) next[id] = 'done'
      return next
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

  async function runStream(payload: EnhancePayload): Promise<void> {
    const controller = new AbortController()
    abortRef.current = controller
    startRef.current = Date.now()
    setPhase('streaming')
    setStatusMessage('Contacting the enhancement agent…')
    try {
      const res = await fetch('/api/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error || `The enhancement request failed (${res.status}).`)
      }
      const responseType = res.headers.get('content-type') ?? ''
      if (responseType.includes('application/json')) {
        const data: unknown = await res.json()
        const rec = asRecord(data)
        if (rec) {
          const merged: Record<string, unknown> = finalOutputRef.current ?? {}
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
        if (value) buffer += decoder.decode(value, { stream: true })
        let newlineIndex = buffer.indexOf('\n')
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex)
          buffer = buffer.slice(newlineIndex + 1)
          processLine(line)
          if (doneRef.current) break
          newlineIndex = buffer.indexOf('\n')
        }
        if (doneRef.current) break
      }
      if (buffer.trim() && !doneRef.current) processLine(buffer)
      finalizeRun()
    } catch (err) {
      if (controller.signal.aborted) return
      setPhase('error')
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    }
  }

  function validate(): boolean {
    const next: EnhanceFormErrors = {}
    const url = articleUrl.trim()
    if (!url) {
      next.articleUrl = 'Article URL is required.'
    } else {
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          next.articleUrl = 'Enter a valid http(s) URL.'
        }
      } catch {
        next.articleUrl = 'Enter a valid URL, e.g. https://example.com/article.'
      }
    }
    if (!contentType) next.contentType = 'Select a content type.'
    if (contentType === 'Other' && !otherType.trim()) {
      next.otherType = 'Describe the content type.'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (phase === 'streaming') return
    if (!validate()) return
    const resolvedType = contentType === 'Other' ? otherType.trim() : contentType
    const payload: EnhancePayload = {
      article_url: articleUrl.trim(),
      article_text: articleText.trim(),
      content_type: resolvedType,
    }
    lastPayloadRef.current = payload
    setSubmittedUrl(payload.article_url)
    resetRun()
    void runStream(payload)
  }

  function handleRetry(): void {
    const payload = lastPayloadRef.current
    if (!payload) {
      setPhase('idle')
      setErrorMessage('')
      return
    }
    resetRun()
    void runStream(payload)
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
    <div className="w-full">
      <div className="screen-only">
        {/* URL card: every field aligned to the shared content width. */}
        <form
          onSubmit={handleSubmit}
          noValidate
          className="card-enter rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8"
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <label htmlFor="article-url" className="mb-1.5 block text-sm font-medium text-ink">
                Article URL <span className="text-rose-500">*</span>
              </label>
              <input
                id="article-url"
                type="url"
                value={articleUrl}
                onChange={(event) => setArticleUrl(event.target.value)}
                placeholder="https://example.com/blog/my-article"
                disabled={phase === 'streaming'}
                className={`${inputBase} ${errors.articleUrl ? 'border-rose-300' : 'border-slate-200'}`}
              />
              {errors.articleUrl ? (
                <p className="mt-1 text-xs text-rose-600">{errors.articleUrl}</p>
              ) : null}
            </div>
            <div>
              <label htmlFor="content-type" className="mb-1.5 block text-sm font-medium text-ink">
                Content type <span className="text-rose-500">*</span>
              </label>
              <select
                id="content-type"
                value={contentType}
                onChange={(event) => setContentType(event.target.value)}
                disabled={phase === 'streaming'}
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
                <p className="mt-1 text-xs text-rose-600">{errors.contentType}</p>
              ) : null}
              {contentType === 'Other' && (
                <div className="mt-3">
                  <label htmlFor="other-type" className="mb-1.5 block text-sm font-medium text-ink">
                    Describe the content type <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="other-type"
                    type="text"
                    value={otherType}
                    onChange={(event) => setOtherType(event.target.value)}
                    placeholder="e.g. Comparison page, Glossary entry…"
                    disabled={phase === 'streaming'}
                    className={`${inputBase} ${errors.otherType ? 'border-rose-300' : 'border-slate-200'}`}
                  />
                  {errors.otherType ? (
                    <p className="mt-1 text-xs text-rose-600">{errors.otherType}</p>
                  ) : null}
                </div>
              )}
            </div>
          </div>
          <div className="mt-5">
            <label htmlFor="article-text" className="mb-1.5 block text-sm font-medium text-ink">
              Article text <span className="font-normal text-slate-400">(optional — the agent reads the URL when omitted)</span>
            </label>
            <textarea
              id="article-text"
              rows={6}
              value={articleText}
              onChange={(event) => setArticleText(event.target.value)}
              placeholder="Paste the article body here to skip fetching it from the URL…"
              disabled={phase === 'streaming'}
              className={`${inputBase} resize-y border-slate-200`}
            />
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-ink-soft">
              Runs gap analysis, recommendations, an enhanced draft, and coverage verification — streamed live.
            </p>
            <button
              type="submit"
              disabled={phase === 'streaming'}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-deep focus:outline-none focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {phase === 'streaming' ? (
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

        {phase === 'streaming' && (
          <div className="mt-5">
            <StatusChip message={statusMessage || 'Working on it…'} elapsedSeconds={elapsed} />
          </div>
        )}

        {phase === 'error' && (
          <div className="mt-5">
            <ErrorCard message={errorMessage} onRetry={handleRetry} />
          </div>
        )}

        {showResults && (
          <div className="mt-5 space-y-6">
            <ProgressChecklist stages={checklistStages} />
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
        )}
      </div>

      {/* Print-only mirror: powers the Export (window.print) output. */}
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
