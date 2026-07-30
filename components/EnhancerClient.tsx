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
  'w-full rounded-xl border bg-white px-4 py-2.5 text-sm text-ink shadow-sm transition placeholder:text-slate-400 focus:outline-none focus-visible:outline-2 focus-visible:outline-accent'

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
  // Full raw transcript of every stream payload — the salvage pass mines this
  // when a panel never received routable data.
  const rawTranscriptRef = useRef('')
  // Merged structured outputs from ANY event carrying dotted keys, panel-name
  // keys, or output/result/data envelopes. Applied after every event so the
  // UI renders as soon as usable data appears — not only at [DONE].
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

  function panelText(panel: PanelKey): string {
    let out = ''
    for (const [blockId, text] of Object.entries(blockAccumRef.current)) {
      if (blockTargetRef.current[blockId] === panel) out += text
    }
    return out
  }

  function applyPanel(panel: PanelKey): void {
    const text = panelText(panel)
    targetAccumRef.current[panel] = text
    if (!text.trim()) return
    markPanelStreaming(panel)
    if (panel === 'article') {
      const article = articleFromAccumulated(text)
      if (article.trim() && !isHeartbeatMessage(article)) {
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

  /**
   * Applies any usable data found in the merged structured outputs to panels
   * that have not yet received routable stream chunks.
   */
  function applyMergedOutputs(): void {
    const merged = finalOutputRef.current
    if (!merged) return
    if (!dataPresentRef.current.article) {
      const value = findMergedValue(merged, [
        'enhancedarticlewriter.content',
        'enhanced_article',
        'content',
        'article',
      ])
      const article = articleTextFrom(parseIfJsonLike(value))
      if (article.trim() && !isHeartbeatMessage(article)) {
        dataPresentRef.current.article = true
        markPanelStreaming('article')
        setContent(article)
      }
    }
    if (!dataPresentRef.current.gapanalysis) {
      const data = normalizeGapAnalysis(merged)
      if (!isGapEmpty(data)) {
        gapRef.current = data
        dataPresentRef.current.gapanalysis = true
        markPanelStreaming('gapanalysis')
        setGapData(data)
      }
    }
    if (!dataPresentRef.current.recommendations) {
      const data = normalizeRecommendations(merged)
      if (data.recommendations.length > 0) {
        recRef.current = data
        dataPresentRef.current.recommendations = true
        markPanelStreaming('recommendations')
        setRecData(data)
      }
    }
    if (!dataPresentRef.current.coverage) {
      const data = normalizeCoverage(merged)
      if (!isCovEmpty(data)) {
        covRef.current = data
        dataPresentRef.current.coverage = true
        markPanelStreaming('coverage')
        setCoverage(data)
      }
    }
  }

  /**
   * Final salvage pass over the raw transcript for panels that never received
   * routable or merged data during the stream.
   */
  function salvageFromTranscript(): void {
    const text = rawTranscriptRef.current
    if (!text) return
    if (!dataPresentRef.current.article) {
      const value = extractKeyValue(text, 'content')
      const article = articleTextFrom(value)
      if (article.trim() && !isHeartbeatMessage(article)) {
        dataPresentRef.current.article = true
        setContent(article)
      }
    }
    if (!dataPresentRef.current.gapanalysis) {
      const strengths = extractKeyValue(text, 'competitor_strengths')
      const gaps = extractKeyValue(text, 'coverage_gaps')
      const under = extractKeyValue(text, 'underdeveloped_sections')
      if (strengths !== undefined || gaps !== undefined || under !== undefined) {
        const data = normalizeGapAnalysis({
          competitor_strengths: strengths,
          coverage_gaps: gaps,
          underdeveloped_sections: under,
        })
        if (!isGapEmpty(data)) {
          gapRef.current = data
          dataPresentRef.current.gapanalysis = true
          setGapData(data)
        }
      }
    }
    if (!dataPresentRef.current.recommendations) {
      const value = extractKeyValue(text, 'recommendations')
      if (value !== undefined) {
        const data = normalizeRecommendations(value)
        if (data.recommendations.length > 0) {
          recRef.current = data
          dataPresentRef.current.recommendations = true
          setRecData(data)
        }
      }
    }
    if (!dataPresentRef.current.coverage) {
      const score = extractKeyValue(text, 'overall_score')
      const passed = extractKeyValue(text, 'passed')
      const summary = extractKeyValue(text, 'summary')
      const criteria = extractKeyValue(text, 'criteria')
      if (score !== undefined || passed !== undefined || summary !== undefined || criteria !== undefined) {
        const data = normalizeCoverage({
          overall_score: score,
          passed,
          summary,
          criteria,
        })
        if (!isCovEmpty(data)) {
          covRef.current = data
          dataPresentRef.current.coverage = true
          setCoverage(data)
        }
      }
    }
  }

  function finalizeRun(): void {
    doneRef.current = true
    applyMergedOutputs()
    salvageFromTranscript()
    setSections({
      article: dataPresentRef.current.article ? 'done' : 'empty',
      gapanalysis: dataPresentRef.current.gapanalysis ? 'done' : 'empty',
      recommendations: dataPresentRef.current.recommendations ? 'done' : 'empty',
      coverage: dataPresentRef.current.coverage ? 'done' : 'empty',
    })
    setStages({
      gapanalysis: 'done',
      recommendations: 'done',
      enhancedarticlewriter: 'done',
      coverageverifier: 'done',
    })
    setStatusMessage('')
    setPhase('done')
  }

  function handleStreamEvent(raw: string): void {
    rawTranscriptRef.current += raw + '\n'
    const parsed = extractBalancedJson(raw)
    if (parsed === null) {
      // Plain text with no JSON envelope — classify the accumulated run.
      looseTextRef.current += raw
      const target = classifyUnknownPayload(looseTextRef.current)
      if (target) {
        blockAccumRef.current['__loose__'] = looseTextRef.current
        blockTargetRef.current['__loose__'] = target
        applyPanel(target)
      }
      return
    }
    const rec = asRecord(parsed)
    if (!rec) return

    const blockId = firstStringOf(rec, ['blockId', 'block_id', 'blockid', 'blockName', 'blockname', 'block'])
    const chunkText = firstStringOf(rec, ['chunk', 'delta', 'text'])

    if (chunkText) {
      const key = blockId || '__unknown__'
      blockAccumRef.current[key] = (blockAccumRef.current[key] ?? '') + chunkText
      let target: BlockTarget | null = blockTargetRef.current[key] ?? null
      if (!target && blockId) target = resolveBlockTarget(blockId)
      if (!target) target = classifyUnknownPayload(blockAccumRef.current[key])
      if (target) {
        blockTargetRef.current[key] = target
        if (target === 'status-theme' || target === 'status-research') {
          setStatusMessage(statusLabelFor(target))
        } else {
          applyPanel(target)
        }
      }
    } else {
      const message = firstStringOf(rec, ['message', 'status'])
      if (message && message.length < 220) setStatusMessage(message)
    }

    // Merge any structured (non-chunk) outputs carried on this event and apply
    // immediately so panels render as soon as usable data appears.
    const merged = finalOutputRef.current ?? {}
    collectStructured(rec, merged, 0)
    finalOutputRef.current = merged
    applyMergedOutputs()
  }

  async function runStream(payload: EnhancePayload): Promise<void> {
    const controller = new AbortController()
    abortRef.current = controller
    let response: Response
    try {
      response = await fetch('/api/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
    } catch {
      if (controller.signal.aborted) return
      setErrorMessage('Could not reach the enhancement service. Please check your connection and try again.')
      setPhase('error')
      return
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      setErrorMessage(body?.error || `The enhancement request failed (${response.status}).`)
      setPhase('error')
      return
    }

    const responseType = response.headers.get('content-type') ?? ''
    if (responseType.includes('application/json')) {
      // Non-streamed fallback: treat the whole body as one final event.
      const data: unknown = await response.json().catch(() => null)
      if (data !== null) {
        try {
          rawTranscriptRef.current += JSON.stringify(data)
        } catch {
          // ignore serialization issues
        }
        const rec = asRecord(data)
        if (rec) {
          const merged = finalOutputRef.current ?? {}
          collectStructured(rec, merged, 0)
          finalOutputRef.current = merged
        }
      }
      finalizeRun()
      return
    }

    if (!response.body) {
      setErrorMessage('The enhancement service returned an empty response.')
      setPhase('error')
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let newlineIndex = buffer.indexOf('\n')
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).trim()
          buffer = buffer.slice(newlineIndex + 1)
          newlineIndex = buffer.indexOf('\n')
          if (!line) continue
          const data = line.startsWith('data:') ? line.slice(5).trim() : line
          if (!data || data === '[DONE]') continue
          handleStreamEvent(data)
        }
      }
      const tail = buffer.trim()
      if (tail) {
        const data = tail.startsWith('data:') ? tail.slice(5).trim() : tail
        if (data && data !== '[DONE]') handleStreamEvent(data)
      }
    } catch {
      if (controller.signal.aborted) return
      setErrorMessage('The stream was interrupted. Please try again.')
      setPhase('error')
      return
    }
    finalizeRun()
  }

  function validate(): EnhanceFormErrors {
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
        next.articleUrl = 'Enter a valid URL, including https://.'
      }
    }
    if (!contentType) next.contentType = 'Select a content type.'
    if (contentType === 'Other' && !otherType.trim()) next.otherType = 'Describe the content type.'
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
    lastPayloadRef.current = payload
    abortRef.current?.abort()
    resetRun()
    setSubmittedUrl(payload.article_url)
    startRef.current = Date.now()
    setPhase('streaming')
    setStatusMessage('Starting enhancement…')
    void runStream(payload)
  }

  function handleRetry(): void {
    const payload = lastPayloadRef.current
    if (!payload) {
      setErrorMessage('')
      setPhase('idle')
      return
    }
    abortRef.current?.abort()
    resetRun()
    startRef.current = Date.now()
    setPhase('streaming')
    setStatusMessage('Starting enhancement…')
    void runStream(payload)
  }

  async function handleExport(): Promise<void> {
    try {
      await document.fonts.ready
    } catch {
      // Fonts may fail to resolve — print anyway with whatever is loaded.
    }
    window.print()
  }

  const checklistStages: ChecklistStage[] = STAGE_ORDER.map((id) => ({
    id,
    label: STAGE_LABELS[id],
    status: stages[id],
  }))

  const hasResults =
    content.trim().length > 0 || gapData !== null || recData !== null || coverage !== null

  return (
    <div className="mx-auto max-w-5xl">
      <div className="screen-only">
        <form
          onSubmit={handleSubmit}
          noValidate
          className="card-enter mx-auto mb-8 max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8"
        >
          <div className="space-y-5">
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
                aria-invalid={Boolean(errors.articleUrl)}
                className={`${inputBase} ${errors.articleUrl ? 'border-rose-300' : 'border-slate-200'}`}
              />
              {errors.articleUrl ? (
                <p className="mt-1 text-xs text-rose-600">{errors.articleUrl}</p>
              ) : null}
            </div>

            <div>
              <label htmlFor="article-text" className="mb-1.5 block text-sm font-medium text-ink">
                Article text{' '}
                <span className="text-xs font-normal text-slate-400">
                  (optional — leave blank to read from the URL)
                </span>
              </label>
              <textarea
                id="article-text"
                rows={6}
                value={articleText}
                onChange={(event) => setArticleText(event.target.value)}
                placeholder="Paste the article body here to enhance it directly…"
                disabled={phase === 'streaming'}
                className={`${inputBase} resize-y border-slate-200`}
              />
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
                aria-invalid={Boolean(errors.contentType)}
                className={`${inputBase} ${errors.contentType ? 'border-rose-300' : 'border-slate-200'}`}
              >
                <option value="">Select a type…</option>
                {CONTENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              {errors.contentType ? (
                <p className="mt-1 text-xs text-rose-600">{errors.contentType}</p>
              ) : null}
            </div>

            {contentType === 'Other' && (
              <div>
                <label htmlFor="other-type" className="mb-1.5 block text-sm font-medium text-ink">
                  Describe the content type <span className="text-rose-500">*</span>
                </label>
                <input
                  id="other-type"
                  type="text"
                  value={otherType}
                  onChange={(event) => setOtherType(event.target.value)}
                  placeholder="e.g. Case study"
                  disabled={phase === 'streaming'}
                  aria-invalid={Boolean(errors.otherType)}
                  className={`${inputBase} ${errors.otherType ? 'border-rose-300' : 'border-slate-200'}`}
                />
                {errors.otherType ? (
                  <p className="mt-1 text-xs text-rose-600">{errors.otherType}</p>
                ) : null}
              </div>
            )}

            <button
              type="submit"
              disabled={phase === 'streaming'}
              className="inline-flex w-full items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-deep focus:outline-none focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {phase === 'streaming' ? 'Enhancing…' : 'Enhance article'}
            </button>
          </div>
        </form>

        {phase === 'streaming' && (
          <div className="mb-4 flex justify-center">
            <StatusChip message={statusMessage || 'Working on it…'} elapsedSeconds={elapsed} />
          </div>
        )}

        {(phase === 'streaming' || phase === 'done') && (
          <div className="mb-4">
            <ProgressChecklist stages={checklistStages} />
          </div>
        )}

        {phase === 'error' && (
          <div className="mx-auto mb-6 max-w-2xl">
            <ErrorCard message={errorMessage || 'Something went wrong.'} onRetry={handleRetry} />
          </div>
        )}

        {phase === 'done' && hasResults && (
          <div className="mb-4 flex justify-end">
            <button
              type="button"
              onClick={() => void handleExport()}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-ink-soft transition hover:border-indigo-200 hover:text-accent-deep focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
            >
              Export as PDF
            </button>
          </div>
        )}

        {(phase === 'streaming' || phase === 'done') && (
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
          />
        )}
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
