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
  // UI FIX (post-stream blanking): the Enhanced Article content must NEVER
  // regress or blank out once it has been shown. Every article update flows
  // through updateArticle(), which keeps the longest non-empty text seen so
  // far - a shorter or empty late payload (e.g. the finalize/[DONE] pass) can
  // never wipe the already-rendered article from the tab.
  const articleTextRef = useRef('')

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
    articleTextRef.current = ''
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

  function markSectionStreaming(panel: PanelKey): void {
    if (doneRef.current) return
    setSections((prev) => (prev[panel] === 'streaming' ? prev : { ...prev, [panel]: 'streaming' }))
    markStageActive(STAGE_FOR_PANEL[panel])
  }

  /**
   * Monotonic article updates: only ever replaces the rendered article with
   * an equal-or-longer non-empty text. This is the core of the post-stream
   * blanking fix - once the article has rendered, no later (empty or
   * truncated) payload can clear the Enhanced Article tab.
   */
  function updateArticle(text: string): void {
    if (!text.trim()) return
    if (text.length < articleTextRef.current.length) return
    articleTextRef.current = text
    dataPresentRef.current.article = true
    setContent(text)
  }

  function applyPanelData(panel: PanelKey, accumulated: string): void {
    if (!accumulated.trim()) return
    if (panel === 'article') {
      updateArticle(articleFromAccumulated(accumulated))
      return
    }
    if (panel === 'gapanalysis') {
      const data = normalizeGapAnalysis(accumulated)
      if (data && !isGapEmpty(data)) {
        const prev = gapRef.current
        if (!prev || gapTotal(data) >= gapTotal(prev)) {
          gapRef.current = data
          dataPresentRef.current.gapanalysis = true
          setGapData(data)
        }
      }
      return
    }
    if (panel === 'recommendations') {
      const data = normalizeRecommendations(accumulated)
      if (data && data.recommendations.length > 0) {
        const prevCount = recRef.current ? recRef.current.recommendations.length : 0
        if (data.recommendations.length >= prevCount) {
          recRef.current = data
          dataPresentRef.current.recommendations = true
          setRecData(data)
        }
      }
      return
    }
    const data = normalizeCoverage(accumulated)
    if (data && !isCovEmpty(data)) {
      covRef.current = data
      dataPresentRef.current.coverage = true
      setCoverage(data)
    }
  }

  /** Applies whatever usable data currently sits in the merged structured outputs. */
  function applyMergedOutputs(): void {
    const merged = finalOutputRef.current
    if (!merged || Object.keys(merged).length === 0) return

    const articleValue = parseIfJsonLike(
      findMergedValue(merged, ['enhancedarticlewriter.content', 'enhanced_article', 'article', 'content']),
    )
    const articleStr = articleTextFrom(articleValue)
    if (articleStr.trim()) {
      markSectionStreaming('article')
      updateArticle(articleStr)
    }

    const strengths = findMergedValue(merged, ['gapanalysis.competitor_strengths', 'competitor_strengths'])
    const gaps = findMergedValue(merged, ['gapanalysis.coverage_gaps', 'coverage_gaps'])
    const under = findMergedValue(merged, [
      'gapanalysis.underdeveloped_sections',
      'underdeveloped_sections',
    ])
    if (strengths !== undefined || gaps !== undefined || under !== undefined) {
      const data = normalizeGapAnalysis({
        competitor_strengths: parseIfJsonLike(strengths),
        coverage_gaps: parseIfJsonLike(gaps),
        underdeveloped_sections: parseIfJsonLike(under),
      })
      if (data && !isGapEmpty(data)) {
        const prev = gapRef.current
        if (!prev || gapTotal(data) >= gapTotal(prev)) {
          gapRef.current = data
          dataPresentRef.current.gapanalysis = true
          markSectionStreaming('gapanalysis')
          setGapData(data)
        }
      }
    }

    const recs = findMergedValue(merged, ['recommendations.recommendations', 'recommendations'])
    const citations = findMergedValue(merged, [
      'recommendations.citation_opportunities',
      'citation_opportunities',
    ])
    const faqs = findMergedValue(merged, ['recommendations.faq_suggestions', 'faq_suggestions'])
    if (recs !== undefined || citations !== undefined || faqs !== undefined) {
      const data = normalizeRecommendations({
        recommendations: parseIfJsonLike(recs),
        citation_opportunities: parseIfJsonLike(citations),
        faq_suggestions: parseIfJsonLike(faqs),
      })
      if (data && data.recommendations.length > 0) {
        const prevCount = recRef.current ? recRef.current.recommendations.length : 0
        if (data.recommendations.length >= prevCount) {
          recRef.current = data
          dataPresentRef.current.recommendations = true
          markSectionStreaming('recommendations')
          setRecData(data)
        }
      }
    }

    const score = findMergedValue(merged, ['coverageverifier.overall_score', 'overall_score'])
    const passed = findMergedValue(merged, ['coverageverifier.passed', 'passed'])
    const summary = findMergedValue(merged, ['coverageverifier.summary', 'summary'])
    const criteria = findMergedValue(merged, ['coverageverifier.criteria', 'criteria'])
    if (score !== undefined || passed !== undefined || summary !== undefined || criteria !== undefined) {
      const data = normalizeCoverage({
        overall_score: parseIfJsonLike(score),
        passed: parseIfJsonLike(passed),
        summary: parseIfJsonLike(summary),
        criteria: parseIfJsonLike(criteria),
      })
      if (data && !isCovEmpty(data)) {
        covRef.current = data
        dataPresentRef.current.coverage = true
        markSectionStreaming('coverage')
        setCoverage(data)
      }
    }
  }

  function handleStreamEvent(rec: Record<string, unknown>): void {
    const eventError = typeof rec.error === 'string' && rec.error.trim() ? rec.error.trim() : ''
    if (eventError) {
      doneRef.current = true
      setPhase('error')
      setErrorMessage(eventError)
      return
    }

    const message = firstStringOf(rec, ['message', 'status'])
    if (message && isHeartbeatMessage(message)) {
      setStatusMessage(message)
    }

    const blockId = firstStringOf(rec, [
      'blockId',
      'blockid',
      'block_id',
      'blockName',
      'blockname',
      'block',
      'name',
    ])
    const chunk = chunkTextOf(rec)

    if (chunk) {
      let target: BlockTarget | null = null
      if (blockId) {
        target = blockTargetRef.current[blockId] ?? resolveBlockTarget(blockId)
        if (target) blockTargetRef.current[blockId] = target
      }
      if (target === 'status-theme' || target === 'status-research') {
        setStatusMessage(statusLabelFor(target))
      } else if (target && isPanelKey(target)) {
        targetAccumRef.current[target] += chunk
        markSectionStreaming(target)
        applyPanelData(target, targetAccumRef.current[target])
      } else if (blockId) {
        blockAccumRef.current[blockId] = (blockAccumRef.current[blockId] ?? '') + chunk
        const classified = classifyUnknownPayload(blockAccumRef.current[blockId])
        if (classified) {
          blockTargetRef.current[blockId] = classified
          targetAccumRef.current[classified] += blockAccumRef.current[blockId]
          blockAccumRef.current[blockId] = ''
          markSectionStreaming(classified)
          applyPanelData(classified, targetAccumRef.current[classified])
        }
      } else if (!isHeartbeatMessage(chunk)) {
        looseTextRef.current += chunk
        const classified = classifyUnknownPayload(looseTextRef.current)
        if (classified) {
          markSectionStreaming(classified)
          applyPanelData(classified, looseTextRef.current)
        }
      }
    }

    // Merge any structured outputs carried on this event and apply them
    // immediately - the UI renders as soon as usable data appears.
    const merged = finalOutputRef.current ?? {}
    collectStructured(rec, merged, 0)
    finalOutputRef.current = merged
    applyMergedOutputs()

    const eventType = firstStringOf(rec, ['event', 'type']).toLowerCase()
    if (eventType === 'done' || rec.done === true) {
      finalizeRun()
    }
  }

  function processStreamLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    const dataText = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed
    if (!dataText) return
    if (dataText === '[DONE]') {
      finalizeRun()
      return
    }
    rawTranscriptRef.current += `${dataText}\n`
    let parsed: unknown = null
    if (dataText.startsWith('{') || dataText.startsWith('[')) {
      parsed = extractBalancedJson(dataText)
    }
    const rec = asRecord(parsed)
    if (rec) {
      handleStreamEvent(rec)
      return
    }
    // Plain text line: heartbeat/progress messages update the status chip;
    // everything else is loose content that gets classified semantically.
    if (isHeartbeatMessage(dataText)) {
      setStatusMessage(dataText)
      return
    }
    looseTextRef.current += `${dataText}\n`
    const panel = classifyUnknownPayload(looseTextRef.current)
    if (panel) {
      markSectionStreaming(panel)
      applyPanelData(panel, looseTextRef.current)
    }
  }

  async function readSseStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '')
        buffer = buffer.slice(newlineIndex + 1)
        processStreamLine(line)
        newlineIndex = buffer.indexOf('\n')
      }
      if (doneRef.current) break
    }
    if (buffer.trim()) processStreamLine(buffer)
  }

  function finalizeRun(): void {
    if (doneRef.current) return
    doneRef.current = true

    // Flush any per-panel accumulations that never produced a usable render.
    for (const panel of ALL_PANELS) {
      if (!dataPresentRef.current[panel] && targetAccumRef.current[panel].trim()) {
        applyPanelData(panel, targetAccumRef.current[panel])
      }
    }

    // Salvage pass: mine the full raw transcript for panels still empty.
    const raw = rawTranscriptRef.current
    if (raw) {
      if (!dataPresentRef.current.article) {
        const text = articleTextFrom(extractKeyValue(raw, 'content'))
        if (text.trim()) updateArticle(text)
      }
      if (!dataPresentRef.current.gapanalysis) {
        const data = normalizeGapAnalysis({
          competitor_strengths: extractKeyValue(raw, 'competitor_strengths'),
          coverage_gaps: extractKeyValue(raw, 'coverage_gaps'),
          underdeveloped_sections: extractKeyValue(raw, 'underdeveloped_sections'),
        })
        if (data && !isGapEmpty(data)) {
          gapRef.current = data
          dataPresentRef.current.gapanalysis = true
          setGapData(data)
        }
      }
      if (!dataPresentRef.current.recommendations) {
        const data = normalizeRecommendations({
          recommendations: extractKeyValue(raw, 'recommendations'),
          citation_opportunities: extractKeyValue(raw, 'citation_opportunities'),
          faq_suggestions: extractKeyValue(raw, 'faq_suggestions'),
        })
        if (data && data.recommendations.length > 0) {
          recRef.current = data
          dataPresentRef.current.recommendations = true
          setRecData(data)
        }
      }
      if (!dataPresentRef.current.coverage) {
        const data = normalizeCoverage({
          overall_score: extractKeyValue(raw, 'overall_score'),
          passed: extractKeyValue(raw, 'passed'),
          summary: extractKeyValue(raw, 'summary'),
          criteria: extractKeyValue(raw, 'criteria'),
        })
        if (data && !isCovEmpty(data)) {
          covRef.current = data
          dataPresentRef.current.coverage = true
          setCoverage(data)
        }
      }
    }

    // IMPORTANT (Enhanced Article blanking fix): finalize NEVER clears the
    // article content. Sections flip to done/empty based on whether data was
    // ever received, and the rendered content state is left untouched.
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const nextErrors: EnhanceFormErrors = {}
    const url = articleUrl.trim()
    const text = articleText.trim()
    if (!url && !text) {
      nextErrors.articleUrl = 'Provide an article URL or paste the article text below.'
      nextErrors.articleText = 'Provide an article URL above or paste the article text.'
    }
    if (url && !/^https?:\/\//i.test(url)) {
      nextErrors.articleUrl = 'Enter a valid http(s) URL.'
    }
    if (!contentType) {
      nextErrors.contentType = 'Select a content type.'
    }
    if (contentType === 'Other' && !otherType.trim()) {
      nextErrors.otherType = 'Describe the content type.'
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    resetRun()
    const payload: EnhancePayload = {
      article_url: url,
      article_text: text,
      content_type: contentType === 'Other' ? otherType.trim() : contentType,
    }
    lastPayloadRef.current = payload
    setSubmittedUrl(url)
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
      const ct = res.headers.get('content-type') ?? ''
      if (ct.includes('application/json')) {
        // Non-streamed fallback: apply the whole JSON body at once.
        const data: unknown = await res.json()
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
      if (!res.body) {
        throw new Error('The enhancement service returned an empty response.')
      }
      await readSseStream(res.body)
      finalizeRun()
    } catch (err) {
      if (controller.signal.aborted) return
      doneRef.current = true
      setPhase('error')
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    }
  }

  function handleRetry(): void {
    setPhase('idle')
    setErrorMessage('')
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
  const streaming = phase === 'streaming'

  return (
    <div>
      <div className="screen-only">
        <form
          noValidate
          onSubmit={(event) => {
            void handleSubmit(event)
          }}
          className="card-enter mx-auto w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8"
        >
          <div className="space-y-5">
            <div>
              <label htmlFor="article-url" className="mb-1.5 block text-sm font-medium text-ink">
                Article URL
              </label>
              <input
                id="article-url"
                type="url"
                value={articleUrl}
                onChange={(event) => setArticleUrl(event.target.value)}
                placeholder="https://example.com/blog/my-article"
                disabled={streaming}
                className={`${inputBase} ${errors.articleUrl ? 'border-rose-300' : 'border-slate-200'}`}
              />
              {errors.articleUrl ? (
                <p className="mt-1 text-xs text-rose-600">{errors.articleUrl}</p>
              ) : null}
            </div>
            <div>
              <label htmlFor="article-text" className="mb-1.5 block text-sm font-medium text-ink">
                Article text{' '}
                <span className="font-normal text-ink-soft">(optional when a URL is provided)</span>
              </label>
              <textarea
                id="article-text"
                rows={6}
                value={articleText}
                onChange={(event) => setArticleText(event.target.value)}
                placeholder="Paste the full article text here…"
                disabled={streaming}
                className={`${inputBase} resize-y ${errors.articleText ? 'border-rose-300' : 'border-slate-200'}`}
              />
              {errors.articleText ? (
                <p className="mt-1 text-xs text-rose-600">{errors.articleText}</p>
              ) : null}
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label htmlFor="content-type" className="mb-1.5 block text-sm font-medium text-ink">
                  Content type
                </label>
                <select
                  id="content-type"
                  value={contentType}
                  onChange={(event) => setContentType(event.target.value)}
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
                  <p className="mt-1 text-xs text-rose-600">{errors.contentType}</p>
                ) : null}
              </div>
              {contentType === 'Other' ? (
                <div>
                  <label htmlFor="other-type" className="mb-1.5 block text-sm font-medium text-ink">
                    Describe the content type
                  </label>
                  <input
                    id="other-type"
                    type="text"
                    value={otherType}
                    onChange={(event) => setOtherType(event.target.value)}
                    placeholder="e.g. Comparison review"
                    disabled={streaming}
                    className={`${inputBase} ${errors.otherType ? 'border-rose-300' : 'border-slate-200'}`}
                  />
                  {errors.otherType ? (
                    <p className="mt-1 text-xs text-rose-600">{errors.otherType}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={streaming}
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-60"
              >
                {streaming ? 'Enhancing…' : 'Enhance article'}
              </button>
              {streaming ? (
                <StatusChip
                  message={statusMessage || 'Enhancing your article…'}
                  elapsedSeconds={elapsed}
                  phase={phase}
                />
              ) : null}
            </div>
          </div>
        </form>

        {streaming ? (
          <div className="mt-6">
            <ProgressChecklist stages={checklistStages} />
          </div>
        ) : null}

        {phase === 'error' ? (
          <div className="mt-6">
            <ErrorCard
              message={errorMessage || 'Something went wrong. Please try again.'}
              onRetry={handleRetry}
            />
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
