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
   * Applies the merged structured outputs (finalOutputRef) to any panel that
   * has not yet received routable data. Safe to call repeatedly.
   */
  function applyMergedOutputs(): void {
    const merged = finalOutputRef.current
    if (!merged) return

    if (!dataPresentRef.current.article) {
      const articleValue = findMergedValue(merged, [
        'enhancedarticlewriter.content',
        'enhanced_article',
        'enhancedarticlewriter',
        'content',
        'article',
      ])
      const text = articleTextFrom(articleValue)
      if (text.trim()) {
        dataPresentRef.current.article = true
        setContent(text)
        markPanelStreaming('article')
      }
    }

    if (!dataPresentRef.current.gapanalysis) {
      const strengths = findMergedValue(merged, ['gapanalysis.competitor_strengths', 'competitor_strengths'])
      const gaps = findMergedValue(merged, ['gapanalysis.coverage_gaps', 'coverage_gaps'])
      const under = findMergedValue(merged, [
        'gapanalysis.underdeveloped_sections',
        'underdeveloped_sections',
      ])
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
          markPanelStreaming('gapanalysis')
        }
      }
    }

    if (!dataPresentRef.current.recommendations) {
      const recs = findMergedValue(merged, ['recommendations.recommendations', 'recommendations'])
      const citations = findMergedValue(merged, [
        'recommendations.citation_opportunities',
        'citation_opportunities',
      ])
      const faqs = findMergedValue(merged, ['recommendations.faq_suggestions', 'faq_suggestions'])
      if (recs !== undefined || citations !== undefined || faqs !== undefined) {
        const data = normalizeRecommendations({
          recommendations: recs,
          citation_opportunities: citations,
          faq_suggestions: faqs,
        })
        if (data.recommendations.length > 0) {
          recRef.current = data
          dataPresentRef.current.recommendations = true
          setRecData(data)
          markPanelStreaming('recommendations')
        }
      }
    }

    if (!dataPresentRef.current.coverage) {
      const score = findMergedValue(merged, ['coverageverifier.overall_score', 'overall_score'])
      const passed = findMergedValue(merged, ['coverageverifier.passed', 'passed'])
      const summary = findMergedValue(merged, ['coverageverifier.summary', 'summary'])
      const criteria = findMergedValue(merged, ['coverageverifier.criteria', 'criteria'])
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
          markPanelStreaming('coverage')
        }
      }
    }
  }

  /** Salvages a panel's data from the raw stream transcript at run end. */
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
      const data = normalizeGapAnalysis({
        competitor_strengths: extractKeyValue(raw, 'competitor_strengths'),
        coverage_gaps: extractKeyValue(raw, 'coverage_gaps'),
        underdeveloped_sections: extractKeyValue(raw, 'underdeveloped_sections'),
      })
      if (!isGapEmpty(data)) {
        gapRef.current = data
        dataPresentRef.current.gapanalysis = true
        setGapData(data)
      }
      return
    }
    if (panel === 'recommendations') {
      const data = normalizeRecommendations({
        recommendations: extractKeyValue(raw, 'recommendations'),
        citation_opportunities: extractKeyValue(raw, 'citation_opportunities'),
        faq_suggestions: extractKeyValue(raw, 'faq_suggestions'),
      })
      if (data.recommendations.length > 0) {
        recRef.current = data
        dataPresentRef.current.recommendations = true
        setRecData(data)
      }
      return
    }
    const data = normalizeCoverage({
      overall_score: extractKeyValue(raw, 'overall_score'),
      passed: extractKeyValue(raw, 'passed'),
      summary: extractKeyValue(raw, 'summary'),
      criteria: extractKeyValue(raw, 'criteria'),
    })
    if (!isCovEmpty(data)) {
      covRef.current = data
      dataPresentRef.current.coverage = true
      setCoverage(data)
    }
  }

  /** Handles a single decoded stream payload (one SSE data line). */
  function handleEventPayload(payloadText: string): void {
    rawTranscriptRef.current += `${payloadText}\n`
    const parsed = extractBalancedJson(payloadText)
    const rec = asRecord(parsed)

    if (!rec) {
      // Plain text chunk with no JSON envelope: classify semantically.
      if (payloadText.trim() && !isHeartbeatMessage(payloadText)) {
        looseTextRef.current += payloadText
        const classified = classifyUnknownPayload(looseTextRef.current)
        if (classified) {
          targetAccumRef.current[classified] += payloadText
          markPanelStreaming(classified)
          renormalizePanel(classified)
        }
      }
      return
    }

    const blockId = firstStringOf(rec, ['blockId', 'block_id', 'blockid', 'blockName', 'blockname'])
    const chunk = chunkTextOf(rec)
    const statusText = firstStringOf(rec, ['status', 'message'])

    let target: BlockTarget | null = null
    if (blockId) {
      target = blockTargetRef.current[blockId] ?? resolveBlockTarget(blockId)
      if (target) blockTargetRef.current[blockId] = target
    }

    if (target === 'status-theme' || target === 'status-research') {
      if (!doneRef.current) setStatusMessage(statusLabelFor(target))
    } else if (statusText && !chunk && !doneRef.current) {
      setStatusMessage(statusText)
    }

    let panel: PanelKey | null =
      target && target !== 'status-theme' && target !== 'status-research' ? target : null

    if (chunk) {
      if (blockId) {
        const prevAccum = blockAccumRef.current[blockId] ?? ''
        blockAccumRef.current[blockId] = prevAccum + chunk
        if (!panel) {
          const classified = classifyUnknownPayload(blockAccumRef.current[blockId])
          if (classified) {
            blockTargetRef.current[blockId] = classified
            panel = classified
            // First resolution for this block: pour its whole accumulation in.
            targetAccumRef.current[classified] += blockAccumRef.current[blockId]
          }
        } else {
          targetAccumRef.current[panel] += chunk
        }
        if (panel) {
          markPanelStreaming(panel)
          renormalizePanel(panel)
        }
      } else if (!isHeartbeatMessage(chunk)) {
        looseTextRef.current += chunk
        const classified = classifyUnknownPayload(looseTextRef.current)
        if (classified) {
          targetAccumRef.current[classified] += chunk
          markPanelStreaming(classified)
          renormalizePanel(classified)
        }
      }
    }

    // Merge any structured outputs carried on this event and apply them.
    const merged = finalOutputRef.current ?? {}
    collectStructured(rec, merged, 0)
    finalOutputRef.current = merged
    applyMergedOutputs()
  }

  /** Finalizes the run: last salvage pass, then settle every stage/section. */
  function finalizeRun(): void {
    doneRef.current = true
    applyMergedOutputs()
    for (const panel of ALL_PANELS) {
      if (!dataPresentRef.current[panel]) {
        renormalizePanel(panel)
      }
      if (!dataPresentRef.current[panel]) {
        salvagePanel(panel)
      }
    }
    setStages(() => {
      const next = { ...INITIAL_STAGES }
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

  async function runEnhancement(payload: EnhancePayload): Promise<void> {
    resetRun()
    lastPayloadRef.current = payload
    setSubmittedUrl(payload.article_url)
    setPhase('streaming')
    setStatusMessage('Starting enhancement…')
    startRef.current = Date.now()

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

      const responseContentType = res.headers.get('content-type') ?? ''
      if (responseContentType.includes('application/json')) {
        // Non-streamed fallback: treat the whole JSON body as one final event.
        const data: unknown = await res.json()
        const rec = asRecord(data)
        if (rec) {
          rawTranscriptRef.current += JSON.stringify(rec)
          const merged = finalOutputRef.current ?? {}
          collectStructured(rec, merged, 0)
          finalOutputRef.current = merged
        } else if (typeof data === 'string') {
          rawTranscriptRef.current += data
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
        let newlineIndex = buffer.indexOf('\n')
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).replace(/\r$/, '')
          buffer = buffer.slice(newlineIndex + 1)
          newlineIndex = buffer.indexOf('\n')
          const data = line.startsWith('data:') ? line.slice(5).trim() : line.trim()
          if (!data || data === '[DONE]') continue
          handleEventPayload(data)
        }
      }
      const tailLine = buffer.trim()
      if (tailLine && tailLine !== '[DONE]') {
        const data = tailLine.startsWith('data:') ? tailLine.slice(5).trim() : tailLine
        if (data && data !== '[DONE]') handleEventPayload(data)
      }
      finalizeRun()
    } catch (err) {
      if (controller.signal.aborted) return
      setPhase('error')
      setErrorMessage(err instanceof Error ? err.message : 'Enhancement failed. Please try again.')
    }
  }

  function validate(): EnhanceFormErrors {
    const next: EnhanceFormErrors = {}
    const url = articleUrl.trim()
    if (!url) {
      next.articleUrl = 'Article URL is required.'
    } else {
      try {
        const parsedUrl = new URL(url)
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          next.articleUrl = 'Enter a valid http(s) URL.'
        }
      } catch {
        next.articleUrl = 'Enter a valid URL (including https://).'
      }
    }
    if (!contentType) next.contentType = 'Choose a content type.'
    if (contentType === 'Other' && !otherType.trim()) next.otherType = 'Describe the content type.'
    return next
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const nextErrors = validate()
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    const payload: EnhancePayload = {
      article_url: articleUrl.trim(),
      article_text: articleText.trim(),
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
    <div>
      <div className="screen-only">
        {/* URL card — aligned to the shared content width. 20px gap down to
            the workflow (mt-5), 24px from workflow to results (mt-6). */}
        <form
          onSubmit={handleSubmit}
          noValidate
          className="card-enter rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8"
        >
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-5">
              <div>
                <label htmlFor="article-url" className="mb-1.5 block text-sm font-semibold text-ink">
                  Article URL <span className="text-rose-500">*</span>
                </label>
                <input
                  id="article-url"
                  type="url"
                  value={articleUrl}
                  onChange={(event) => setArticleUrl(event.target.value)}
                  placeholder="https://example.com/blog/your-article"
                  disabled={phase === 'streaming'}
                  aria-invalid={errors.articleUrl ? true : undefined}
                  className={`${inputBase} ${errors.articleUrl ? 'border-rose-300' : 'border-slate-200'}`}
                />
                {errors.articleUrl ? (
                  <p className="mt-1 text-xs font-medium text-rose-600">{errors.articleUrl}</p>
                ) : null}
              </div>
              <div>
                <label htmlFor="article-text" className="mb-1.5 block text-sm font-semibold text-ink">
                  Article text{' '}
                  <span className="font-normal text-slate-400">(optional — the agent can read the URL)</span>
                </label>
                <textarea
                  id="article-text"
                  rows={4}
                  value={articleText}
                  onChange={(event) => setArticleText(event.target.value)}
                  placeholder="Paste the article body here to skip fetching…"
                  disabled={phase === 'streaming'}
                  className={`${inputBase} resize-y border-slate-200`}
                />
              </div>
            </div>
            <div className="space-y-5">
              <div>
                <label htmlFor="content-type" className="mb-1.5 block text-sm font-semibold text-ink">
                  Content type <span className="text-rose-500">*</span>
                </label>
                <select
                  id="content-type"
                  value={contentType}
                  onChange={(event) => setContentType(event.target.value)}
                  disabled={phase === 'streaming'}
                  aria-invalid={errors.contentType ? true : undefined}
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
                  <p className="mt-1 text-xs font-medium text-rose-600">{errors.contentType}</p>
                ) : null}
              </div>
              {contentType === 'Other' ? (
                <div>
                  <label htmlFor="other-type" className="mb-1.5 block text-sm font-semibold text-ink">
                    Describe the content type <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="other-type"
                    type="text"
                    value={otherType}
                    onChange={(event) => setOtherType(event.target.value)}
                    placeholder="e.g. Comparison review"
                    disabled={phase === 'streaming'}
                    aria-invalid={errors.otherType ? true : undefined}
                    className={`${inputBase} ${errors.otherType ? 'border-rose-300' : 'border-slate-200'}`}
                  />
                  {errors.otherType ? (
                    <p className="mt-1 text-xs font-medium text-rose-600">{errors.otherType}</p>
                  ) : null}
                </div>
              ) : null}
              <button
                type="submit"
                disabled={phase === 'streaming'}
                className="w-full rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-deep focus:outline-none focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {phase === 'streaming' ? 'Enhancing…' : 'Enhance article'}
              </button>
            </div>
          </div>
          {phase === 'streaming' ? (
            <div className="mt-5">
              <StatusChip message={statusMessage || 'Working on it…'} elapsedSeconds={elapsed} />
            </div>
          ) : null}
        </form>

        {phase === 'error' ? (
          <div className="mt-6">
            <ErrorCard message={errorMessage} onRetry={handleRetry} />
          </div>
        ) : null}

        {showResults ? (
          <>
            <div className="mt-5">
              <ProgressChecklist stages={checklistStages} />
            </div>
            <div className="mt-6">
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
          </>
        ) : null}
      </div>

      {/* Print-only mirror — powers Export as PDF via window.print(). */}
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
