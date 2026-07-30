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

  function applyArticle(text: string): void {
    if (!text.trim()) return
    dataPresentRef.current.article = true
    setContent(text)
    markPanelStreaming('article')
  }

  function applyGap(data: GapAnalysisData): void {
    if (isGapEmpty(data)) return
    if (gapRef.current && gapTotal(gapRef.current) > gapTotal(data)) return
    gapRef.current = data
    dataPresentRef.current.gapanalysis = true
    setGapData(data)
    markPanelStreaming('gapanalysis')
  }

  function applyRec(data: RecommendationsData): void {
    if (data.recommendations.length === 0) return
    // Monotonic: never replace a richer set (e.g. one that already includes
    // citation_opportunities + faq_suggestions items) with a smaller one.
    if (recRef.current && recRef.current.recommendations.length > data.recommendations.length) return
    recRef.current = data
    dataPresentRef.current.recommendations = true
    setRecData(data)
    markPanelStreaming('recommendations')
  }

  function applyCoverage(data: CoverageData): void {
    if (isCovEmpty(data)) return
    covRef.current = data
    dataPresentRef.current.coverage = true
    setCoverage(data)
    markPanelStreaming('coverage')
  }

  /**
   * Combines the three Recommendations outputs (recommendations.recommendations,
   * recommendations.citation_opportunities, recommendations.faq_suggestions)
   * into ONE record for normalizeRecommendations, which tags citation and FAQ
   * items with their section categories. This is what keeps the Citation
   * Opportunities and FAQ Suggestions sections populated even when those
   * outputs arrive outside the streamed recommendations block.
   */
  function buildRecommendationsRecord(
    recList: unknown,
    citations: unknown,
    faqs: unknown,
  ): Record<string, unknown> {
    const combined: Record<string, unknown> = {}
    if (recList !== undefined) combined['recommendations'] = parseIfJsonLike(recList)
    if (citations !== undefined) combined['citation_opportunities'] = parseIfJsonLike(citations)
    if (faqs !== undefined) combined['faq_suggestions'] = parseIfJsonLike(faqs)
    return combined
  }

  function applyMergedOutputs(): void {
    const merged = finalOutputRef.current
    if (!merged) return

    // Enhanced article.
    const articleValue = findMergedValue(merged, [
      'enhancedarticlewriter.content',
      'enhanced_article',
      'content',
    ])
    const articleStr = articleTextFrom(parseIfJsonLike(articleValue))
    if (articleStr.trim()) {
      const currentArticle = articleFromAccumulated(targetAccumRef.current.article)
      if (articleStr.length >= currentArticle.length) applyArticle(articleStr)
    }

    // Gap analysis.
    const strengths = findMergedValue(merged, ['gapanalysis.competitor_strengths', 'competitor_strengths'])
    const gaps = findMergedValue(merged, ['gapanalysis.coverage_gaps', 'coverage_gaps'])
    const under = findMergedValue(merged, [
      'gapanalysis.underdeveloped_sections',
      'underdeveloped_sections',
    ])
    const gapRecord: Record<string, unknown> = {}
    if (strengths !== undefined) gapRecord['competitor_strengths'] = parseIfJsonLike(strengths)
    if (gaps !== undefined) gapRecord['coverage_gaps'] = parseIfJsonLike(gaps)
    if (under !== undefined) gapRecord['underdeveloped_sections'] = parseIfJsonLike(under)
    if (Object.keys(gapRecord).length > 0) applyGap(normalizeGapAnalysis(gapRecord))

    // Recommendations - ALL THREE outputs are looked up and merged together.
    const recList = findMergedValue(merged, ['recommendations.recommendations', 'recommendations'])
    const citations = findMergedValue(merged, [
      'recommendations.citation_opportunities',
      'citation_opportunities',
    ])
    const faqs = findMergedValue(merged, ['recommendations.faq_suggestions', 'faq_suggestions'])
    if (recList !== undefined || citations !== undefined || faqs !== undefined) {
      const combined = buildRecommendationsRecord(recList, citations, faqs)
      applyRec(normalizeRecommendations(combined))
    }

    // Coverage verification.
    const overallScore = findMergedValue(merged, ['coverageverifier.overall_score', 'overall_score'])
    const passed = findMergedValue(merged, ['coverageverifier.passed', 'passed'])
    const summary = findMergedValue(merged, ['coverageverifier.summary', 'summary'])
    const criteria = findMergedValue(merged, ['coverageverifier.criteria', 'criteria'])
    const covRecord: Record<string, unknown> = {}
    if (overallScore !== undefined) covRecord['overall_score'] = overallScore
    if (passed !== undefined) covRecord['passed'] = passed
    if (summary !== undefined) covRecord['summary'] = summary
    if (criteria !== undefined) covRecord['criteria'] = parseIfJsonLike(criteria)
    if (Object.keys(covRecord).length > 0) applyCoverage(normalizeCoverage(covRecord))
  }

  function routePanelAccum(panel: PanelKey, accumulated: string): void {
    targetAccumRef.current[panel] = accumulated
    markPanelStreaming(panel)
    if (panel === 'article') {
      applyArticle(articleFromAccumulated(accumulated))
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
    applyCoverage(normalizeCoverage(accumulated))
  }

  function handlePayload(payloadText: string): void {
    rawTranscriptRef.current += payloadText + '\n'
    const parsed = extractBalancedJson(payloadText)
    const rec = asRecord(parsed)

    if (!rec) {
      // Plain text (or a bare JSON array) chunk with no event envelope.
      if (isHeartbeatMessage(payloadText)) {
        setStatusMessage(payloadText.trim())
        return
      }
      looseTextRef.current += payloadText
      const panel = classifyUnknownPayload(looseTextRef.current)
      if (panel) routePanelAccum(panel, looseTextRef.current)
      return
    }

    const blockId = firstStringOf(rec, ['blockId', 'block_id', 'blockid', 'blockName', 'blockname', 'id'])
    const chunk = chunkTextOf(rec)

    if (blockId && chunk) {
      blockAccumRef.current[blockId] = (blockAccumRef.current[blockId] ?? '') + chunk
      let target: BlockTarget | null = blockTargetRef.current[blockId] ?? resolveBlockTarget(blockId)
      if (!target) target = classifyUnknownPayload(blockAccumRef.current[blockId])
      if (target) {
        blockTargetRef.current[blockId] = target
        if (target === 'status-theme' || target === 'status-research') {
          setStatusMessage(statusLabelFor(target))
        } else {
          routePanelAccum(target, blockAccumRef.current[blockId])
        }
      }
    } else if (chunk) {
      if (isHeartbeatMessage(chunk)) {
        setStatusMessage(chunk.trim())
      } else {
        looseTextRef.current += chunk
        const panel = classifyUnknownPayload(looseTextRef.current)
        if (panel) routePanelAccum(panel, looseTextRef.current)
      }
    }

    // Structured outputs can arrive on ANY event (dotted selectedOutputs keys,
    // panel-name keys, or output/result/data envelopes). Merge and apply
    // immediately so panels populate as soon as data exists.
    const merged = finalOutputRef.current ?? {}
    collectStructured(rec, merged, 0)
    finalOutputRef.current = merged
    applyMergedOutputs()

    const message = firstStringOf(rec, ['message', 'status'])
    if (message && isHeartbeatMessage(message)) setStatusMessage(message)
  }

  function salvageFromTranscript(): void {
    const raw = rawTranscriptRef.current
    if (!raw) return

    if (!dataPresentRef.current.article) {
      const value = extractKeyValue(raw, 'content')
      const text = articleTextFrom(value)
      if (text.trim()) applyArticle(text)
    }

    if (!dataPresentRef.current.gapanalysis) {
      const gapRecord: Record<string, unknown> = {}
      for (const key of ['competitor_strengths', 'coverage_gaps', 'underdeveloped_sections']) {
        const value = extractKeyValue(raw, key)
        if (value !== undefined) gapRecord[key] = value
      }
      if (Object.keys(gapRecord).length > 0) applyGap(normalizeGapAnalysis(gapRecord))
    }

    // Recommendations: ALWAYS salvage-merge the three section outputs - even
    // when the recommendations panel already received streamed data - so the
    // Citation Opportunities and FAQ Suggestions sections are never dropped
    // when their payloads arrive outside the routed recommendations block.
    const recValue = extractKeyValue(raw, 'recommendations')
    const citationsValue = extractKeyValue(raw, 'citation_opportunities')
    const faqsValue = extractKeyValue(raw, 'faq_suggestions')
    if (recValue !== undefined || citationsValue !== undefined || faqsValue !== undefined) {
      const combined = buildRecommendationsRecord(recValue, citationsValue, faqsValue)
      const salvaged = normalizeRecommendations(combined)
      if (salvaged.recommendations.length > (recRef.current?.recommendations.length ?? 0)) {
        applyRec(salvaged)
      }
    }

    if (!dataPresentRef.current.coverage) {
      const covRecord: Record<string, unknown> = {}
      for (const key of ['overall_score', 'passed', 'summary', 'criteria']) {
        const value = extractKeyValue(raw, key)
        if (value !== undefined) covRecord[key] = value
      }
      if (Object.keys(covRecord).length > 0) applyCoverage(normalizeCoverage(covRecord))
    }
  }

  function finishRun(): void {
    if (doneRef.current) return
    // Salvage BEFORE flipping doneRef so late-arriving data can still stream
    // in visually; then finalize section statuses from what actually arrived.
    salvageFromTranscript()
    applyMergedOutputs()
    doneRef.current = true
    setSections(() => {
      const next = { ...INITIAL_SECTIONS }
      for (const panel of ALL_PANELS) {
        next[panel] = dataPresentRef.current[panel] ? 'done' : 'empty'
      }
      return next
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

  async function startRun(payload: EnhancePayload): Promise<void> {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    resetRun()
    lastPayloadRef.current = payload
    setSubmittedUrl(payload.article_url)
    setPhase('streaming')
    startRef.current = Date.now()
    setStatusMessage('Contacting the enhancement agent…')
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
        throw new Error(body?.error || `The enhancement request failed (${res.status}).`)
      }

      const resContentType = res.headers.get('content-type') ?? ''
      if (resContentType.includes('application/json')) {
        // Non-streamed fallback: one JSON body with every output.
        const text = await res.text()
        rawTranscriptRef.current += text + '\n'
        const parsed = extractBalancedJson(text)
        const rec = asRecord(parsed)
        if (rec) {
          const merged = finalOutputRef.current ?? {}
          collectStructured(rec, merged, 0)
          finalOutputRef.current = merged
          applyMergedOutputs()
        }
        finishRun()
        return
      }

      if (!res.body) throw new Error('The enhancement service returned an empty response.')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let newlineIndex = buffer.indexOf('\n')
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).replace(/\r$/, '')
          buffer = buffer.slice(newlineIndex + 1)
          newlineIndex = buffer.indexOf('\n')
          const data = line.startsWith('data:') ? line.slice(5).trim() : line.trim()
          if (!data) continue
          if (data === '[DONE]') continue
          handlePayload(data)
        }
      }
      const tail = buffer.replace(/\r$/, '').trim()
      if (tail) {
        const data = tail.startsWith('data:') ? tail.slice(5).trim() : tail
        if (data && data !== '[DONE]') handlePayload(data)
      }
      finishRun()
    } catch (err) {
      if (controller.signal.aborted) return
      setPhase('error')
      setStatusMessage('')
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
        const parsedUrl = new URL(url)
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          next.articleUrl = 'Enter a valid http(s) URL.'
        }
      } catch {
        next.articleUrl = 'Enter a valid URL (including https://).'
      }
    }
    if (!contentType) next.contentType = 'Select a content type.'
    if (contentType === 'Other' && !otherType.trim()) next.otherType = 'Describe the content type.'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (phase === 'streaming') return
    if (!validate()) return
    const resolvedType = contentType === 'Other' ? otherType.trim() : contentType
    void startRun({
      article_url: articleUrl.trim(),
      article_text: articleText.trim(),
      content_type: resolvedType,
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
      // Fonts API unavailable - print with whatever is loaded.
    }
    window.print()
  }

  const checklistStages: ChecklistStage[] = STAGE_ORDER.map((id) => ({
    id,
    label: STAGE_LABELS[id],
    status: stages[id],
  }))

  const isStreaming = phase === 'streaming'
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
                Article URL <span className="text-rose-500">*</span>
              </label>
              <input
                id="article-url"
                type="url"
                value={articleUrl}
                onChange={(e) => setArticleUrl(e.target.value)}
                placeholder="https://example.com/my-article"
                disabled={isStreaming}
                aria-invalid={Boolean(errors.articleUrl)}
                className={`${inputBase} ${errors.articleUrl ? 'border-rose-300' : 'border-slate-200'}`}
              />
              {errors.articleUrl && <p className="mt-1.5 text-xs text-rose-600">{errors.articleUrl}</p>}
            </div>

            <div>
              <label htmlFor="article-text" className="mb-1.5 block text-sm font-semibold text-ink">
                Article text <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <textarea
                id="article-text"
                value={articleText}
                onChange={(e) => setArticleText(e.target.value)}
                placeholder="Paste the article text here, or leave empty to let the agent read it from the URL."
                rows={6}
                disabled={isStreaming}
                className={`${inputBase} resize-y border-slate-200`}
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label htmlFor="content-type" className="mb-1.5 block text-sm font-semibold text-ink">
                  Content type <span className="text-rose-500">*</span>
                </label>
                <select
                  id="content-type"
                  value={contentType}
                  onChange={(e) => setContentType(e.target.value)}
                  disabled={isStreaming}
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
                {errors.contentType && (
                  <p className="mt-1.5 text-xs text-rose-600">{errors.contentType}</p>
                )}
              </div>
              {contentType === 'Other' && (
                <div>
                  <label htmlFor="other-type" className="mb-1.5 block text-sm font-semibold text-ink">
                    Describe the content type <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="other-type"
                    type="text"
                    value={otherType}
                    onChange={(e) => setOtherType(e.target.value)}
                    placeholder="e.g. Case study"
                    disabled={isStreaming}
                    aria-invalid={Boolean(errors.otherType)}
                    className={`${inputBase} ${errors.otherType ? 'border-rose-300' : 'border-slate-200'}`}
                  />
                  {errors.otherType && (
                    <p className="mt-1.5 text-xs text-rose-600">{errors.otherType}</p>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={isStreaming}
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-deep focus:outline-none focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isStreaming ? (
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
              {isStreaming && statusMessage ? (
                <StatusChip message={statusMessage} elapsedSeconds={elapsed} />
              ) : null}
            </div>
          </div>
        </form>

        {phase === 'error' && (
          <div className="mt-6">
            <ErrorCard message={errorMessage} onRetry={handleRetry} />
          </div>
        )}

        {showResults && (
          <div className="mt-6 space-y-6">
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
