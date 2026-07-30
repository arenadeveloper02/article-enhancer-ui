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
  function renormalizePanel(panel: PanelKey): void {
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
        gapRef.current = data
        dataPresentRef.current.gapanalysis = true
        setGapData(data)
      }
      return
    }
    if (panel === 'recommendations') {
      const data = normalizeRecommendations(accumulated)
      if (data.recommendations.length > 0) {
        recRef.current = data
        dataPresentRef.current.recommendations = true
        setRecData(data)
      }
      return
    }
    const data = normalizeCoverage(accumulated)
    if (!isCovEmpty(data)) {
      covRef.current = data
      dataPresentRef.current.coverage = true
      setCoverage(data)
    }
  }

  /**
   * Applies any structured outputs collected so far (dotted keys such as
   * gapanalysis.coverage_gaps, recommendations.citation_opportunities,
   * coverageverifier.criteria, enhancedarticlewriter.content) to the panels.
   * Runs after every event AND at [DONE], so the Recommendations tab renders
   * real data - never placeholders - as soon as the workflow emits it.
   */
  function applyMergedOutputs(): void {
    const merged = finalOutputRef.current
    if (!merged) return

    const articleValue = findMergedValue(merged, [
      'enhancedarticlewriter.content',
      'enhanced_article',
      'content',
    ])
    const articleStr = articleTextFrom(parseIfJsonLike(articleValue))
    if (articleStr.trim() && articleStr.trim().length > targetAccumRef.current.article.trim().length) {
      targetAccumRef.current.article = articleStr
      dataPresentRef.current.article = true
      setContent(articleStr)
      markPanelStreaming('article')
    }

    const gap = normalizeGapAnalysis(merged)
    if (!isGapEmpty(gap)) {
      gapRef.current = gap
      dataPresentRef.current.gapanalysis = true
      setGapData(gap)
      markPanelStreaming('gapanalysis')
    }

    const rec = normalizeRecommendations(merged)
    if (rec.recommendations.length > 0) {
      recRef.current = rec
      dataPresentRef.current.recommendations = true
      setRecData(rec)
      markPanelStreaming('recommendations')
    }

    const cov = normalizeCoverage(merged)
    if (!isCovEmpty(cov)) {
      covRef.current = cov
      dataPresentRef.current.coverage = true
      setCoverage(cov)
      markPanelStreaming('coverage')
    }
  }

  function handleStreamEvent(raw: unknown): void {
    if (typeof raw === 'string') {
      rawTranscriptRef.current += `${raw}\n`
      const trimmed = raw.trim()
      if (trimmed && isHeartbeatMessage(trimmed)) {
        setStatusMessage(trimmed)
      } else if (trimmed) {
        looseTextRef.current += raw
        const panel = classifyUnknownPayload(looseTextRef.current)
        if (panel) {
          targetAccumRef.current[panel] = looseTextRef.current
          markPanelStreaming(panel)
          renormalizePanel(panel)
        }
      }
      return
    }
    const rec = asRecord(raw)
    if (!rec) return

    try {
      rawTranscriptRef.current += `${JSON.stringify(rec)}\n`
    } catch {
      // Non-serializable event - transcript salvage simply skips it.
    }

    const status = firstStringOf(rec, ['status', 'message'])
    if (status && isHeartbeatMessage(status)) {
      setStatusMessage(status)
    }

    const blockId = firstStringOf(rec, ['blockId', 'block_id', 'blockid', 'blockName', 'blockname'])
    const chunk = chunkTextOf(rec)

    let target: BlockTarget | null = null
    let newlyClassified = false
    if (blockId) {
      target = blockTargetRef.current[blockId] ?? resolveBlockTarget(blockId)
    }
    if (blockId && chunk) {
      blockAccumRef.current[blockId] = (blockAccumRef.current[blockId] ?? '') + chunk
      if (!target) {
        const classified = classifyUnknownPayload(blockAccumRef.current[blockId])
        if (classified) {
          target = classified
          newlyClassified = true
        }
      }
      if (target) blockTargetRef.current[blockId] = target
    }

    if (target === 'status-theme' || target === 'status-research') {
      setStatusMessage(statusLabelFor(target))
    } else if (target) {
      const panel = target
      if (chunk) {
        if (newlyClassified && blockId) {
          targetAccumRef.current[panel] += blockAccumRef.current[blockId] ?? ''
        } else {
          targetAccumRef.current[panel] += chunk
        }
        markPanelStreaming(panel)
        renormalizePanel(panel)
      }
    } else if (chunk) {
      looseTextRef.current += chunk
      if (!isHeartbeatMessage(chunk)) {
        const panel = classifyUnknownPayload(looseTextRef.current)
        if (panel) {
          targetAccumRef.current[panel] = looseTextRef.current
          markPanelStreaming(panel)
          renormalizePanel(panel)
        }
      }
    }

    // Merge any structured (non-chunk) outputs the event carries and apply
    // them immediately - this is how the Recommendations / Gap Analysis /
    // Coverage tabs receive their real data.
    const merged = finalOutputRef.current ?? {}
    collectStructured(rec, merged, 0)
    finalOutputRef.current = merged
    applyMergedOutputs()
  }

  function finalizeRun(): void {
    if (doneRef.current) return
    doneRef.current = true
    applyMergedOutputs()

    // Salvage pass: mine the raw transcript for any panel that never received
    // routable data.
    const transcript = rawTranscriptRef.current
    if (transcript.trim()) {
      if (!dataPresentRef.current.article) {
        for (const key of ['enhanced_article', 'content', 'article']) {
          const value = extractKeyValue(transcript, key)
          const text = articleTextFrom(value)
          if (text.trim()) {
            setContent(text)
            dataPresentRef.current.article = true
            break
          }
        }
      }
      if (!dataPresentRef.current.gapanalysis) {
        const gap = normalizeGapAnalysis(transcript)
        if (!isGapEmpty(gap)) {
          setGapData(gap)
          dataPresentRef.current.gapanalysis = true
        }
      }
      if (!dataPresentRef.current.recommendations) {
        const rec = normalizeRecommendations(transcript)
        if (rec.recommendations.length > 0) {
          setRecData(rec)
          dataPresentRef.current.recommendations = true
        }
      }
      if (!dataPresentRef.current.coverage) {
        const cov = normalizeCoverage(transcript)
        if (!isCovEmpty(cov)) {
          setCoverage(cov)
          dataPresentRef.current.coverage = true
        }
      }
    }

    setStages({
      gapanalysis: 'done',
      recommendations: 'done',
      enhancedarticlewriter: 'done',
      coverageverifier: 'done',
    })
    const nextSections: Record<PanelKey, SectionStatus> = { ...INITIAL_SECTIONS }
    for (const panel of ALL_PANELS) {
      nextSections[panel] = dataPresentRef.current[panel] ? 'done' : 'empty'
    }
    setSections(nextSections)
    setStatusMessage('')
    setPhase('done')
  }

  async function runEnhancement(payload: EnhancePayload): Promise<void> {
    resetRun()
    lastPayloadRef.current = payload
    setSubmittedUrl(payload.article_url)
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
        throw new Error(body?.error || `The enhancement request failed (${res.status}).`)
      }

      const resContentType = res.headers.get('content-type') ?? ''
      if (resContentType.includes('application/json')) {
        // Non-streamed fallback: a single JSON body with the full outputs.
        const data: unknown = await res.json()
        const rec = asRecord(data)
        if (rec) {
          try {
            rawTranscriptRef.current += `${JSON.stringify(rec)}\n`
          } catch {
            // Skip transcript when serialization fails.
          }
          const merged = finalOutputRef.current ?? {}
          collectStructured(rec, merged, 0)
          finalOutputRef.current = merged
          applyMergedOutputs()
        } else if (typeof data === 'string') {
          rawTranscriptRef.current += `${data}\n`
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
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          const dataText = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed
          if (!dataText || dataText === '[DONE]') continue
          try {
            handleStreamEvent(JSON.parse(dataText) as unknown)
          } catch {
            handleStreamEvent(dataText)
          }
        }
      }
      buffer += decoder.decode()
      const rest = buffer.trim()
      if (rest) {
        const dataText = rest.startsWith('data:') ? rest.slice(5).trim() : rest
        if (dataText && dataText !== '[DONE]') {
          try {
            handleStreamEvent(JSON.parse(dataText) as unknown)
          } catch {
            handleStreamEvent(dataText)
          }
        }
      }
      finalizeRun()
    } catch (err) {
      if (controller.signal.aborted) return
      setErrorMessage(
        err instanceof Error ? err.message : 'Something went wrong. Please try again.',
      )
      setStatusMessage('')
      setPhase('error')
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (phase === 'streaming') return
    const nextErrors: EnhanceFormErrors = {}
    const url = articleUrl.trim()
    if (!url) {
      nextErrors.articleUrl = 'Article URL is required.'
    } else {
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          nextErrors.articleUrl = 'Enter a valid http(s) URL.'
        }
      } catch {
        nextErrors.articleUrl = 'Enter a valid URL, including https://.'
      }
    }
    if (!contentType) {
      nextErrors.contentType = 'Select a content type.'
    }
    if (contentType === 'Other' && !otherType.trim()) {
      nextErrors.otherType = 'Describe the content type.'
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    const resolvedType = contentType === 'Other' ? otherType.trim() : contentType
    void runEnhancement({
      article_url: url,
      article_text: articleText.trim(),
      content_type: resolvedType,
    })
  }

  function handleRetry(): void {
    const payload = lastPayloadRef.current
    if (payload) {
      void runEnhancement(payload)
    } else {
      setErrorMessage('')
      setPhase('idle')
    }
  }

  function handleCancel(): void {
    abortRef.current?.abort()
    finalizeRun()
  }

  async function handleExport(): Promise<void> {
    try {
      await document.fonts.ready
    } catch {
      // Fonts API unavailable - print with whatever is loaded.
    }
    window.print()
  }

  const streaming = phase === 'streaming'
  const showResults = phase === 'streaming' || phase === 'done'

  const checklistStages: ChecklistStage[] = STAGE_ORDER.map((id) => ({
    id,
    label: STAGE_LABELS[id],
    status: stages[id],
  }))

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="screen-only space-y-6">
        <form
          onSubmit={handleSubmit}
          aria-label="Article enhancement form"
          className="card-enter rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8"
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="article-url" className="mb-1.5 block text-sm font-medium text-ink">
                Article URL <span className="text-rose-500">*</span>
              </label>
              <input
                id="article-url"
                type="url"
                inputMode="url"
                placeholder="https://example.com/your-article"
                value={articleUrl}
                onChange={(event) => setArticleUrl(event.target.value)}
                disabled={streaming}
                aria-invalid={errors.articleUrl ? true : undefined}
                className={`${inputBase} ${errors.articleUrl ? 'border-rose-300' : 'border-slate-200'}`}
              />
              {errors.articleUrl ? (
                <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.articleUrl}</p>
              ) : null}
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="article-text" className="mb-1.5 block text-sm font-medium text-ink">
                Article text{' '}
                <span className="text-xs font-normal text-slate-400">
                  (optional — the agent reads the article from the URL when omitted)
                </span>
              </label>
              <textarea
                id="article-text"
                rows={7}
                placeholder="Paste the full article text here…"
                value={articleText}
                onChange={(event) => setArticleText(event.target.value)}
                disabled={streaming}
                className={`${inputBase} resize-y border-slate-200`}
              />
              {errors.articleText ? (
                <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.articleText}</p>
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
                disabled={streaming}
                aria-invalid={errors.contentType ? true : undefined}
                className={`${inputBase} ${errors.contentType ? 'border-rose-300' : 'border-slate-200'}`}
              >
                <option value="" disabled>
                  Select a content type…
                </option>
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
                  Describe the content type <span className="text-rose-500">*</span>
                </label>
                <input
                  id="other-type"
                  type="text"
                  placeholder="e.g. Comparison page"
                  value={otherType}
                  onChange={(event) => setOtherType(event.target.value)}
                  disabled={streaming}
                  aria-invalid={errors.otherType ? true : undefined}
                  className={`${inputBase} ${errors.otherType ? 'border-rose-300' : 'border-slate-200'}`}
                />
                {errors.otherType ? (
                  <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.otherType}</p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={streaming}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-60"
            >
              {streaming ? 'Enhancing…' : 'Enhance article'}
            </button>
            {streaming ? (
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-ink-soft transition hover:border-rose-200 hover:text-rose-600"
              >
                Cancel
              </button>
            ) : null}
            {streaming && statusMessage ? (
              <StatusChip message={statusMessage} elapsedSeconds={elapsed} />
            ) : null}
          </div>
        </form>

        {streaming ? <ProgressChecklist stages={checklistStages} /> : null}

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
            onExport={
              phase === 'done'
                ? () => {
                    void handleExport()
                  }
                : undefined
            }
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
