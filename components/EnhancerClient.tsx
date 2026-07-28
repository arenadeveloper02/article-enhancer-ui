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
  extractArticleContent,
  extractBalancedJson,
  isCoverageEmpty,
  isGapAnalysisEmpty,
  isRecommendationsEmpty,
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
    setStages({ ...INITIAL_STAGES })
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

  function activateStage(id: StageId): void {
    setStages((prev) => {
      const next: Record<StageId, StageStatus> = { ...prev }
      const idx = STAGE_ORDER.indexOf(id)
      for (let i = 0; i < idx; i++) {
        const earlier = STAGE_ORDER[i]
        if (next[earlier] !== 'done') next[earlier] = 'done'
      }
      if (next[id] === 'pending') next[id] = 'active'
      return next
    })
  }

  function applyPanelData(panel: PanelKey): void {
    const accum = targetAccumRef.current[panel]
    if (!accum.trim()) return
    if (panel === 'article') {
      const extracted: unknown = extractArticleContent(accum)
      if (typeof extracted === 'string' && extracted.trim()) {
        setContent(extracted)
        dataPresentRef.current.article = true
      }
      return
    }
    if (panel === 'gapanalysis') {
      const normalized = normalizeGapAnalysis(accum)
      if (!isGapAnalysisEmpty(normalized)) {
        gapRef.current = normalized
        setGapData(normalized)
        dataPresentRef.current.gapanalysis = true
      }
      return
    }
    if (panel === 'recommendations') {
      const normalized = normalizeRecommendations(accum)
      if (!isRecommendationsEmpty(normalized)) {
        recRef.current = normalized
        setRecData(normalized)
        dataPresentRef.current.recommendations = true
      }
      return
    }
    const normalized = normalizeCoverage(accum)
    if (!isCoverageEmpty(normalized)) {
      covRef.current = normalized
      setCoverage(normalized)
      dataPresentRef.current.coverage = true
    }
  }

  function routeToPanel(panel: PanelKey, text: string): void {
    targetAccumRef.current[panel] += text
    activateStage(STAGE_FOR_PANEL[panel])
    markSection(panel, 'streaming')
    setStatusMessage(`${STAGE_LABELS[STAGE_FOR_PANEL[panel]]}…`)
    applyPanelData(panel)
  }

  function applyFinalOutput(): void {
    const output = finalOutputRef.current
    if (!output) return
    if (!dataPresentRef.current.article) {
      for (const [key, value] of Object.entries(output)) {
        const lower = key.toLowerCase()
        const isArticleKey =
          lower.endsWith('content') || lower.includes('article') || lower.includes('writer')
        if (isArticleKey && typeof value === 'string' && value.trim().length > 40) {
          setContent(decodeUnicodeEscapes(value))
          dataPresentRef.current.article = true
          markSection('article', doneRef.current ? 'done' : 'streaming')
          break
        }
      }
    }
    if (!dataPresentRef.current.gapanalysis) {
      const normalized = normalizeGapAnalysis(output)
      if (!isGapAnalysisEmpty(normalized)) {
        gapRef.current = normalized
        setGapData(normalized)
        dataPresentRef.current.gapanalysis = true
        markSection('gapanalysis', doneRef.current ? 'done' : 'streaming')
      }
    }
    if (!dataPresentRef.current.recommendations) {
      const normalized = normalizeRecommendations(output)
      if (!isRecommendationsEmpty(normalized)) {
        recRef.current = normalized
        setRecData(normalized)
        dataPresentRef.current.recommendations = true
        markSection('recommendations', doneRef.current ? 'done' : 'streaming')
      }
    }
    if (!dataPresentRef.current.coverage) {
      const normalized = normalizeCoverage(output)
      if (!isCoverageEmpty(normalized)) {
        covRef.current = normalized
        setCoverage(normalized)
        dataPresentRef.current.coverage = true
        markSection('coverage', doneRef.current ? 'done' : 'streaming')
      }
    }
  }

  function mergeStructured(record: Record<string, unknown>): void {
    const merged: Record<string, unknown> = finalOutputRef.current ?? {}
    let changed = false
    const visit = (obj: Record<string, unknown>): void => {
      for (const [key, value] of Object.entries(obj)) {
        const lower = key.toLowerCase()
        if (RESERVED_KEYS.has(lower)) continue
        const resolved = parseIfJsonLike(value)
        if (lower === 'output' || lower === 'outputs' || lower === 'result' || lower === 'data') {
          const inner = asRecord(resolved)
          if (inner) {
            visit(inner)
            continue
          }
        }
        merged[key] = resolved
        changed = true
      }
    }
    visit(record)
    if (changed) {
      finalOutputRef.current = merged
      applyFinalOutput()
    }
  }

  function salvage(): void {
    const raw = `${rawTranscriptRef.current}\n${looseTextRef.current}`
    for (const accum of Object.values(blockAccumRef.current)) {
      if (!accum.trim()) continue
      const target = classifyUnknownPayload(accum)
      if (!target || dataPresentRef.current[target]) continue
      targetAccumRef.current[target] += accum
      applyPanelData(target)
    }
    if (!dataPresentRef.current.article) {
      const value = extractKeyValue(raw, 'content')
      if (typeof value === 'string' && value.trim().length > 40) {
        setContent(decodeUnicodeEscapes(value))
        dataPresentRef.current.article = true
      }
    }
    if (!dataPresentRef.current.gapanalysis) {
      const normalized = normalizeGapAnalysis({
        competitor_strengths: extractKeyValue(raw, 'competitor_strengths'),
        coverage_gaps: extractKeyValue(raw, 'coverage_gaps'),
        underdeveloped_sections: extractKeyValue(raw, 'underdeveloped_sections'),
      })
      if (!isGapAnalysisEmpty(normalized)) {
        gapRef.current = normalized
        setGapData(normalized)
        dataPresentRef.current.gapanalysis = true
      }
    }
    if (!dataPresentRef.current.recommendations) {
      const value = extractKeyValue(raw, 'recommendations')
      const normalized = normalizeRecommendations(
        value !== undefined ? { recommendations: value } : looseTextRef.current,
      )
      if (!isRecommendationsEmpty(normalized)) {
        recRef.current = normalized
        setRecData(normalized)
        dataPresentRef.current.recommendations = true
      }
    }
    if (!dataPresentRef.current.coverage) {
      const normalized = normalizeCoverage({
        overall_score: extractKeyValue(raw, 'overall_score'),
        passed: extractKeyValue(raw, 'passed'),
        summary: extractKeyValue(raw, 'summary'),
        criteria: extractKeyValue(raw, 'criteria'),
      })
      if (!isCoverageEmpty(normalized)) {
        covRef.current = normalized
        setCoverage(normalized)
        dataPresentRef.current.coverage = true
      }
    }
  }

  function finalize(): void {
    if (doneRef.current) return
    doneRef.current = true
    applyFinalOutput()
    salvage()
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
    const anyData = Object.values(dataPresentRef.current).some(Boolean)
    if (streamErrorRef.current && !anyData) {
      setErrorMessage(streamErrorRef.current)
      setPhase('error')
    } else {
      setPhase('done')
    }
    setStatusMessage('')
  }

  function handleEvent(parsed: unknown): void {
    if (typeof parsed === 'string') {
      const trimmed = parsed.trim()
      if (trimmed === '[DONE]') {
        finalize()
        return
      }
      rawTranscriptRef.current += `${parsed}\n`
      if (trimmed && !isHeartbeatMessage(trimmed)) looseTextRef.current += `${parsed}\n`
      return
    }
    const record = asRecord(parsed)
    if (!record) return
    try {
      rawTranscriptRef.current += `${JSON.stringify(record)}\n`
    } catch {
      // Ignore serialization failures for the salvage transcript.
    }
    if (typeof record.error === 'string' && record.error.trim()) {
      streamErrorRef.current = record.error.trim()
    }
    if (record.done === true || record.event === 'done' || record.type === 'done') {
      mergeStructured(record)
      finalize()
      return
    }
    const blockIdRaw = record.blockId ?? record.block_id ?? record.blockName ?? record.blockname
    const blockId = typeof blockIdRaw === 'string' ? blockIdRaw : ''
    const chunkRaw = record.chunk ?? record.delta ?? record.text
    const chunk = typeof chunkRaw === 'string' ? chunkRaw : ''
    if (blockId && chunk) {
      const cached: BlockTarget | undefined = blockTargetRef.current[blockId]
      const target = cached ?? resolveBlockTarget(blockId)
      if (target) {
        blockTargetRef.current[blockId] = target
        if (target === 'status-theme' || target === 'status-research') {
          setStatusMessage(statusLabelFor(target))
          return
        }
        routeToPanel(target, chunk)
        return
      }
      const accumulated = (blockAccumRef.current[blockId] ?? '') + chunk
      blockAccumRef.current[blockId] = accumulated
      const classified = classifyUnknownPayload(accumulated)
      if (classified) {
        blockTargetRef.current[blockId] = classified
        blockAccumRef.current[blockId] = ''
        routeToPanel(classified, accumulated)
      }
      return
    }
    const messageRaw = record.message ?? record.status
    if (typeof messageRaw === 'string' && messageRaw.trim() && messageRaw.trim().length <= 200) {
      setStatusMessage(messageRaw.trim())
    }
    mergeStructured(record)
  }

  function processLine(rawLine: string): void {
    const line = rawLine.trim()
    if (!line) return
    const payload = line.startsWith('data:') ? line.slice(5).trim() : line
    if (!payload) return
    if (payload === '[DONE]') {
      finalize()
      return
    }
    try {
      handleEvent(JSON.parse(payload) as unknown)
    } catch {
      rawTranscriptRef.current += `${payload}\n`
      if (!isHeartbeatMessage(payload)) looseTextRef.current += `${payload}\n`
    }
  }

  async function runEnhancement(payload: EnhancePayload): Promise<void> {
    resetRun()
    setSubmittedUrl(payload.article_url)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const response = await fetch('/api/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      if (!response.ok) {
        let detail = ''
        try {
          const errBody = (await response.json()) as { error?: unknown }
          if (typeof errBody.error === 'string') detail = errBody.error
        } catch {
          detail = ''
        }
        throw new Error(detail || `The enhancement service returned an error (${response.status}).`)
      }
      const contentTypeHeader = response.headers.get('content-type') ?? ''
      if (contentTypeHeader.includes('application/json')) {
        const json = (await response.json()) as unknown
        handleEvent(json)
        finalize()
        return
      }
      if (!response.body) {
        throw new Error('The enhancement service returned an empty response.')
      }
      const reader = response.body.getReader()
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
          processLine(line)
          if (doneRef.current) break
          newlineIndex = buffer.indexOf('\n')
        }
        if (doneRef.current) break
      }
      if (!doneRef.current) {
        buffer += decoder.decode()
        if (buffer.trim()) processLine(buffer)
        finalize()
      }
    } catch (err) {
      if (controller.signal.aborted) return
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Something went wrong while streaming the enhancement.'
      streamErrorRef.current = message
      if (!doneRef.current) {
        doneRef.current = true
        setErrorMessage(message)
        setPhase('error')
        setStatusMessage('')
      }
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
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

  function handleCancel(): void {
    abortRef.current?.abort()
    if (!doneRef.current) finalize()
  }

  function handleExport(): void {
    const html = buildPrintableHtml(content, gapRef.current, recRef.current, covRef.current)
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(html)
    win.document.close()
  }

  const checklistStages: ChecklistStage[] = STAGE_ORDER.map((id) => ({
    id,
    label: STAGE_LABELS[id],
    status: stages[id],
  }))

  const showResults = phase === 'streaming' || phase === 'done'

  return (
    <div className="w-full space-y-6">
      <form
        onSubmit={handleSubmit}
        noValidate
        className="card-enter rounded-2xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"
      >
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-5">
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
                disabled={phase === 'streaming'}
                className={`${inputBase} ${errors.articleUrl ? 'border-rose-300' : 'border-slate-200'}`}
              />
              {errors.articleUrl ? (
                <p className="mt-1 text-xs text-rose-600">{errors.articleUrl}</p>
              ) : null}
            </div>
            <div>
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-soft">
                Content type
              </span>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Content type">
                {CONTENT_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setContentType(type)}
                    aria-pressed={contentType === type}
                    disabled={phase === 'streaming'}
                    className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
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
                <p className="mt-1 text-xs text-rose-600">{errors.contentType}</p>
              ) : null}
              {contentType === 'Other' ? (
                <div className="mt-2">
                  <label htmlFor="other-type" className="sr-only">
                    Describe your content type
                  </label>
                  <input
                    id="other-type"
                    type="text"
                    value={otherType}
                    onChange={(event) => setOtherType(event.target.value)}
                    placeholder="Describe your content type"
                    disabled={phase === 'streaming'}
                    className={`${inputBase} ${errors.otherType ? 'border-rose-300' : 'border-slate-200'}`}
                  />
                  {errors.otherType ? (
                    <p className="mt-1 text-xs text-rose-600">{errors.otherType}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
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
              rows={9}
              value={articleText}
              onChange={(event) => setArticleText(event.target.value)}
              placeholder="Paste the full article text here…"
              disabled={phase === 'streaming'}
              className={`${inputBase} min-h-[200px] resize-y ${errors.articleText ? 'border-rose-300' : 'border-slate-200'}`}
            />
            {errors.articleText ? (
              <p className="mt-1 text-xs text-rose-600">{errors.articleText}</p>
            ) : null}
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={phase === 'streaming'}
            className="inline-flex items-center justify-center rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-60"
          >
            {phase === 'streaming' ? 'Enhancing…' : 'Enhance article'}
          </button>
          {phase === 'streaming' ? (
            <button
              type="button"
              onClick={handleCancel}
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-ink-soft transition hover:border-rose-200 hover:text-rose-600"
            >
              Cancel
            </button>
          ) : null}
          {phase === 'done' && content.trim() ? (
            <button
              type="button"
              onClick={handleExport}
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-ink-soft transition hover:border-indigo-200 hover:text-accent-deep"
            >
              Export / Print
            </button>
          ) : null}
          {phase === 'streaming' ? (
            <StatusChip message={statusMessage || 'Working on it…'} elapsedSeconds={elapsed} />
          ) : null}
        </div>
      </form>

      {phase === 'error' ? (
        <ErrorCard message={errorMessage || 'Something went wrong.'} onRetry={handleRetry} />
      ) : null}

      {showResults ? (
        <>
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
          />
        </>
      ) : null}
    </div>
  )
}
