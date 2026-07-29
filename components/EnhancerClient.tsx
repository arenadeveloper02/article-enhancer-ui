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
    setStages((prev) => (prev[stage] === 'pending' ? { ...prev, [stage]: 'active' } : prev))
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

  function routeChunk(blockId: string, chunk: string): void {
    blockAccumRef.current[blockId] = (blockAccumRef.current[blockId] ?? '') + chunk
    let target: BlockTarget | undefined = blockTargetRef.current[blockId]
    if (!target) {
      const resolved = resolveBlockTarget(blockId)
      if (resolved) target = resolved
    }
    if (!target) {
      const classified = classifyUnknownPayload(blockAccumRef.current[blockId])
      if (classified) target = classified
    }
    if (!target) return
    blockTargetRef.current[blockId] = target
    if (target === 'status-theme' || target === 'status-research') {
      setStatusMessage(statusLabelFor(target))
      return
    }
    applyPanel(target)
  }

  function routeLooseText(text: string): void {
    looseTextRef.current += text
    const classified = classifyUnknownPayload(looseTextRef.current)
    if (!classified) return
    blockAccumRef.current['__loose__'] = looseTextRef.current
    blockTargetRef.current['__loose__'] = classified
    applyPanel(classified)
  }

  function applyMergedOutputs(): void {
    const merged = finalOutputRef.current
    if (!merged) return
    if (!dataPresentRef.current.article) {
      const raw = findMergedValue(merged, [
        'enhancedarticlewriter.content',
        'content',
        'article',
        'enhanced_article',
        'markdown',
      ])
      const article = articleTextFrom(parseIfJsonLike(raw))
      if (article.trim() && !isHeartbeatMessage(article)) {
        dataPresentRef.current.article = true
        setContent(article)
        markPanelStreaming('article')
      }
    }
    {
      const strengths = findMergedValue(merged, ['gapanalysis.competitor_strengths', 'competitor_strengths'])
      const gaps = findMergedValue(merged, ['gapanalysis.coverage_gaps', 'coverage_gaps'])
      const under = findMergedValue(merged, [
        'gapanalysis.underdeveloped_sections',
        'underdeveloped_sections',
      ])
      if (strengths !== undefined || gaps !== undefined || under !== undefined) {
        const data = normalizeGapAnalysis({
          competitor_strengths: strengths ?? [],
          coverage_gaps: gaps ?? [],
          underdeveloped_sections: under ?? [],
        })
        if (!isGapEmpty(data)) {
          gapRef.current = data
          dataPresentRef.current.gapanalysis = true
          setGapData(data)
          markPanelStreaming('gapanalysis')
        }
      }
    }
    {
      const recs = findMergedValue(merged, ['recommendations.recommendations', 'recommendations'])
      if (recs !== undefined) {
        const data = normalizeRecommendations(recs)
        if (data.recommendations.length > 0) {
          recRef.current = data
          dataPresentRef.current.recommendations = true
          setRecData(data)
          markPanelStreaming('recommendations')
        }
      }
    }
    {
      const score = findMergedValue(merged, ['coverageverifier.overall_score', 'overall_score'])
      const passed = findMergedValue(merged, ['coverageverifier.passed', 'passed'])
      const summary = findMergedValue(merged, ['coverageverifier.summary', 'summary'])
      const criteria = findMergedValue(merged, ['coverageverifier.criteria', 'criteria'])
      if (score !== undefined || passed !== undefined || summary !== undefined || criteria !== undefined) {
        const data = normalizeCoverage({ overall_score: score, passed, summary, criteria })
        if (!isCovEmpty(data)) {
          covRef.current = data
          dataPresentRef.current.coverage = true
          setCoverage(data)
          markPanelStreaming('coverage')
        }
      }
    }
  }

  function mergeStructured(payload: Record<string, unknown>): void {
    const merged = finalOutputRef.current ?? {}
    collectStructured(payload, merged, 0)
    finalOutputRef.current = merged
    if (Object.keys(merged).length > 0) applyMergedOutputs()
  }

  function salvageFromTranscript(): void {
    const transcript = rawTranscriptRef.current
    if (!transcript.trim()) return
    if (!dataPresentRef.current.article) {
      const fromPanel = articleFromAccumulated(targetAccumRef.current.article)
      const fromTranscript = articleTextFrom(extractKeyValue(transcript, 'content'))
      const article = fromPanel.trim() ? fromPanel : fromTranscript
      if (article.trim() && !isHeartbeatMessage(article)) {
        dataPresentRef.current.article = true
        setContent(article)
      }
    }
    if (!dataPresentRef.current.gapanalysis) {
      const strengths = extractKeyValue(transcript, 'competitor_strengths')
      const gaps = extractKeyValue(transcript, 'coverage_gaps')
      const under = extractKeyValue(transcript, 'underdeveloped_sections')
      let data: GapAnalysisData | null = null
      if (strengths !== undefined || gaps !== undefined || under !== undefined) {
        data = normalizeGapAnalysis({
          competitor_strengths: strengths ?? [],
          coverage_gaps: gaps ?? [],
          underdeveloped_sections: under ?? [],
        })
      } else if (targetAccumRef.current.gapanalysis.trim()) {
        data = normalizeGapAnalysis(targetAccumRef.current.gapanalysis)
      }
      if (data && !isGapEmpty(data)) {
        gapRef.current = data
        dataPresentRef.current.gapanalysis = true
        setGapData(data)
      }
    }
    if (!dataPresentRef.current.recommendations) {
      const recs = extractKeyValue(transcript, 'recommendations')
      let data: RecommendationsData | null = null
      if (recs !== undefined) {
        data = normalizeRecommendations(recs)
      } else if (targetAccumRef.current.recommendations.trim()) {
        data = normalizeRecommendations(targetAccumRef.current.recommendations)
      }
      if (data && data.recommendations.length > 0) {
        recRef.current = data
        dataPresentRef.current.recommendations = true
        setRecData(data)
      }
    }
    if (!dataPresentRef.current.coverage) {
      const score = extractKeyValue(transcript, 'overall_score')
      const passed = extractKeyValue(transcript, 'passed')
      const summary = extractKeyValue(transcript, 'summary')
      const criteria = extractKeyValue(transcript, 'criteria')
      let data: CoverageData | null = null
      if (score !== undefined || passed !== undefined || summary !== undefined || criteria !== undefined) {
        data = normalizeCoverage({ overall_score: score, passed, summary, criteria })
      } else if (targetAccumRef.current.coverage.trim()) {
        data = normalizeCoverage(targetAccumRef.current.coverage)
      }
      if (data && !isCovEmpty(data)) {
        covRef.current = data
        dataPresentRef.current.coverage = true
        setCoverage(data)
      }
    }
  }

  function finalizeRun(): void {
    if (doneRef.current) return
    doneRef.current = true
    salvageFromTranscript()
    applyMergedOutputs()
    const present = dataPresentRef.current
    setSections({
      article: present.article ? 'done' : 'empty',
      gapanalysis: present.gapanalysis ? 'done' : 'empty',
      recommendations: present.recommendations ? 'done' : 'empty',
      coverage: present.coverage ? 'done' : 'empty',
    })
    setStages({
      gapanalysis: 'done',
      recommendations: 'done',
      enhancedarticlewriter: 'done',
      coverageverifier: 'done',
    })
    setStatusMessage('')
    const anyData = present.article || present.gapanalysis || present.recommendations || present.coverage
    if (anyData) {
      setPhase('done')
    } else {
      setErrorMessage(
        (prev) => prev || 'The enhancement service finished without returning any content. Please try again.',
      )
      setPhase('error')
    }
  }

  function processStreamPayload(dataText: string): void {
    rawTranscriptRef.current += `${dataText}\n`
    if (dataText === '[DONE]' || dataText === 'DONE') {
      finalizeRun()
      return
    }
    let parsed: unknown = null
    if (dataText.startsWith('{') || dataText.startsWith('[')) {
      parsed = extractBalancedJson(dataText)
    }
    const rec = asRecord(parsed)
    if (!rec) {
      if (isHeartbeatMessage(dataText)) {
        setStatusMessage(dataText.trim())
        return
      }
      routeLooseText(dataText)
      return
    }
    const lowerRec: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(rec)) lowerRec[key.toLowerCase()] = value

    const statusText = firstStringOf(lowerRec, ['message', 'status'])
    if (statusText && isHeartbeatMessage(statusText)) setStatusMessage(statusText)

    const eventName = firstStringOf(lowerRec, ['event', 'type']).toLowerCase()
    if (eventName === 'done' || lowerRec.done === true) {
      mergeStructured(rec)
      finalizeRun()
      return
    }

    const blockId = firstStringOf(lowerRec, ['blockid', 'block_id', 'blockname'])
    let chunk = ''
    for (const key of ['chunk', 'delta', 'text']) {
      const value = lowerRec[key]
      if (typeof value === 'string' && value) {
        chunk = value
        break
      }
    }

    if (blockId && chunk) {
      routeChunk(blockId, chunk)
    } else if (chunk && !isHeartbeatMessage(chunk)) {
      routeLooseText(chunk)
    }

    mergeStructured(rec)
  }

  function handleStreamLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    if (trimmed.startsWith(':')) return
    if (trimmed.startsWith('event:') || trimmed.startsWith('id:') || trimmed.startsWith('retry:')) return
    const dataText = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed
    if (!dataText) return
    processStreamPayload(dataText)
  }

  async function runEnhancement(payload: EnhancePayload): Promise<void> {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    lastPayloadRef.current = payload
    resetRun()
    setSubmittedUrl(payload.article_url)
    setPhase('streaming')
    setStatusMessage('Starting enhancement…')
    startRef.current = Date.now()
    setElapsed(0)

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
      const contentTypeHeader = res.headers.get('content-type') ?? ''
      if (contentTypeHeader.includes('application/json')) {
        const text = await res.text()
        rawTranscriptRef.current += `${text}\n`
        const parsedBody = extractBalancedJson(text)
        const recBody = asRecord(parsedBody)
        if (recBody) mergeStructured(recBody)
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
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let newlineIndex = buffer.indexOf('\n')
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).replace(/\r$/, '')
          buffer = buffer.slice(newlineIndex + 1)
          handleStreamLine(line)
          newlineIndex = buffer.indexOf('\n')
        }
      }
      buffer += decoder.decode()
      if (buffer.trim()) handleStreamLine(buffer)
      if (!doneRef.current) finalizeRun()
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (!doneRef.current) finalizeRun()
        return
      }
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setStatusMessage('')
      setPhase('error')
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const nextErrors: EnhanceFormErrors = {}
    const url = articleUrl.trim()
    if (!url) {
      nextErrors.articleUrl = 'Article URL is required.'
    } else {
      try {
        const parsedUrl = new URL(url)
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          nextErrors.articleUrl = 'Enter a valid http(s) URL.'
        }
      } catch {
        nextErrors.articleUrl = 'Enter a valid URL (including https://).'
      }
    }
    // Article text is OPTIONAL — when left empty the agent reads the article
    // straight from the URL.
    if (!contentType) {
      nextErrors.contentType = 'Select a content type.'
    }
    if (contentType === 'Other' && !otherType.trim()) {
      nextErrors.otherType = 'Describe the content type.'
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    const payload: EnhancePayload = {
      article_url: url,
      article_text: articleText.trim(),
      content_type: contentType === 'Other' ? otherType.trim() : contentType,
    }
    await runEnhancement(payload)
  }

  function handleCancel(): void {
    abortRef.current?.abort()
  }

  function handleRetry(): void {
    const last = lastPayloadRef.current
    if (last) void runEnhancement(last)
  }

  /**
   * Export/Print: prints THIS page. The print-only PrintableReport below
   * reuses the exact same components as the on-screen UI, and app/globals.css
   * carries the @media print stylesheet (A4, fixed margins, page-break rules,
   * no UI chrome). We wait for every font to be ready so nothing prints
   * half-rendered with fallback system fonts.
   */
  async function handleExport(): Promise<void> {
    try {
      await document.fonts.ready
    } catch {
      // Font loading state unavailable — print anyway.
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
    <>
      <div className="screen-only mx-auto max-w-5xl">
        <form
          onSubmit={(event) => void handleSubmit(event)}
          noValidate
          className="card-enter mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"
        >
          <div className="space-y-4">
            <div>
              <label
                htmlFor="article-url"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-soft"
              >
                Article URL
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
              {errors.articleUrl && (
                <p className="mt-1 text-xs font-medium text-rose-600">{errors.articleUrl}</p>
              )}
            </div>
            <div>
              <label
                htmlFor="article-text"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-soft"
              >
                Article text <span className="font-normal normal-case text-slate-400">(optional)</span>
              </label>
              <textarea
                id="article-text"
                rows={7}
                value={articleText}
                onChange={(event) => setArticleText(event.target.value)}
                placeholder="Paste the full article text here — or leave it empty and the agent will read the article from the URL."
                disabled={phase === 'streaming'}
                className={`${inputBase} resize-y ${errors.articleText ? 'border-rose-300' : 'border-slate-200'}`}
              />
              {errors.articleText && (
                <p className="mt-1 text-xs font-medium text-rose-600">{errors.articleText}</p>
              )}
            </div>
            <fieldset>
              <legend className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-soft">
                Content type
              </legend>
              <div className="flex flex-wrap gap-2">
                {CONTENT_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setContentType(type)}
                    disabled={phase === 'streaming'}
                    aria-pressed={contentType === type}
                    className={`rounded-full border px-4 py-2 text-xs font-semibold transition focus:outline-none focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 ${
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
                <p className="mt-1 text-xs font-medium text-rose-600">{errors.contentType}</p>
              )}
            </fieldset>
            {contentType === 'Other' && (
              <div>
                <label
                  htmlFor="other-type"
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-soft"
                >
                  Describe the content type
                </label>
                <input
                  id="other-type"
                  type="text"
                  value={otherType}
                  onChange={(event) => setOtherType(event.target.value)}
                  placeholder="e.g. Comparison page, FAQ, Whitepaper"
                  disabled={phase === 'streaming'}
                  className={`${inputBase} ${errors.otherType ? 'border-rose-300' : 'border-slate-200'}`}
                />
                {errors.otherType && (
                  <p className="mt-1 text-xs font-medium text-rose-600">{errors.otherType}</p>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={phase === 'streaming'}
                className="inline-flex items-center rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-deep focus:outline-none focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {phase === 'streaming' ? 'Enhancing…' : 'Enhance Article'}
              </button>
              {phase === 'streaming' && (
                <button
                  type="button"
                  onClick={handleCancel}
                  className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-ink-soft transition hover:border-rose-200 hover:text-rose-600 focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
                >
                  Cancel
                </button>
              )}
              {hasResults && phase !== 'streaming' && (
                <button
                  type="button"
                  onClick={() => void handleExport()}
                  className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-accent-deep transition hover:bg-indigo-100 focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span aria-hidden="true">⎙</span> Export / Print
                </button>
              )}
            </div>
          </div>
        </form>

        {phase !== 'idle' && (
          <div className="mt-6 space-y-4">
            {phase === 'streaming' && statusMessage && (
              <div className="flex justify-center">
                <StatusChip message={statusMessage} elapsedSeconds={elapsed} />
              </div>
            )}
            <ProgressChecklist stages={checklistStages} />
            {phase === 'error' && errorMessage ? (
              <ErrorCard message={errorMessage} onRetry={handleRetry} />
            ) : (
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
        )}
      </div>

      {/* Print-only mirror — reuses the exact same UI components, shown only
          inside @media print (see app/globals.css). */}
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
    </>
  )
}
