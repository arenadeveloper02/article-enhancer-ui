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
  splitArticleSegments,
} from '@/lib/normalize'
import { StatusChip } from '@/components/StatusChip'
import { ErrorCard } from '@/components/ErrorCard'
import { ProgressChecklist } from '@/components/ProgressChecklist'
import type { ChecklistStage } from '@/components/ProgressChecklist'
import { ResultTabs } from '@/components/ResultTabs'

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

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function gapEntryText(entry: string | { title: string; detail?: string }): string {
  if (typeof entry === 'string') return entry
  return entry.detail ? `${entry.title} — ${entry.detail}` : entry.title
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

function buildPrintableHtml(
  content: string,
  gap: GapAnalysisData | null,
  rec: RecommendationsData | null,
  cov: CoverageData | null,
): string {
  const sections: string[] = []
  if (content.trim()) {
    const articleHtml = splitArticleSegments(content)
      .map((segment) =>
        segment.added
          ? `<span class="added">${escapeHtml(segment.text)}</span>`
          : escapeHtml(segment.text),
      )
      .join('')
    sections.push(
      `<section><h2>Enhanced Article</h2><div class="article">${articleHtml}</div></section>`,
    )
  }
  if (cov) {
    const rows = cov.criteria
      .map(
        (c) =>
          `<li><strong>${escapeHtml(c.name)}</strong>${
            c.passed === true ? ' — Pass' : c.passed === false ? ' — Fail' : ''
          }${typeof c.score === 'number' ? ` (${Math.round(c.score)})` : ''}${
            c.notes ? `<br/><em>${escapeHtml(c.notes)}</em>` : ''
          }</li>`,
      )
      .join('')
    sections.push(
      `<section><h2>Coverage Verification</h2><p>Overall score: ${
        cov.overall_score !== null ? Math.round(cov.overall_score) : 'n/a'
      } / 100 · ${
        cov.passed === true ? 'Pass' : cov.passed === false ? 'Fail' : 'Not determined'
      }</p>${cov.summary ? `<p>${escapeHtml(cov.summary)}</p>` : ''}${rows ? `<ul>${rows}</ul>` : ''}</section>`,
    )
  }
  if (gap) {
    const group = (title: string, items: Array<string | { title: string; detail?: string }>): string =>
      items.length > 0
        ? `<h3>${title}</h3><ul>${items.map((i) => `<li>${escapeHtml(gapEntryText(i))}</li>`).join('')}</ul>`
        : ''
    const body =
      group('Competitor Strengths', gap.competitor_strengths) +
      group('Coverage Gaps', gap.coverage_gaps) +
      group('Underdeveloped Sections', gap.underdeveloped_sections)
    if (body) sections.push(`<section><h2>Gap Analysis</h2>${body}</section>`)
  }
  if (rec && rec.recommendations.length > 0) {
    sections.push(
      `<section><h2>Recommendations</h2><ol>${rec.recommendations
        .map(
          (r) =>
            `<li><strong>${escapeHtml(r.title)}</strong>${
              r.priority ? ` [${escapeHtml(r.priority)}]` : ''
            }${r.detail ? `<br/>${escapeHtml(r.detail)}` : ''}</li>`,
        )
        .join('')}</ol></section>`,
    )
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Article Enhancer Output</title><style>body{font-family:Poppins,Georgia,serif;max-width:720px;margin:32px auto;padding:0 24px;color:#2C2D33;line-height:1.6}h1{font-size:24px}h2{font-size:19px;margin-top:28px;border-bottom:1px solid #E2E3E5;padding-bottom:6px}h3{font-size:15px;margin-top:18px}.article{white-space:pre-wrap}.added{background:#D1E3FA;color:#10458B;border-radius:3px;padding:0 2px;-webkit-box-decoration-break:clone;box-decoration-break:clone;-webkit-print-color-adjust:exact;print-color-adjust:exact}li{margin-bottom:6px}@media print{body{margin:0;max-width:none}}</style></head><body><h1>Article Enhancer Output</h1>${sections.join('')}</body></html>`
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
  const streamErrorRef = useRef('')
  const lastPayloadRef = useRef<EnhancePayload | null>(null)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (phase !== 'streaming') return
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }, 1000)
    return () => window.clearInterval(id)
  }, [phase])

  function validate(): boolean {
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
        next.articleUrl = 'Enter a valid URL, e.g. https://example.com/post'
      }
    }
    if (!articleText.trim()) {
      next.articleText = 'Article text is required.'
    }
    if (!contentType) {
      next.contentType = 'Choose a content type.'
    } else if (contentType === 'Other' && !otherType.trim()) {
      next.otherType = 'Describe your content type.'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function resetRun(): void {
    abortRef.current?.abort()
    doneRef.current = false
    streamErrorRef.current = ''
    looseTextRef.current = ''
    rawTranscriptRef.current = ''
    finalOutputRef.current = null
    targetAccumRef.current = { article: '', gapanalysis: '', recommendations: '', coverage: '' }
    blockAccumRef.current = {}
    blockTargetRef.current = {}
    gapRef.current = null
    recRef.current = null
    covRef.current = null
    dataPresentRef.current = { article: false, gapanalysis: false, recommendations: false, coverage: false }
    setContent('')
    setGapData(null)
    setRecData(null)
    setCoverage(null)
    setStages({ ...INITIAL_STAGES, gapanalysis: 'active' })
    setSections({ ...INITIAL_SECTIONS })
    setErrorMessage('')
    setStatusMessage('Contacting the enhancement service…')
    setElapsed(0)
    startRef.current = Date.now()
    setPhase('streaming')
  }

  function markSection(key: PanelKey, status: SectionStatus): void {
    setSections((prev) => (prev[key] === status ? prev : { ...prev, [key]: status }))
  }

  function markStageActive(id: StageId): void {
    setStages((prev) => {
      if (prev[id] === 'done' || prev[id] === 'active') return prev
      const next: Record<StageId, StageStatus> = { ...prev }
      const idx = STAGE_ORDER.indexOf(id)
      STAGE_ORDER.forEach((stage, i) => {
        if (i < idx && next[stage] !== 'done') next[stage] = 'done'
      })
      next[id] = 'active'
      return next
    })
  }

  function applyGapPayload(raw: unknown): void {
    const data = normalizeGapAnalysis(raw)
    if (isGapEmpty(data)) return
    gapRef.current = data
    setGapData(data)
    dataPresentRef.current.gapanalysis = true
    markSection('gapanalysis', 'streaming')
  }

  function applyRecPayload(raw: unknown): void {
    const data = normalizeRecommendations(raw)
    if (data.recommendations.length === 0) return
    recRef.current = data
    setRecData(data)
    dataPresentRef.current.recommendations = true
    markSection('recommendations', 'streaming')
  }

  function applyCoveragePayload(raw: unknown): void {
    const data = normalizeCoverage(raw)
    if (isCovEmpty(data)) return
    covRef.current = data
    setCoverage(data)
    dataPresentRef.current.coverage = true
    markSection('coverage', 'streaming')
  }

  function routeAccumulated(target: BlockTarget, accumulated: string): void {
    if (target === 'status-theme' || target === 'status-research') {
      setStatusMessage(statusLabelFor(target))
      return
    }
    if (target === 'article') {
      const display = articleFromAccumulated(accumulated)
      if (display.trim()) {
        targetAccumRef.current.article = display
        dataPresentRef.current.article = true
        setContent(display)
        markSection('article', 'streaming')
        markStageActive('enhancedarticlewriter')
      }
      return
    }
    targetAccumRef.current[target] = accumulated
    markSection(target, 'streaming')
    markStageActive(STAGE_FOR_PANEL[target])
    if (target === 'gapanalysis') {
      applyGapPayload(accumulated)
    } else if (target === 'recommendations') {
      applyRecPayload(accumulated)
    } else {
      applyCoveragePayload(accumulated)
    }
  }

  function applyMergedOutputs(): void {
    const merged = finalOutputRef.current
    if (!merged) return
    const articleVal = findMergedValue(merged, [
      'enhancedarticlewriter.content',
      'enhancedarticlewriter',
      'content',
      'article',
    ])
    const articleTextValue = articleTextFrom(articleVal)
    if (articleTextValue.trim() && articleTextValue.trim().length > targetAccumRef.current.article.trim().length) {
      targetAccumRef.current.article = articleTextValue
      dataPresentRef.current.article = true
      setContent(articleTextValue)
      markSection('article', 'streaming')
    }
    const gapStrengths = findMergedValue(merged, ['gapanalysis.competitor_strengths', 'competitor_strengths'])
    const gapGaps = findMergedValue(merged, ['gapanalysis.coverage_gaps', 'coverage_gaps'])
    const gapUnder = findMergedValue(merged, ['gapanalysis.underdeveloped_sections', 'underdeveloped_sections'])
    if (gapStrengths !== undefined || gapGaps !== undefined || gapUnder !== undefined) {
      applyGapPayload({
        competitor_strengths: gapStrengths,
        coverage_gaps: gapGaps,
        underdeveloped_sections: gapUnder,
      })
    } else {
      const gapWhole = findMergedValue(merged, ['gapanalysis'])
      if (gapWhole !== undefined) applyGapPayload(gapWhole)
    }
    const recVal = findMergedValue(merged, ['recommendations.recommendations', 'recommendations'])
    if (recVal !== undefined) applyRecPayload(recVal)
    const covScore = findMergedValue(merged, ['coverageverifier.overall_score', 'overall_score'])
    const covPassed = findMergedValue(merged, ['coverageverifier.passed', 'passed'])
    const covSummary = findMergedValue(merged, ['coverageverifier.summary', 'summary'])
    const covCriteria = findMergedValue(merged, ['coverageverifier.criteria', 'criteria'])
    if (
      covScore !== undefined ||
      covPassed !== undefined ||
      covSummary !== undefined ||
      covCriteria !== undefined
    ) {
      applyCoveragePayload({
        overall_score: covScore,
        passed: covPassed,
        summary: covSummary,
        criteria: covCriteria,
      })
    } else {
      const covWhole = findMergedValue(merged, ['coverageverifier'])
      if (covWhole !== undefined) applyCoveragePayload(covWhole)
    }
  }

  function mergeStructured(obj: Record<string, unknown>): void {
    const merged: Record<string, unknown> = finalOutputRef.current ?? {}
    let changed = false
    const visit = (source: Record<string, unknown>, depth: number): void => {
      if (depth > 4) return
      for (const [key, value] of Object.entries(source)) {
        const lower = key.toLowerCase()
        if (RESERVED_KEYS.has(lower)) continue
        if (lower === 'output' || lower === 'outputs' || lower === 'result' || lower === 'data') {
          const inner = asRecord(parseIfJsonLike(value))
          if (inner) visit(inner, depth + 1)
          continue
        }
        merged[lower] = parseIfJsonLike(value)
        changed = true
      }
    }
    visit(obj, 0)
    if (changed) {
      finalOutputRef.current = merged
      applyMergedOutputs()
    }
  }

  function handleEventObject(obj: Record<string, unknown>): void {
    const eventType =
      typeof obj.event === 'string' ? obj.event : typeof obj.type === 'string' ? obj.type : ''
    if (eventType.toLowerCase() === 'error' || obj.success === false) {
      const msg =
        typeof obj.error === 'string'
          ? obj.error
          : typeof obj.message === 'string'
            ? obj.message
            : ''
      if (msg) streamErrorRef.current = msg
    }
    if (typeof obj.message === 'string' && isHeartbeatMessage(obj.message)) {
      setStatusMessage(obj.message.trim())
    }
    const blockId =
      typeof obj.blockId === 'string'
        ? obj.blockId
        : typeof obj.block_id === 'string'
          ? obj.block_id
          : typeof obj.blockName === 'string'
            ? obj.blockName
            : ''
    const chunkText =
      typeof obj.chunk === 'string'
        ? obj.chunk
        : typeof obj.delta === 'string'
          ? obj.delta
          : typeof obj.text === 'string'
            ? obj.text
            : ''
    if (blockId && chunkText) {
      const key = blockId.trim().toLowerCase()
      blockAccumRef.current[key] = (blockAccumRef.current[key] ?? '') + chunkText
      let target: BlockTarget | null = blockTargetRef.current[key] ?? resolveBlockTarget(blockId)
      if (!target) {
        target = classifyUnknownPayload(blockAccumRef.current[key])
      }
      if (target) {
        blockTargetRef.current[key] = target
        routeAccumulated(target, blockAccumRef.current[key])
      }
      return
    }
    if (chunkText) {
      if (isHeartbeatMessage(chunkText)) {
        setStatusMessage(chunkText.trim())
        return
      }
      looseTextRef.current += chunkText
      const classified = classifyUnknownPayload(looseTextRef.current)
      if (classified) routeAccumulated(classified, looseTextRef.current)
      return
    }
    mergeStructured(obj)
  }

  function processLine(rawLine: string): void {
    const line = rawLine.trim()
    if (!line) return
    const data = line.startsWith('data:') ? line.slice(5).trim() : line
    if (!data) return
    if (data === '[DONE]') {
      finalize()
      return
    }
    rawTranscriptRef.current += `\n${data}`
    const parsed = extractBalancedJson(data)
    const rec = asRecord(parsed)
    if (rec) {
      handleEventObject(rec)
      return
    }
    if (!isHeartbeatMessage(data)) {
      looseTextRef.current += `\n${data}`
      const classified = classifyUnknownPayload(looseTextRef.current)
      if (classified) routeAccumulated(classified, looseTextRef.current)
    } else {
      setStatusMessage(data)
    }
  }

  function finalize(): void {
    if (doneRef.current) return
    doneRef.current = true
    const transcript = rawTranscriptRef.current
    if (transcript) {
      if (!dataPresentRef.current.article) {
        const value = extractKeyValue(transcript, 'content')
        if (typeof value === 'string' && value.trim()) {
          targetAccumRef.current.article = value
          dataPresentRef.current.article = true
          setContent(value)
        }
      }
      if (!dataPresentRef.current.gapanalysis) {
        applyGapPayload({
          competitor_strengths: extractKeyValue(transcript, 'competitor_strengths'),
          coverage_gaps: extractKeyValue(transcript, 'coverage_gaps'),
          underdeveloped_sections: extractKeyValue(transcript, 'underdeveloped_sections'),
        })
      }
      if (!dataPresentRef.current.recommendations) {
        const value = extractKeyValue(transcript, 'recommendations')
        if (value !== undefined) applyRecPayload(value)
      }
      if (!dataPresentRef.current.coverage) {
        applyCoveragePayload({
          overall_score: extractKeyValue(transcript, 'overall_score'),
          passed: extractKeyValue(transcript, 'passed'),
          summary: extractKeyValue(transcript, 'summary'),
          criteria: extractKeyValue(transcript, 'criteria'),
        })
      }
    }
    const present = dataPresentRef.current
    const anyData = present.article || present.gapanalysis || present.recommendations || present.coverage
    if (!anyData) {
      setErrorMessage(
        streamErrorRef.current ||
          'The enhancement service finished without returning any output. Please try again.',
      )
      setStatusMessage('')
      setPhase('error')
      return
    }
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
    setPhase('done')
  }

  async function runEnhancement(payload: EnhancePayload): Promise<void> {
    resetRun()
    setSubmittedUrl(payload.article_url)
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
        throw new Error(body?.error || `The enhancement service returned an error (${res.status}).`)
      }
      const resContentType = res.headers.get('content-type') ?? ''
      if (resContentType.includes('application/json')) {
        const data: unknown = await res.json()
        rawTranscriptRef.current += JSON.stringify(data)
        const rec = asRecord(data)
        if (rec) mergeStructured(rec)
        finalize()
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
          const line = buffer.slice(0, newlineIndex)
          buffer = buffer.slice(newlineIndex + 1)
          processLine(line)
          if (doneRef.current) break
          newlineIndex = buffer.indexOf('\n')
        }
        if (doneRef.current) break
      }
      if (!doneRef.current && buffer.trim()) processLine(buffer)
      finalize()
    } catch (err) {
      if (controller.signal.aborted) return
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setStatusMessage('')
      setPhase('error')
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (phase === 'streaming') return
    if (!validate()) return
    const payload: EnhancePayload = {
      article_url: articleUrl.trim(),
      article_text: articleText.trim(),
      content_type: contentType === 'Other' ? otherType.trim() : contentType,
    }
    lastPayloadRef.current = payload
    void runEnhancement(payload)
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

  function handleExport(): void {
    const html = buildPrintableHtml(content, gapData, recData, coverage)
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(html)
    win.document.close()
    win.focus()
  }

  const checklistStages: ChecklistStage[] = STAGE_ORDER.map((id) => ({
    id,
    label: STAGE_LABELS[id],
    status: stages[id],
  }))

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <section
        aria-label="Article input"
        className="card-enter rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8"
      >
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
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
              placeholder="https://example.com/blog/my-post"
              aria-invalid={Boolean(errors.articleUrl)}
              className={`${inputBase} ${errors.articleUrl ? 'border-rose-300' : 'border-slate-200'}`}
            />
            {errors.articleUrl ? (
              <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.articleUrl}</p>
            ) : null}
          </div>
          <div>
            <label
              htmlFor="article-text"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-soft"
            >
              Article text
            </label>
            <textarea
              id="article-text"
              rows={10}
              value={articleText}
              onChange={(event) => setArticleText(event.target.value)}
              placeholder="Paste the full article text here…"
              aria-invalid={Boolean(errors.articleText)}
              className={`${inputBase} resize-y ${errors.articleText ? 'border-rose-300' : 'border-slate-200'}`}
            />
            {errors.articleText ? (
              <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.articleText}</p>
            ) : null}
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label
                htmlFor="content-type"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-soft"
              >
                Content type
              </label>
              <select
                id="content-type"
                value={contentType}
                onChange={(event) => setContentType(event.target.value)}
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
              {errors.contentType ? (
                <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.contentType}</p>
              ) : null}
            </div>
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
                  placeholder="e.g. Case Study"
                  aria-invalid={Boolean(errors.otherType)}
                  className={`${inputBase} ${errors.otherType ? 'border-rose-300' : 'border-slate-200'}`}
                />
                {errors.otherType ? (
                  <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.otherType}</p>
                ) : null}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={phase === 'streaming'}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-deep focus:outline-none focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {phase === 'streaming' ? 'Enhancing…' : 'Get Recommendations'}
            </button>
            {phase === 'streaming' && (
              <StatusChip message={statusMessage || 'Working on it…'} elapsedSeconds={elapsed} />
            )}
          </div>
        </form>
      </section>

      {phase === 'streaming' && <ProgressChecklist stages={checklistStages} />}

      {phase === 'error' && <ErrorCard message={errorMessage} onRetry={handleRetry} />}

      {(phase === 'streaming' || phase === 'done') && (
        <div className="flex flex-col gap-4">
          {phase === 'done' && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleExport}
                className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-ink-soft transition hover:border-indigo-200 hover:text-accent-deep focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
              >
                Export / Print
              </button>
            </div>
          )}
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
        </div>
      )}
    </div>
  )
}
