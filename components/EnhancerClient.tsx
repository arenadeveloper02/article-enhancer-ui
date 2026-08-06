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

  function setSection(panel: PanelKey, status: SectionStatus): void {
    setSections((prev) => (prev[panel] === status ? prev : { ...prev, [panel]: status }))
  }

  function applyAccumulated(panel: PanelKey): void {
    const accumulated = targetAccumRef.current[panel]
    if (!accumulated.trim()) return
    const liveStatus: SectionStatus = doneRef.current ? 'done' : 'streaming'
    if (panel === 'article') {
      const text = articleFromAccumulated(accumulated)
      if (text.trim()) {
        dataPresentRef.current.article = true
        setContent(text)
        setSection('article', liveStatus)
      }
      return
    }
    if (panel === 'gapanalysis') {
      const data = normalizeGapAnalysis(accumulated)
      if (!isGapEmpty(data) && (!gapRef.current || gapTotal(data) >= gapTotal(gapRef.current))) {
        gapRef.current = data
        dataPresentRef.current.gapanalysis = true
        setGapData(data)
        setSection('gapanalysis', liveStatus)
      }
      return
    }
    if (panel === 'recommendations') {
      const data = normalizeRecommendations(accumulated)
      if (
        data.recommendations.length > 0 &&
        (!recRef.current || data.recommendations.length >= recRef.current.recommendations.length)
      ) {
        recRef.current = data
        dataPresentRef.current.recommendations = true
        setRecData(data)
        setSection('recommendations', liveStatus)
      }
      return
    }
    const data = normalizeCoverage(accumulated)
    if (!isCovEmpty(data)) {
      covRef.current = data
      dataPresentRef.current.coverage = true
      setCoverage(data)
      setSection('coverage', liveStatus)
    }
  }

  function applyMergedOutputs(): void {
    const merged = finalOutputRef.current
    if (!merged) return
    const liveStatus: SectionStatus = doneRef.current ? 'done' : 'streaming'

    const articleValue = findMergedValue(merged, [
      'enhancedarticlewriter.content',
      'enhanced_article',
      'content',
      'article',
    ])
    const text = articleTextFrom(parseIfJsonLike(articleValue))
    if (text.trim()) {
      dataPresentRef.current.article = true
      setContent((prev) => (text.length >= prev.length ? text : prev))
      setSection('article', liveStatus)
    }

    const gap = normalizeGapAnalysis(merged)
    if (!isGapEmpty(gap) && (!gapRef.current || gapTotal(gap) >= gapTotal(gapRef.current))) {
      gapRef.current = gap
      dataPresentRef.current.gapanalysis = true
      setGapData(gap)
      setSection('gapanalysis', liveStatus)
    }

    const recs = normalizeRecommendations(merged)
    if (
      recs.recommendations.length > 0 &&
      (!recRef.current || recs.recommendations.length >= recRef.current.recommendations.length)
    ) {
      recRef.current = recs
      dataPresentRef.current.recommendations = true
      setRecData(recs)
      setSection('recommendations', liveStatus)
    }

    const cov = normalizeCoverage(merged)
    if (!isCovEmpty(cov)) {
      covRef.current = cov
      dataPresentRef.current.coverage = true
      setCoverage(cov)
      setSection('coverage', liveStatus)
    }
  }

  function salvageMissingPanels(): void {
    const raw = rawTranscriptRef.current
    if (!raw) return
    if (!dataPresentRef.current.gapanalysis) {
      const gap = normalizeGapAnalysis(raw)
      if (!isGapEmpty(gap)) {
        gapRef.current = gap
        dataPresentRef.current.gapanalysis = true
        setGapData(gap)
      }
    }
    if (!dataPresentRef.current.recommendations) {
      const recs = normalizeRecommendations(raw)
      if (recs.recommendations.length > 0) {
        recRef.current = recs
        dataPresentRef.current.recommendations = true
        setRecData(recs)
      }
    }
    if (!dataPresentRef.current.coverage) {
      const cov = normalizeCoverage(raw)
      if (!isCovEmpty(cov)) {
        covRef.current = cov
        dataPresentRef.current.coverage = true
        setCoverage(cov)
      }
    }
    if (!dataPresentRef.current.article) {
      const value = extractKeyValue(raw, 'content')
      const text = articleTextFrom(value)
      if (text.trim()) {
        dataPresentRef.current.article = true
        setContent(text)
      }
    }
  }

  function finalizeRun(): void {
    if (doneRef.current) return
    doneRef.current = true
    applyMergedOutputs()
    salvageMissingPanels()
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

  function processEventText(raw: string): void {
    rawTranscriptRef.current += raw + '\n'
    const trimmed = raw.trim()
    if (!trimmed) return
    if (trimmed === '[DONE]') {
      finalizeRun()
      return
    }

    let parsed: unknown = null
    try {
      parsed = JSON.parse(trimmed) as unknown
    } catch {
      parsed = extractBalancedJson(trimmed)
    }

    const rec = asRecord(parsed)
    if (!rec) {
      // Loose text payload - accumulate and route by content classification.
      if (!isHeartbeatMessage(trimmed)) {
        looseTextRef.current += trimmed + '\n'
        const target = classifyUnknownPayload(looseTextRef.current)
        if (target) {
          targetAccumRef.current[target] = looseTextRef.current
          markStageActive(STAGE_FOR_PANEL[target])
          applyAccumulated(target)
        }
      } else {
        setStatusMessage(trimmed)
      }
      return
    }

    // Status / heartbeat messages update the chip without touching panels.
    const message = firstStringOf(rec, ['message', 'status'])
    if (message && isHeartbeatMessage(message)) {
      setStatusMessage(message)
    }

    const blockId = firstStringOf(rec, ['blockId', 'blockid', 'block_id', 'blockName', 'blockname'])
    const chunk = chunkTextOf(rec)

    if (blockId && chunk) {
      const key = blockId.toLowerCase()
      blockAccumRef.current[key] = (blockAccumRef.current[key] ?? '') + chunk
      let target: BlockTarget | null = blockTargetRef.current[key] ?? resolveBlockTarget(blockId)
      if (!target) {
        target = classifyUnknownPayload(blockAccumRef.current[key])
      }
      if (target) {
        blockTargetRef.current[key] = target
        if (isPanelKey(target)) {
          targetAccumRef.current[target] = blockAccumRef.current[key]
          markStageActive(STAGE_FOR_PANEL[target])
          applyAccumulated(target)
        } else {
          setStatusMessage(statusLabelFor(target))
        }
      }
    } else if (chunk && !isHeartbeatMessage(chunk)) {
      looseTextRef.current += chunk
      const target = classifyUnknownPayload(looseTextRef.current)
      if (target) {
        targetAccumRef.current[target] = looseTextRef.current
        markStageActive(STAGE_FOR_PANEL[target])
        applyAccumulated(target)
      }
    }

    // Merge structured outputs from EVERY event and apply immediately.
    const merged = finalOutputRef.current ?? {}
    collectStructured(rec, merged, 0)
    finalOutputRef.current = merged
    applyMergedOutputs()

    const eventName = firstStringOf(rec, ['event', 'type']).toLowerCase()
    if (eventName === 'done' || eventName === 'complete' || rec['done'] === true) {
      finalizeRun()
    }
  }

  function handleStreamLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(':')) return
    const payload = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed
    if (!payload) return
    processEventText(payload)
  }

  function validate(): boolean {
    const next: EnhanceFormErrors = {}
    const url = articleUrl.trim()
    const text = articleText.trim()
    if (!url && !text) {
      next.articleUrl = 'Provide an article URL or paste the article text below.'
    } else if (url && !/^https?:\/\/\S+/i.test(url)) {
      next.articleUrl = 'Enter a valid http(s) URL.'
    }
    if (!contentType) {
      next.contentType = 'Select a content type.'
    } else if (contentType === 'Other' && !otherType.trim()) {
      next.otherType = 'Describe the content type.'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function runEnhancement(payload: EnhancePayload): Promise<void> {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    resetRun()
    setSubmittedUrl(payload.article_url)
    startRef.current = Date.now()
    setPhase('streaming')
    setStatusMessage('Starting enhancement…')

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
        // Non-streamed fallback: merge the whole JSON body at once.
        const data: unknown = await res.json()
        try {
          rawTranscriptRef.current += JSON.stringify(data) + '\n'
        } catch {
          // Ignore serialization issues - salvage still has the merged map.
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

      const reader = res.body?.getReader()
      if (!reader) {
        throw new Error('The enhancement service returned an empty response.')
      }
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let newlineIndex = buffer.indexOf('\n')
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex)
          buffer = buffer.slice(newlineIndex + 1)
          handleStreamLine(line)
          newlineIndex = buffer.indexOf('\n')
        }
      }
      if (buffer.trim()) handleStreamLine(buffer)
      finalizeRun()
    } catch (err) {
      if (controller.signal.aborted) return
      setPhase('error')
      setErrorMessage(
        err instanceof Error ? err.message : 'Something went wrong during enhancement. Please try again.',
      )
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
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
    await runEnhancement(payload)
  }

  function handleRetry(): void {
    const payload = lastPayloadRef.current
    if (payload) {
      void runEnhancement(payload)
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

  const checklistStages: ChecklistStage[] = STAGE_ORDER.map((id) => ({
    id,
    label: STAGE_LABELS[id],
    status: stages[id],
  }))

  const showResults = phase === 'streaming' || phase === 'done'

  return (
    <div>
      <div className="screen-only">
        <form
          onSubmit={(event) => {
            void handleSubmit(event)
          }}
          noValidate
          className="card-enter mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8"
        >
          <div className="grid gap-5">
            <div>
              <label htmlFor="article-url" className="mb-1.5 block text-sm font-medium text-ink">
                Article URL
              </label>
              <input
                id="article-url"
                type="url"
                inputMode="url"
                value={articleUrl}
                onChange={(event) => setArticleUrl(event.target.value)}
                placeholder="https://example.com/my-article"
                disabled={phase === 'streaming'}
                aria-invalid={Boolean(errors.articleUrl)}
                className={`${inputBase} ${errors.articleUrl ? 'border-rose-300' : 'border-slate-200'}`}
              />
              {errors.articleUrl ? (
                <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.articleUrl}</p>
              ) : (
                <p className="mt-1.5 text-xs text-slate-400">
                  Paste the published URL, or paste the article text below instead.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="article-text" className="mb-1.5 block text-sm font-medium text-ink">
                Article text{' '}
                <span className="font-normal text-slate-400">(optional when a URL is provided)</span>
              </label>
              <textarea
                id="article-text"
                rows={6}
                value={articleText}
                onChange={(event) => setArticleText(event.target.value)}
                placeholder="Paste the full article text here…"
                disabled={phase === 'streaming'}
                aria-invalid={Boolean(errors.articleText)}
                className={`${inputBase} resize-y ${errors.articleText ? 'border-rose-300' : 'border-slate-200'}`}
              />
              {errors.articleText && (
                <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.articleText}</p>
              )}
            </div>

            <div>
              <span className="mb-1.5 block text-sm font-medium text-ink">Content type</span>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Content type">
                {CONTENT_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setContentType(type)}
                    aria-pressed={contentType === type}
                    disabled={phase === 'streaming'}
                    className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 ${
                      contentType === type
                        ? 'border-accent bg-indigo-50 text-accent-deep'
                        : 'border-slate-200 bg-white text-ink-soft hover:border-indigo-200 hover:text-ink'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
              {errors.contentType && (
                <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.contentType}</p>
              )}
              {contentType === 'Other' && (
                <div className="mt-3">
                  <label htmlFor="other-type" className="mb-1.5 block text-sm font-medium text-ink">
                    Describe the content type
                  </label>
                  <input
                    id="other-type"
                    type="text"
                    value={otherType}
                    onChange={(event) => setOtherType(event.target.value)}
                    placeholder="e.g. Comparison review"
                    disabled={phase === 'streaming'}
                    aria-invalid={Boolean(errors.otherType)}
                    className={`${inputBase} ${errors.otherType ? 'border-rose-300' : 'border-slate-200'}`}
                  />
                  {errors.otherType && (
                    <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.otherType}</p>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={phase === 'streaming'}
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-deep focus:outline-none focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {phase === 'streaming' && (
                  <span
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none"
                  />
                )}
                {phase === 'streaming' ? 'Enhancing…' : 'Enhance article'}
              </button>
              {phase === 'streaming' && (
                <StatusChip
                  message={statusMessage || 'Enhancing your article…'}
                  elapsedSeconds={elapsed}
                />
              )}
            </div>
          </div>
        </form>

        {showResults && (
          <div className="mb-6">
            <ProgressChecklist stages={checklistStages} />
          </div>
        )}

        {phase === 'error' && (
          <div className="mb-6">
            <ErrorCard message={errorMessage} onRetry={handleRetry} />
          </div>
        )}

        {showResults && (
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
        )}
      </div>

      {phase === 'done' && (
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
      )}
    </div>
  )
}
