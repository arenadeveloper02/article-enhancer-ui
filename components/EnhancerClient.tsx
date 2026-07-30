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
        dataPresentRef.current.gapanalysis = true
        gapRef.current = data
        setGapData(data)
      }
      return
    }
    if (panel === 'recommendations') {
      const data = normalizeRecommendations(text)
      if (data.recommendations.length > 0) {
        dataPresentRef.current.recommendations = true
        recRef.current = data
        setRecData(data)
      }
      return
    }
    const data = normalizeCoverage(text)
    if (!isCovEmpty(data)) {
      dataPresentRef.current.coverage = true
      covRef.current = data
      setCoverage(data)
    }
  }

  /**
   * Applies any usable data found in the merged structured outputs to panels
   * that have not yet received routable stream chunks. Reads BOTH the primary
   * recommendations list and the additional recommendations.citation_opportunities
   * / recommendations.faq_suggestions keys from the workflow response.
   */
  function applyMergedOutputs(): void {
    const merged = finalOutputRef.current
    if (!merged) return
    if (!dataPresentRef.current.article) {
      const value = parseIfJsonLike(
        findMergedValue(merged, ['enhancedarticlewriter.content', 'enhanced_article', 'content', 'article']),
      )
      const article = articleTextFrom(value)
      if (article.trim() && !isHeartbeatMessage(article)) {
        dataPresentRef.current.article = true
        markPanelStreaming('article')
        setContent(article)
      }
    }
    if (!dataPresentRef.current.gapanalysis) {
      const candidate = {
        competitor_strengths: findMergedValue(merged, [
          'gapanalysis.competitor_strengths',
          'competitor_strengths',
        ]),
        coverage_gaps: findMergedValue(merged, ['gapanalysis.coverage_gaps', 'coverage_gaps']),
        underdeveloped_sections: findMergedValue(merged, [
          'gapanalysis.underdeveloped_sections',
          'underdeveloped_sections',
        ]),
      }
      if (
        candidate.competitor_strengths !== undefined ||
        candidate.coverage_gaps !== undefined ||
        candidate.underdeveloped_sections !== undefined
      ) {
        const data = normalizeGapAnalysis(candidate)
        if (!isGapEmpty(data)) {
          dataPresentRef.current.gapanalysis = true
          gapRef.current = data
          markPanelStreaming('gapanalysis')
          setGapData(data)
        }
      }
    }
    if (!dataPresentRef.current.recommendations) {
      const candidate = {
        recommendations: findMergedValue(merged, ['recommendations.recommendations', 'recommendations']),
        citation_opportunities: findMergedValue(merged, [
          'recommendations.citation_opportunities',
          'citation_opportunities',
        ]),
        faq_suggestions: findMergedValue(merged, ['recommendations.faq_suggestions', 'faq_suggestions']),
      }
      if (
        candidate.recommendations !== undefined ||
        candidate.citation_opportunities !== undefined ||
        candidate.faq_suggestions !== undefined
      ) {
        const data = normalizeRecommendations(candidate)
        if (data.recommendations.length > 0) {
          dataPresentRef.current.recommendations = true
          recRef.current = data
          markPanelStreaming('recommendations')
          setRecData(data)
        }
      }
    }
    if (!dataPresentRef.current.coverage) {
      const candidate = {
        overall_score: findMergedValue(merged, ['coverageverifier.overall_score', 'overall_score']),
        passed: findMergedValue(merged, ['coverageverifier.passed', 'passed']),
        summary: findMergedValue(merged, ['coverageverifier.summary', 'summary']),
        criteria: findMergedValue(merged, ['coverageverifier.criteria', 'criteria']),
      }
      if (
        candidate.overall_score !== undefined ||
        candidate.passed !== undefined ||
        candidate.summary !== undefined ||
        candidate.criteria !== undefined
      ) {
        const data = normalizeCoverage(candidate)
        if (!isCovEmpty(data)) {
          dataPresentRef.current.coverage = true
          covRef.current = data
          markPanelStreaming('coverage')
          setCoverage(data)
        }
      }
    }
  }

  function routeChunk(blockId: string, chunk: string): void {
    if (!chunk) return
    blockAccumRef.current[blockId] = (blockAccumRef.current[blockId] ?? '') + chunk
    const known = blockTargetRef.current[blockId] ?? resolveBlockTarget(blockId)
    if (known) {
      blockTargetRef.current[blockId] = known
      if (known === 'status-theme' || known === 'status-research') {
        setStatusMessage(statusLabelFor(known))
        return
      }
      applyPanel(known)
      return
    }
    const classified = classifyUnknownPayload(blockAccumRef.current[blockId])
    if (classified) {
      blockTargetRef.current[blockId] = classified
      applyPanel(classified)
    }
  }

  function routeLooseText(): void {
    const target = classifyUnknownPayload(looseTextRef.current)
    if (!target) return
    blockAccumRef.current['loose'] = looseTextRef.current
    blockTargetRef.current['loose'] = target
    applyPanel(target)
  }

  /**
   * Final salvage pass over the raw transcript: mines panel data straight out
   * of the accumulated stream text for any panel that never received routable
   * chunks. Includes citation_opportunities / faq_suggestions so the
   * Recommendations panel picks them up even from unrouted payloads.
   */
  function salvageFromTranscript(): void {
    const raw = rawTranscriptRef.current
    if (!raw.trim()) return
    if (!dataPresentRef.current.article) {
      const article = articleTextFrom(extractKeyValue(raw, 'content'))
      if (article.trim() && !isHeartbeatMessage(article)) {
        dataPresentRef.current.article = true
        setContent(article)
      }
    }
    if (!dataPresentRef.current.gapanalysis) {
      const strengths = extractKeyValue(raw, 'competitor_strengths')
      const gaps = extractKeyValue(raw, 'coverage_gaps')
      const under = extractKeyValue(raw, 'underdeveloped_sections')
      if (strengths !== undefined || gaps !== undefined || under !== undefined) {
        const data = normalizeGapAnalysis({
          competitor_strengths: strengths,
          coverage_gaps: gaps,
          underdeveloped_sections: under,
        })
        if (!isGapEmpty(data)) {
          dataPresentRef.current.gapanalysis = true
          gapRef.current = data
          setGapData(data)
        }
      }
    }
    if (!dataPresentRef.current.recommendations) {
      const recs = extractKeyValue(raw, 'recommendations')
      const citations = extractKeyValue(raw, 'citation_opportunities')
      const faqs = extractKeyValue(raw, 'faq_suggestions')
      if (recs !== undefined || citations !== undefined || faqs !== undefined) {
        const data = normalizeRecommendations({
          recommendations: recs,
          citation_opportunities: citations,
          faq_suggestions: faqs,
        })
        if (data.recommendations.length > 0) {
          dataPresentRef.current.recommendations = true
          recRef.current = data
          setRecData(data)
        }
      }
    }
    if (!dataPresentRef.current.coverage) {
      const score = extractKeyValue(raw, 'overall_score')
      const passed = extractKeyValue(raw, 'passed')
      const summary = extractKeyValue(raw, 'summary')
      const criteria = extractKeyValue(raw, 'criteria')
      if (score !== undefined || passed !== undefined || summary !== undefined || criteria !== undefined) {
        const data = normalizeCoverage({
          overall_score: score,
          passed,
          summary,
          criteria,
        })
        if (!isCovEmpty(data)) {
          dataPresentRef.current.coverage = true
          covRef.current = data
          setCoverage(data)
        }
      }
    }
  }

  function finishRun(): void {
    if (doneRef.current) return
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

  function handleEventData(data: string): void {
    if (doneRef.current) return
    if (!data) return
    if (data === '[DONE]') {
      finishRun()
      return
    }
    const parsed = extractBalancedJson(data)
    const rec = asRecord(parsed)
    if (!rec) {
      rawTranscriptRef.current += data
      if (isHeartbeatMessage(data)) {
        setStatusMessage(data.trim())
        return
      }
      looseTextRef.current += data
      routeLooseText()
      return
    }
    const blockId = firstStringOf(rec, ['blockId', 'block_id', 'blockName', 'blockname', 'block'])
    let chunk = ''
    for (const key of ['chunk', 'delta', 'text']) {
      const value = rec[key]
      if (typeof value === 'string' && value) {
        chunk = value
        break
      }
    }
    if (chunk) {
      rawTranscriptRef.current += chunk
      if (blockId) {
        routeChunk(blockId, chunk)
      } else if (isHeartbeatMessage(chunk)) {
        setStatusMessage(chunk.trim())
      } else {
        looseTextRef.current += chunk
        routeLooseText()
      }
    } else {
      rawTranscriptRef.current += `\n${data}`
    }
    const merged = finalOutputRef.current ?? {}
    collectStructured(rec, merged, 0)
    finalOutputRef.current = merged
    applyMergedOutputs()
    const statusText = firstStringOf(rec, ['message', 'status'])
    if (statusText && isHeartbeatMessage(statusText)) setStatusMessage(statusText)
    if (rec['done'] === true || rec['event'] === 'done' || rec['type'] === 'done') finishRun()
  }

  function processLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    if (trimmed.startsWith('data:')) {
      handleEventData(trimmed.slice(5).trim())
      return
    }
    if (trimmed.startsWith(':') || trimmed.startsWith('event:') || trimmed.startsWith('id:')) return
    handleEventData(trimmed)
  }

  async function runEnhancement(payload: EnhancePayload): Promise<void> {
    lastPayloadRef.current = payload
    resetRun()
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
      const responseType = res.headers.get('content-type') ?? ''
      if (responseType.includes('application/json')) {
        // Non-streamed fallback — merge the whole JSON body at once.
        const data: unknown = await res.json()
        const rec = asRecord(data)
        if (rec) {
          const merged = finalOutputRef.current ?? {}
          collectStructured(rec, merged, 0)
          finalOutputRef.current = merged
        }
        try {
          rawTranscriptRef.current += JSON.stringify(data)
        } catch {
          // Non-serializable body — salvage pass simply has less to mine.
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
        buffer += decoder.decode(value, { stream: true })
        let newlineIndex = buffer.indexOf('\n')
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).replace(/\r$/, '')
          buffer = buffer.slice(newlineIndex + 1)
          processLine(line)
          newlineIndex = buffer.indexOf('\n')
        }
        if (doneRef.current) break
      }
      if (buffer.trim() && !doneRef.current) processLine(buffer)
      finishRun()
    } catch (err) {
      if (controller.signal.aborted) return
      setPhase('error')
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    }
  }

  function validate(): EnhanceFormErrors {
    const next: EnhanceFormErrors = {}
    const url = articleUrl.trim()
    if (!url) {
      next.articleUrl = 'Please enter the article URL.'
    } else {
      try {
        const parsedUrl = new URL(url)
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          next.articleUrl = 'The URL must start with http:// or https://.'
        }
      } catch {
        next.articleUrl = 'Please enter a valid URL (including https://).'
      }
    }
    if (!contentType) next.contentType = 'Please choose a content type.'
    if (contentType === 'Other' && !otherType.trim()) {
      next.otherType = 'Please describe the content type.'
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
    setSubmittedUrl(payload.article_url)
    void runEnhancement(payload)
  }

  function handleRetry(): void {
    const payload = lastPayloadRef.current
    if (payload) {
      void runEnhancement(payload)
      return
    }
    setPhase('idle')
    setErrorMessage('')
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
  const streaming = phase === 'streaming'

  return (
    <div className="mx-auto max-w-4xl">
      <div className="screen-only space-y-6">
        <form
          onSubmit={handleSubmit}
          noValidate
          className="card-enter rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8"
        >
          <div className="space-y-5">
            <div>
              <label htmlFor="article-url" className="mb-1.5 block text-sm font-semibold text-ink">
                Article URL
              </label>
              <input
                id="article-url"
                type="url"
                inputMode="url"
                value={articleUrl}
                onChange={(event) => setArticleUrl(event.target.value)}
                placeholder="https://example.com/blog/my-article"
                aria-invalid={Boolean(errors.articleUrl)}
                aria-describedby={errors.articleUrl ? 'article-url-error' : undefined}
                className={`${inputBase} ${errors.articleUrl ? 'border-rose-300' : 'border-slate-200'}`}
              />
              {errors.articleUrl ? (
                <p id="article-url-error" className="mt-1.5 text-xs font-medium text-rose-600">
                  {errors.articleUrl}
                </p>
              ) : null}
            </div>

            <div>
              <span className="mb-1.5 block text-sm font-semibold text-ink">Content type</span>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Content type">
                {CONTENT_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={contentType === type}
                    onClick={() => setContentType(type)}
                    className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:outline-2 focus-visible:outline-accent ${
                      contentType === type
                        ? 'border-accent bg-indigo-50 text-accent-deep'
                        : 'border-slate-200 bg-white text-ink-soft hover:border-indigo-200 hover:text-ink'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
              {errors.contentType ? (
                <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.contentType}</p>
              ) : null}
              {contentType === 'Other' ? (
                <div className="mt-3">
                  <label htmlFor="other-type" className="mb-1.5 block text-xs font-semibold text-ink-soft">
                    Describe the content type
                  </label>
                  <input
                    id="other-type"
                    type="text"
                    value={otherType}
                    onChange={(event) => setOtherType(event.target.value)}
                    placeholder="e.g. Comparison Page"
                    aria-invalid={Boolean(errors.otherType)}
                    aria-describedby={errors.otherType ? 'other-type-error' : undefined}
                    className={`${inputBase} ${errors.otherType ? 'border-rose-300' : 'border-slate-200'}`}
                  />
                  {errors.otherType ? (
                    <p id="other-type-error" className="mt-1.5 text-xs font-medium text-rose-600">
                      {errors.otherType}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div>
              <label htmlFor="article-text" className="mb-1.5 block text-sm font-semibold text-ink">
                Article text{' '}
                <span className="font-normal text-ink-soft">(optional — the agent can read from the URL)</span>
              </label>
              <textarea
                id="article-text"
                value={articleText}
                onChange={(event) => setArticleText(event.target.value)}
                rows={6}
                placeholder="Paste the article content here if you want the agent to work from a specific draft…"
                className={`${inputBase} resize-y border-slate-200`}
              />
            </div>

            <div className="flex items-center justify-end gap-3">
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
            </div>
          </div>
        </form>

        {streaming ? (
          <div className="space-y-4">
            <StatusChip message={statusMessage || 'Working on it…'} elapsedSeconds={elapsed} />
            <ProgressChecklist stages={checklistStages} />
          </div>
        ) : null}

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

      {/* Print-only mirror of the results for the Export feature. */}
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
