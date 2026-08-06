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

  function routeText(target: PanelKey, accumulated: string): void {
    targetAccumRef.current[target] = accumulated
    markStageActive(STAGE_FOR_PANEL[target])
    setSection(target, 'streaming')
    if (target === 'article') {
      const text = articleFromAccumulated(accumulated)
      if (text.trim()) {
        dataPresentRef.current.article = true
        setContent(text)
      }
      return
    }
    if (target === 'gapanalysis') {
      const g = normalizeGapAnalysis(accumulated)
      if (!isGapEmpty(g) && gapTotal(g) > 0) {
        dataPresentRef.current.gapanalysis = true
        gapRef.current = g
        setGapData(g)
      }
      return
    }
    if (target === 'recommendations') {
      const r = normalizeRecommendations(accumulated)
      if (r.recommendations.length > 0) {
        dataPresentRef.current.recommendations = true
        recRef.current = r
        setRecData(r)
      }
      return
    }
    const c = normalizeCoverage(accumulated)
    if (!isCovEmpty(c)) {
      dataPresentRef.current.coverage = true
      covRef.current = c
      setCoverage(c)
    }
  }

  function applyMergedOutputs(merged: Record<string, unknown>): void {
    // Article
    const articleValue = findMergedValue(merged, [
      'enhancedarticlewriter.content',
      'enhanced_article',
      'content',
      'article',
    ])
    const articleString = articleTextFrom(parseIfJsonLike(articleValue))
    if (articleString.trim()) {
      dataPresentRef.current.article = true
      markStageActive(STAGE_FOR_PANEL.article)
      setSection('article', 'streaming')
      setContent(articleString)
    }

    // Gap analysis
    const strengths = findMergedValue(merged, ['competitor_strengths', 'gapanalysis.competitor_strengths'])
    const gaps = findMergedValue(merged, ['coverage_gaps', 'gapanalysis.coverage_gaps'])
    const under = findMergedValue(merged, [
      'underdeveloped_sections',
      'gapanalysis.underdeveloped_sections',
    ])
    if (strengths !== undefined || gaps !== undefined || under !== undefined) {
      const g = normalizeGapAnalysis({
        competitor_strengths: strengths,
        coverage_gaps: gaps,
        underdeveloped_sections: under,
      })
      if (!isGapEmpty(g)) {
        dataPresentRef.current.gapanalysis = true
        gapRef.current = g
        markStageActive(STAGE_FOR_PANEL.gapanalysis)
        setSection('gapanalysis', 'streaming')
        setGapData(g)
      }
    }

    // Recommendations
    const recValue = findMergedValue(merged, ['recommendations', 'recommendations.recommendations'])
    const citeValue = findMergedValue(merged, [
      'citation_opportunities',
      'recommendations.citation_opportunities',
    ])
    const faqValue = findMergedValue(merged, ['faq_suggestions', 'recommendations.faq_suggestions'])
    if (recValue !== undefined || citeValue !== undefined || faqValue !== undefined) {
      const r = normalizeRecommendations({
        recommendations: recValue,
        citation_opportunities: citeValue,
        faq_suggestions: faqValue,
      })
      if (r.recommendations.length > 0) {
        dataPresentRef.current.recommendations = true
        recRef.current = r
        markStageActive(STAGE_FOR_PANEL.recommendations)
        setSection('recommendations', 'streaming')
        setRecData(r)
      }
    }

    // Coverage verification
    const score = findMergedValue(merged, ['overall_score', 'coverageverifier.overall_score'])
    const passed = findMergedValue(merged, ['passed', 'coverageverifier.passed'])
    const summary = findMergedValue(merged, ['summary', 'coverageverifier.summary'])
    const criteria = findMergedValue(merged, ['criteria', 'coverageverifier.criteria'])
    if (score !== undefined || passed !== undefined || summary !== undefined || criteria !== undefined) {
      const c = normalizeCoverage({
        overall_score: score,
        passed,
        summary,
        criteria,
      })
      if (!isCovEmpty(c)) {
        dataPresentRef.current.coverage = true
        covRef.current = c
        markStageActive(STAGE_FOR_PANEL.coverage)
        setSection('coverage', 'streaming')
        setCoverage(c)
      }
    }
  }

  function handleEventPayload(payload: string): void {
    const parsed = extractBalancedJson(payload)
    const rec = asRecord(parsed)

    if (!rec) {
      if (Array.isArray(parsed)) {
        // Keyless JSON array payload - classify it and append to that panel's
        // accumulated text so positional fallbacks in the normalizers apply.
        const cls = classifyUnknownPayload(payload)
        if (cls && cls !== 'article') {
          const next = `${targetAccumRef.current[cls]}\n${payload}`.trim()
          routeText(cls, next)
        }
        return
      }
      // Loose prose - accumulate and classify.
      looseTextRef.current += payload
      if (isHeartbeatMessage(payload)) {
        setStatusMessage(payload.trim())
        return
      }
      const cls = classifyUnknownPayload(looseTextRef.current)
      if (cls) routeText(cls, looseTextRef.current)
      return
    }

    // Heartbeat / status messages.
    const message = firstStringOf(rec, ['message', 'status', 'event'])
    if (message && isHeartbeatMessage(message)) {
      setStatusMessage(message)
    }

    const blockId = firstStringOf(rec, ['blockId', 'block_id', 'blockid', 'blockName', 'blockname'])
    const chunk = chunkTextOf(rec)

    if (blockId) {
      const known = blockTargetRef.current[blockId] ?? resolveBlockTarget(blockId)
      if (known) {
        blockTargetRef.current[blockId] = known
        if (!isPanelKey(known)) {
          setStatusMessage(statusLabelFor(known))
        } else if (chunk) {
          blockAccumRef.current[blockId] = (blockAccumRef.current[blockId] ?? '') + chunk
          routeText(known, blockAccumRef.current[blockId])
        }
      } else if (chunk) {
        blockAccumRef.current[blockId] = (blockAccumRef.current[blockId] ?? '') + chunk
        const cls = classifyUnknownPayload(blockAccumRef.current[blockId])
        if (cls) {
          blockTargetRef.current[blockId] = cls
          routeText(cls, blockAccumRef.current[blockId])
        }
      }
    } else if (chunk && !isHeartbeatMessage(chunk)) {
      looseTextRef.current += chunk
      const cls = classifyUnknownPayload(looseTextRef.current)
      if (cls) routeText(cls, looseTextRef.current)
    }

    // Merge any structured outputs the event carries and apply them.
    const merged = finalOutputRef.current ?? {}
    collectStructured(rec, merged, 0)
    finalOutputRef.current = merged
    applyMergedOutputs(merged)
  }

  function finishRun(): void {
    // Salvage pass: mine the raw transcript for panels that never received
    // routable data during the stream.
    const transcript = rawTranscriptRef.current
    if (transcript) {
      for (const panel of ALL_PANELS) {
        if (dataPresentRef.current[panel]) continue
        if (panel === 'article') {
          const text = articleTextFrom(extractKeyValue(transcript, 'content'))
          if (text.trim()) {
            dataPresentRef.current.article = true
            setContent(text)
          }
        } else if (panel === 'gapanalysis') {
          const g = normalizeGapAnalysis({
            competitor_strengths: extractKeyValue(transcript, 'competitor_strengths'),
            coverage_gaps: extractKeyValue(transcript, 'coverage_gaps'),
            underdeveloped_sections: extractKeyValue(transcript, 'underdeveloped_sections'),
          })
          if (!isGapEmpty(g)) {
            dataPresentRef.current.gapanalysis = true
            gapRef.current = g
            setGapData(g)
          }
        } else if (panel === 'recommendations') {
          const r = normalizeRecommendations({
            recommendations: extractKeyValue(transcript, 'recommendations'),
            citation_opportunities: extractKeyValue(transcript, 'citation_opportunities'),
            faq_suggestions: extractKeyValue(transcript, 'faq_suggestions'),
          })
          if (r.recommendations.length > 0) {
            dataPresentRef.current.recommendations = true
            recRef.current = r
            setRecData(r)
          }
        } else {
          const c = normalizeCoverage({
            overall_score: extractKeyValue(transcript, 'overall_score'),
            passed: extractKeyValue(transcript, 'passed'),
            summary: extractKeyValue(transcript, 'summary'),
            criteria: extractKeyValue(transcript, 'criteria'),
          })
          if (!isCovEmpty(c)) {
            dataPresentRef.current.coverage = true
            covRef.current = c
            setCoverage(c)
          }
        }
      }
    }

    setStages({
      gapanalysis: 'done',
      recommendations: 'done',
      enhancedarticlewriter: 'done',
      coverageverifier: 'done',
    })
    setSections({
      article: dataPresentRef.current.article ? 'done' : 'empty',
      gapanalysis: dataPresentRef.current.gapanalysis ? 'done' : 'empty',
      recommendations: dataPresentRef.current.recommendations ? 'done' : 'empty',
      coverage: dataPresentRef.current.coverage ? 'done' : 'empty',
    })
    setStatusMessage('')
    setPhase('done')
  }

  function processLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    const payload = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed
    if (!payload) return
    if (payload === '[DONE]') {
      doneRef.current = true
      return
    }
    rawTranscriptRef.current += `${payload}\n`
    handleEventPayload(payload)
  }

  async function runEnhancement(payload: EnhancePayload): Promise<void> {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    resetRun()
    lastPayloadRef.current = payload
    setSubmittedUrl(payload.article_url)
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
        throw new Error(body?.error || `Enhancement request failed (${res.status}).`)
      }

      const contentTypeHeader = res.headers.get('content-type') ?? ''
      if (contentTypeHeader.includes('application/json')) {
        // Non-streamed JSON fallback - apply the whole payload at once.
        const data: unknown = await res.json()
        rawTranscriptRef.current = JSON.stringify(data)
        const rec = asRecord(data)
        if (rec) {
          const merged = finalOutputRef.current ?? {}
          collectStructured(rec, merged, 0)
          finalOutputRef.current = merged
          applyMergedOutputs(merged)
        }
        finishRun()
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
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) processLine(line)
        if (doneRef.current) break
      }
      if (buffer.trim()) processLine(buffer)
      finishRun()
    } catch (err) {
      if (controller.signal.aborted) return
      setPhase('error')
      setErrorMessage(err instanceof Error ? err.message : 'Enhancement failed. Please try again.')
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const nextErrors: EnhanceFormErrors = {}
    const url = articleUrl.trim()
    const text = articleText.trim()
    if (!url && !text) {
      nextErrors.articleUrl = 'Provide an article URL or paste the article text below.'
    } else if (url && !/^https?:\/\//i.test(url)) {
      nextErrors.articleUrl = 'Enter a valid URL starting with http:// or https://.'
    }
    if (!contentType) {
      nextErrors.contentType = 'Choose a content type.'
    }
    if (contentType === 'Other' && !otherType.trim()) {
      nextErrors.otherType = 'Describe the content type.'
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    const payload: EnhancePayload = {
      article_url: url,
      article_text: text,
      content_type: contentType === 'Other' ? otherType.trim() : contentType,
    }
    void runEnhancement(payload)
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

  const streaming = phase === 'streaming'
  const showResults = phase === 'streaming' || phase === 'done'

  return (
    <div className="w-full">
      <form
        onSubmit={handleSubmit}
        noValidate
        className="screen-only card-enter mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8"
      >
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <label htmlFor="article-url" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-soft">
              Article URL
            </label>
            <input
              id="article-url"
              type="url"
              value={articleUrl}
              onChange={(e) => setArticleUrl(e.target.value)}
              placeholder="https://example.com/my-article"
              disabled={streaming}
              className={`${inputBase} ${errors.articleUrl ? 'border-rose-300' : 'border-slate-200'}`}
            />
            {errors.articleUrl ? (
              <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.articleUrl}</p>
            ) : (
              <p className="mt-1.5 text-xs text-slate-400">
                Provide a URL, paste the article text below, or both.
              </p>
            )}
          </div>
          <div>
            <label htmlFor="content-type" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-soft">
              Content type
            </label>
            <select
              id="content-type"
              value={contentType}
              onChange={(e) => setContentType(e.target.value)}
              disabled={streaming}
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
            {contentType === 'Other' ? (
              <div className="mt-3">
                <label htmlFor="other-type" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-soft">
                  Describe the content type
                </label>
                <input
                  id="other-type"
                  type="text"
                  value={otherType}
                  onChange={(e) => setOtherType(e.target.value)}
                  placeholder="e.g. Local business listing"
                  disabled={streaming}
                  className={`${inputBase} ${errors.otherType ? 'border-rose-300' : 'border-slate-200'}`}
                />
                {errors.otherType ? (
                  <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.otherType}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-5">
          <label htmlFor="article-text" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-soft">
            Article text (optional when a URL is provided)
          </label>
          <textarea
            id="article-text"
            value={articleText}
            onChange={(e) => setArticleText(e.target.value)}
            placeholder="Paste the article markdown or plain text here…"
            rows={7}
            disabled={streaming}
            className={`${inputBase} resize-y ${errors.articleText ? 'border-rose-300' : 'border-slate-200'}`}
          />
          {errors.articleText ? (
            <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.articleText}</p>
          ) : null}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={streaming}
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-deep focus:outline-none focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
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
          {streaming ? (
            <StatusChip
              message={statusMessage || 'Working on your article…'}
              elapsedSeconds={elapsed}
              phase={phase}
            />
          ) : null}
        </div>
      </form>

      {showResults ? (
        <div className="screen-only mb-6">
          <ProgressChecklist stages={checklistStages} />
        </div>
      ) : null}

      {phase === 'error' ? (
        <div className="screen-only card-enter">
          <ErrorCard message={errorMessage || 'Enhancement failed. Please try again.'} onRetry={handleRetry} />
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

      {/* Print-only mirror powering the Export (PDF) output. */}
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
