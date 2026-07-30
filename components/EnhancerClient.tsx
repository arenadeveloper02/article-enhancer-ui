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

  /**
   * Re-normalizes a panel's accumulated text and pushes any usable data into
   * state. Called after every chunk so panels render progressively while
   * streaming - and again during the final pass at [DONE].
   */
  function updatePanelFromAccumulated(panel: PanelKey): void {
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

  /**
   * Applies the merged structured outputs (recommendations.recommendations,
   * recommendations.citation_opportunities, recommendations.faq_suggestions,
   * gapanalysis.*, coverageverifier.*, enhancedarticlewriter.content) to the
   * panels. Runs after every structured event AND at [DONE], so the
   * Recommendations tab's three sections (Citation Opportunities, FAQ
   * Suggestions, Recommendations) are ALWAYS populated whenever the upstream
   * payload carries them.
   */
  function applyMergedOutputs(): void {
    const merged = finalOutputRef.current
    if (!merged) return

    const articleValue = parseIfJsonLike(
      findMergedValue(merged, ['enhancedarticlewriter.content', 'enhanced_article', 'content', 'article']),
    )
    const articleStr = articleTextFrom(articleValue)
    if (articleStr.trim()) {
      const currentArticle = articleFromAccumulated(targetAccumRef.current.article)
      if (articleStr.trim().length >= currentArticle.trim().length) {
        dataPresentRef.current.article = true
        setContent(articleStr)
        markPanelStreaming('article')
      }
    }

    const strengths = findMergedValue(merged, ['gapanalysis.competitor_strengths', 'competitor_strengths'])
    const gaps = findMergedValue(merged, ['gapanalysis.coverage_gaps', 'coverage_gaps'])
    const under = findMergedValue(merged, [
      'gapanalysis.underdeveloped_sections',
      'underdeveloped_sections',
    ])
    if (strengths !== undefined || gaps !== undefined || under !== undefined) {
      const gapObj: Record<string, unknown> = {}
      if (strengths !== undefined) gapObj.competitor_strengths = strengths
      if (gaps !== undefined) gapObj.coverage_gaps = gaps
      if (under !== undefined) gapObj.underdeveloped_sections = under
      const data = normalizeGapAnalysis(gapObj)
      const currentCount = gapRef.current ? gapTotal(gapRef.current) : 0
      if (!isGapEmpty(data) && gapTotal(data) >= currentCount) {
        dataPresentRef.current.gapanalysis = true
        gapRef.current = data
        setGapData(data)
        markPanelStreaming('gapanalysis')
      }
    }

    // The Recommendations tab must ALWAYS carry citation_opportunities and
    // faq_suggestions alongside the main recommendations whenever the stream
    // delivered them - the composite object below hands all three lists to
    // normalizeRecommendations, which tags each source with its category.
    const recValue = findMergedValue(merged, ['recommendations.recommendations', 'recommendations'])
    const citationValue = findMergedValue(merged, [
      'recommendations.citation_opportunities',
      'citation_opportunities',
    ])
    const faqValue = findMergedValue(merged, ['recommendations.faq_suggestions', 'faq_suggestions'])
    if (recValue !== undefined || citationValue !== undefined || faqValue !== undefined) {
      const recObj: Record<string, unknown> = {}
      if (recValue !== undefined) recObj.recommendations = recValue
      if (citationValue !== undefined) recObj.citation_opportunities = citationValue
      if (faqValue !== undefined) recObj.faq_suggestions = faqValue
      const data = normalizeRecommendations(recObj)
      const currentCount = recRef.current ? recRef.current.recommendations.length : 0
      if (data.recommendations.length > 0 && data.recommendations.length >= currentCount) {
        dataPresentRef.current.recommendations = true
        recRef.current = data
        setRecData(data)
        markPanelStreaming('recommendations')
      }
    }

    const score = findMergedValue(merged, ['coverageverifier.overall_score', 'overall_score'])
    const passed = findMergedValue(merged, ['coverageverifier.passed', 'passed'])
    const summary = findMergedValue(merged, ['coverageverifier.summary', 'summary'])
    const criteria = findMergedValue(merged, ['coverageverifier.criteria', 'criteria'])
    if (score !== undefined || passed !== undefined || summary !== undefined || criteria !== undefined) {
      const covObj: Record<string, unknown> = {}
      if (score !== undefined) covObj.overall_score = score
      if (passed !== undefined) covObj.passed = passed
      if (summary !== undefined) covObj.summary = summary
      if (criteria !== undefined) covObj.criteria = criteria
      const data = normalizeCoverage(covObj)
      const currentCount = covRef.current ? covRef.current.criteria.length : 0
      if (!isCovEmpty(data) && data.criteria.length >= currentCount) {
        dataPresentRef.current.coverage = true
        covRef.current = data
        setCoverage(data)
        markPanelStreaming('coverage')
      }
    }
  }

  /**
   * Last-resort salvage at [DONE]: mines the raw stream transcript for the
   * exact output keys of any panel that never received routable data -
   * including recommendations.citation_opportunities and
   * recommendations.faq_suggestions so the Recommendations tab's sections
   * populate even when block routing failed.
   */
  function salvageFromTranscript(): void {
    const raw = rawTranscriptRef.current
    if (!raw.trim()) return
    if (!dataPresentRef.current.article) {
      const value = extractKeyValue(raw, 'content') ?? extractKeyValue(raw, 'enhanced_article')
      const text = articleTextFrom(value)
      if (text.trim()) {
        dataPresentRef.current.article = true
        setContent(text)
      }
    }
    if (!dataPresentRef.current.gapanalysis) {
      const gapObj: Record<string, unknown> = {
        competitor_strengths: extractKeyValue(raw, 'competitor_strengths'),
        coverage_gaps: extractKeyValue(raw, 'coverage_gaps'),
        underdeveloped_sections: extractKeyValue(raw, 'underdeveloped_sections'),
      }
      const data = normalizeGapAnalysis(gapObj)
      if (!isGapEmpty(data)) {
        dataPresentRef.current.gapanalysis = true
        gapRef.current = data
        setGapData(data)
      }
    }
    {
      // Always attempt the recommendations salvage - even when the main list
      // routed correctly - so citation_opportunities and faq_suggestions that
      // streamed under unroutable blockIds still populate their sections.
      const recs = extractKeyValue(raw, 'recommendations')
      const citations = extractKeyValue(raw, 'citation_opportunities')
      const faqs = extractKeyValue(raw, 'faq_suggestions')
      if (recs !== undefined || citations !== undefined || faqs !== undefined) {
        const recObj: Record<string, unknown> = {}
        if (recs !== undefined) recObj.recommendations = recs
        if (citations !== undefined) recObj.citation_opportunities = citations
        if (faqs !== undefined) recObj.faq_suggestions = faqs
        const data = normalizeRecommendations(recObj)
        const currentCount = recRef.current ? recRef.current.recommendations.length : 0
        if (data.recommendations.length > currentCount) {
          dataPresentRef.current.recommendations = true
          recRef.current = data
          setRecData(data)
        }
      }
    }
    if (!dataPresentRef.current.coverage) {
      const covObj: Record<string, unknown> = {
        overall_score: extractKeyValue(raw, 'overall_score'),
        passed: extractKeyValue(raw, 'passed'),
        summary: extractKeyValue(raw, 'summary'),
        criteria: extractKeyValue(raw, 'criteria'),
      }
      const data = normalizeCoverage(covObj)
      if (!isCovEmpty(data)) {
        dataPresentRef.current.coverage = true
        covRef.current = data
        setCoverage(data)
      }
    }
  }

  function finishRun(): void {
    if (doneRef.current) return
    doneRef.current = true
    applyMergedOutputs()
    for (const panel of ALL_PANELS) updatePanelFromAccumulated(panel)
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

  function routeLooseText(text: string): void {
    if (!text.trim() || isHeartbeatMessage(text)) return
    looseTextRef.current += text
    const panel = classifyUnknownPayload(looseTextRef.current)
    if (!panel) return
    targetAccumRef.current[panel] += looseTextRef.current
    looseTextRef.current = ''
    markPanelStreaming(panel)
    updatePanelFromAccumulated(panel)
  }

  function handleEventPayload(payloadText: string): void {
    rawTranscriptRef.current += `${payloadText}\n`
    if (payloadText === '[DONE]') {
      finishRun()
      return
    }
    const parsed = extractBalancedJson(payloadText)
    const rec = asRecord(parsed)
    if (!rec) {
      routeLooseText(payloadText)
      return
    }

    if (rec['success'] === false) {
      const message =
        firstStringOf(rec, ['error', 'message']) || 'The enhancement service reported an error.'
      doneRef.current = true
      setPhase('error')
      setErrorMessage(message)
      return
    }

    const merged = finalOutputRef.current ?? {}
    collectStructured(rec, merged, 0)
    finalOutputRef.current = merged

    const blockId = firstStringOf(rec, ['blockId', 'block_id', 'blockid', 'blockName', 'blockname'])
    const chunk = chunkTextOf(rec)

    if (blockId) {
      if (chunk) {
        blockAccumRef.current[blockId] = (blockAccumRef.current[blockId] ?? '') + chunk
      }
      let target: BlockTarget | null = blockTargetRef.current[blockId] ?? null
      if (!target) {
        target =
          resolveBlockTarget(blockId) ?? classifyUnknownPayload(blockAccumRef.current[blockId] ?? '')
        if (target) {
          blockTargetRef.current[blockId] = target
          if (target === 'status-theme' || target === 'status-research') {
            setStatusMessage(statusLabelFor(target))
          } else {
            // Flush everything buffered for this block before classification.
            targetAccumRef.current[target] += blockAccumRef.current[blockId] ?? ''
            markPanelStreaming(target)
            updatePanelFromAccumulated(target)
          }
        }
      } else if (target === 'status-theme' || target === 'status-research') {
        setStatusMessage(statusLabelFor(target))
      } else if (chunk) {
        targetAccumRef.current[target] += chunk
        markPanelStreaming(target)
        updatePanelFromAccumulated(target)
      }
    } else if (chunk) {
      routeLooseText(chunk)
    }

    const message = firstStringOf(rec, ['message', 'status'])
    if (message && !chunk && isHeartbeatMessage(message)) {
      setStatusMessage(message)
    }

    applyMergedOutputs()
  }

  function processLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    const payloadText = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed
    if (!payloadText) return
    handleEventPayload(payloadText)
  }

  async function runEnhancement(payload: EnhancePayload): Promise<void> {
    lastPayloadRef.current = payload
    resetRun()
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
        throw new Error(body?.error || `Enhancement request failed (${res.status}).`)
      }

      const upstreamType = res.headers.get('content-type') ?? ''
      if (upstreamType.includes('application/json')) {
        // Non-streamed fallback: merge the whole JSON body, then finish.
        const data: unknown = await res.json()
        try {
          rawTranscriptRef.current += JSON.stringify(data)
        } catch {
          // Ignore serialization issues - salvage still runs on what we have.
        }
        const rec = asRecord(data)
        if (rec) {
          const merged = finalOutputRef.current ?? {}
          collectStructured(rec, merged, 0)
          finalOutputRef.current = merged
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
      if (buffer.trim()) processLine(buffer)
      finishRun()
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
      next.articleUrl = 'Enter the article URL.'
    } else {
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          next.articleUrl = 'Enter a valid http(s) URL.'
        }
      } catch {
        next.articleUrl = 'Enter a valid URL.'
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
    void runEnhancement({
      article_url: articleUrl.trim(),
      article_text: articleText.trim(),
      content_type: resolvedType,
    })
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
    <div className="mx-auto w-full max-w-3xl">
      <form
        onSubmit={handleSubmit}
        noValidate
        className="screen-only card-enter mb-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8"
      >
        <div className="grid gap-5">
          <div>
            <label htmlFor="article-url" className="mb-1.5 block text-sm font-medium text-ink">
              Article URL <span className="text-rose-500">*</span>
            </label>
            <input
              id="article-url"
              type="url"
              value={articleUrl}
              onChange={(e) => setArticleUrl(e.target.value)}
              placeholder="https://example.com/blog/my-article"
              disabled={streaming}
              className={`${inputBase} ${errors.articleUrl ? 'border-rose-300' : 'border-slate-200'}`}
            />
            {errors.articleUrl && <p className="mt-1 text-xs text-rose-600">{errors.articleUrl}</p>}
          </div>
          <div>
            <label htmlFor="article-text" className="mb-1.5 block text-sm font-medium text-ink">
              Article text <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <textarea
              id="article-text"
              rows={5}
              value={articleText}
              onChange={(e) => setArticleText(e.target.value)}
              placeholder="Paste the article text here, or leave blank to let the agent read it from the URL."
              disabled={streaming}
              className={`${inputBase} resize-y ${errors.articleText ? 'border-rose-300' : 'border-slate-200'}`}
            />
            {errors.articleText && <p className="mt-1 text-xs text-rose-600">{errors.articleText}</p>}
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="content-type" className="mb-1.5 block text-sm font-medium text-ink">
                Content type <span className="text-rose-500">*</span>
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
              {errors.contentType && (
                <p className="mt-1 text-xs text-rose-600">{errors.contentType}</p>
              )}
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
                  onChange={(e) => setOtherType(e.target.value)}
                  placeholder="e.g. Case study"
                  disabled={streaming}
                  className={`${inputBase} ${errors.otherType ? 'border-rose-300' : 'border-slate-200'}`}
                />
                {errors.otherType && (
                  <p className="mt-1 text-xs text-rose-600">{errors.otherType}</p>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={streaming}
              className="inline-flex items-center rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-deep focus:outline-none focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {streaming ? 'Enhancing…' : 'Enhance article'}
            </button>
            {streaming && (
              <span className="text-xs text-ink-soft">
                Results stream in below as each stage completes.
              </span>
            )}
          </div>
        </div>
      </form>

      {streaming && (
        <div className="screen-only mb-6 space-y-4">
          <StatusChip message={statusMessage || 'Working on it…'} elapsedSeconds={elapsed} />
          <ProgressChecklist stages={checklistStages} />
        </div>
      )}

      {phase === 'error' && (
        <div className="screen-only mb-6">
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
