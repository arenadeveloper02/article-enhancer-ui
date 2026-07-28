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

const PANEL_FOR_STAGE: Record<StageId, PanelKey> = {
  gapanalysis: 'gapanalysis',
  recommendations: 'recommendations',
  enhancedarticlewriter: 'article',
  coverageverifier: 'coverage',
}

// Metadata keys on stream events that must never be treated as panel outputs.
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
  'data',
  'output',
  'outputs',
  'result',
  'error',
  'timestamp',
  'id',
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
  // The URL the current run was submitted with — used to resolve relative
  // links in the rendered enhanced article.
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
  // A stored block target can be a panel OR a status-only route — typing this
  // as BlockTarget (not PanelKey) keeps the status comparisons type-correct.
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
  // when Gap Analysis / Coverage Verification never streamed per-block chunks.
  const rawTranscriptRef = useRef('')
  // Merged final (non-chunked) outputs from any final/output events.
  const finalOutputRef = useRef<Record<string, unknown> | null>(null)
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

  /**
   * Activates a stage. Previously-active stages only flip to 'done' when their
   * panel has actually produced real (non-default) data — a stage never looks
   * complete just because the next stage started while its own panel is empty.
   */
  function activateStage(id: StageId): void {
    setStages((prev) => {
      let changed = false
      const next: Record<StageId, StageStatus> = { ...prev }
      for (const stageId of STAGE_ORDER) {
        if (
          stageId !== id &&
          next[stageId] === 'active' &&
          dataPresentRef.current[PANEL_FOR_STAGE[stageId]]
        ) {
          next[stageId] = 'done'
          changed = true
        }
      }
      if (next[id] === 'pending') {
        next[id] = 'active'
        changed = true
      }
      return changed ? next : prev
    })
  }

  function setSectionStatus(panel: PanelKey, status: SectionStatus): void {
    setSections((prev) => (prev[panel] === status ? prev : { ...prev, [panel]: status }))
  }

  function handlePanelChunk(panel: PanelKey, chunk: string): void {
    activateStage(STAGE_FOR_PANEL[panel])
    setSectionStatus(panel, 'streaming')
    targetAccumRef.current[panel] += chunk
    const accumulated = targetAccumRef.current[panel]
    if (panel === 'article') {
      if (accumulated.trim().length > 0) dataPresentRef.current.article = true
      setContent(accumulated)
      return
    }
    if (panel === 'gapanalysis') {
      const normalized = normalizeGapAnalysis(accumulated)
      if (!isGapAnalysisEmpty(normalized)) {
        dataPresentRef.current.gapanalysis = true
        gapRef.current = normalized
        setGapData(normalized)
      }
      return
    }
    if (panel === 'recommendations') {
      const normalized = normalizeRecommendations(accumulated)
      if (!isRecommendationsEmpty(normalized)) {
        dataPresentRef.current.recommendations = true
        recRef.current = normalized
        setRecData(normalized)
      }
      return
    }
    const normalized = normalizeCoverage(accumulated)
    if (!isCoverageEmpty(normalized)) {
      dataPresentRef.current.coverage = true
      covRef.current = normalized
      setCoverage(normalized)
    }
  }

  /** Applies a structured (non-chunked) final value to a panel. */
  function applyFinalValue(panel: PanelKey, value: unknown): void {
    if (value === null || value === undefined) return
    if (panel === 'article') {
      const text = extractArticleContent(value)
      if (text.trim()) {
        activateStage(STAGE_FOR_PANEL.article)
        dataPresentRef.current.article = true
        targetAccumRef.current.article = text
        setContent(text)
        setSectionStatus('article', 'streaming')
      }
      return
    }
    if (panel === 'gapanalysis') {
      const normalized = normalizeGapAnalysis(value)
      if (!isGapAnalysisEmpty(normalized)) {
        activateStage(STAGE_FOR_PANEL.gapanalysis)
        dataPresentRef.current.gapanalysis = true
        gapRef.current = normalized
        setGapData(normalized)
        setSectionStatus('gapanalysis', 'streaming')
      }
      return
    }
    if (panel === 'recommendations') {
      const normalized = normalizeRecommendations(value)
      if (!isRecommendationsEmpty(normalized)) {
        activateStage(STAGE_FOR_PANEL.recommendations)
        dataPresentRef.current.recommendations = true
        recRef.current = normalized
        setRecData(normalized)
        setSectionStatus('recommendations', 'streaming')
      }
      return
    }
    const normalized = normalizeCoverage(value)
    if (!isCoverageEmpty(normalized)) {
      activateStage(STAGE_FOR_PANEL.coverage)
      dataPresentRef.current.coverage = true
      covRef.current = normalized
      setCoverage(normalized)
      setSectionStatus('coverage', 'streaming')
    }
  }

  function routeChunk(blockId: string, chunk: string): void {
    let target: BlockTarget | null = blockId ? (blockTargetRef.current[blockId] ?? null) : null
    if (!target && blockId) target = resolveBlockTarget(blockId)
    if (target === 'status-theme' || target === 'status-research') {
      if (blockId) blockTargetRef.current[blockId] = target
      setStatusMessage(statusLabelFor(target))
      return
    }
    if (target) {
      if (blockId) blockTargetRef.current[blockId] = target
      handlePanelChunk(target, chunk)
      return
    }
    const key = blockId || '__unknown__'
    blockAccumRef.current[key] = (blockAccumRef.current[key] ?? '') + chunk
    const classified = classifyUnknownPayload(blockAccumRef.current[key])
    if (classified) {
      blockTargetRef.current[key] = classified
      handlePanelChunk(classified, blockAccumRef.current[key])
      blockAccumRef.current[key] = ''
    }
  }

  function handleEventPayload(parsed: unknown): void {
    const record = asRecord(parsed)
    if (!record) return
    const blockIdRaw = record.blockId ?? record.block_id ?? record.blockName
    const blockId = typeof blockIdRaw === 'string' ? blockIdRaw : ''
    const chunkRaw = record.chunk ?? record.delta ?? record.text
    const chunk = typeof chunkRaw === 'string' ? chunkRaw : ''

    // Merge structured final/output payloads for the finalize pass.
    const outputCandidate = record.output ?? record.outputs ?? record.result ?? record.data
    const outputRecord = asRecord(parseIfJsonLike(outputCandidate))
    if (outputRecord) {
      finalOutputRef.current = { ...(finalOutputRef.current ?? {}), ...outputRecord }
    }

    // Some events key panel outputs directly by block name — route those too.
    for (const [key, value] of Object.entries(record)) {
      if (RESERVED_KEYS.has(key.toLowerCase())) continue
      const keyTarget = resolveBlockTarget(key)
      if (keyTarget === 'status-theme' || keyTarget === 'status-research') continue
      if (keyTarget) applyFinalValue(keyTarget, parseIfJsonLike(value))
    }

    if (chunk) {
      if (!blockId && isHeartbeatMessage(chunk)) {
        setStatusMessage(chunk.trim())
        return
      }
      routeChunk(blockId, chunk)
      return
    }

    const message =
      typeof record.message === 'string'
        ? record.message
        : typeof record.status === 'string'
          ? record.status
          : ''
    if (message && isHeartbeatMessage(message)) setStatusMessage(message.trim())
  }

  function processLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    const dataText = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed
    if (!dataText || dataText === '[DONE]') return
    const parsed = extractBalancedJson(dataText)
    if (parsed !== null) {
      handleEventPayload(parsed)
      return
    }
    if (isHeartbeatMessage(dataText)) setStatusMessage(dataText)
  }

  function finalizeRun(): void {
    if (doneRef.current) return
    doneRef.current = true

    const finalOut = finalOutputRef.current
    if (finalOut) {
      if (!dataPresentRef.current.article) applyFinalValue('article', finalOut)
      if (!dataPresentRef.current.gapanalysis) applyFinalValue('gapanalysis', finalOut)
      if (!dataPresentRef.current.recommendations) applyFinalValue('recommendations', finalOut)
      if (!dataPresentRef.current.coverage) applyFinalValue('coverage', finalOut)
    }

    // Salvage pass: mine the raw transcript for panels that never streamed.
    const transcript = rawTranscriptRef.current
    if (transcript) {
      if (!dataPresentRef.current.gapanalysis) {
        applyFinalValue('gapanalysis', {
          competitor_strengths: extractKeyValue(transcript, 'competitor_strengths'),
          coverage_gaps: extractKeyValue(transcript, 'coverage_gaps'),
          underdeveloped_sections: extractKeyValue(transcript, 'underdeveloped_sections'),
        })
      }
      if (!dataPresentRef.current.recommendations) {
        const recValue = extractKeyValue(transcript, 'recommendations')
        if (recValue !== undefined) applyFinalValue('recommendations', { recommendations: recValue })
      }
      if (!dataPresentRef.current.coverage) {
        applyFinalValue('coverage', {
          overall_score: extractKeyValue(transcript, 'overall_score'),
          passed: extractKeyValue(transcript, 'passed'),
          summary: extractKeyValue(transcript, 'summary'),
          criteria: extractKeyValue(transcript, 'criteria'),
        })
      }
    }

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

  function resetRunState(): void {
    setContent('')
    setGapData(null)
    setRecData(null)
    setCoverage(null)
    setStages({ ...INITIAL_STAGES })
    setSections({ ...INITIAL_SECTIONS })
    setErrorMessage('')
    setElapsed(0)
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
  }

  async function startRun(payload: EnhancePayload): Promise<void> {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    resetRunState()
    setSubmittedUrl(payload.article_url)
    setStatusMessage('Contacting enhancement agent…')
    startRef.current = Date.now()
    setPhase('streaming')
    try {
      const response = await fetch('/api/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      if (!response.ok) {
        let message = `Request failed with status ${response.status}.`
        try {
          const errBody = (await response.json()) as { error?: unknown }
          if (typeof errBody.error === 'string' && errBody.error) message = errBody.error
        } catch {
          // keep default message
        }
        throw new Error(message)
      }
      const responseType = response.headers.get('content-type') ?? ''
      if (responseType.includes('application/json')) {
        const json = (await response.json()) as unknown
        rawTranscriptRef.current = JSON.stringify(json)
        const record = asRecord(json)
        if (record) {
          const outputRecord =
            asRecord(parseIfJsonLike(record.output ?? record.outputs ?? record.result ?? record.data)) ??
            record
          finalOutputRef.current = outputRecord
        }
        finalizeRun()
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
        const text = decoder.decode(value, { stream: true })
        rawTranscriptRef.current += text
        buffer += text
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) processLine(line)
      }
      if (buffer.trim()) processLine(buffer)
      finalizeRun()
    } catch (err) {
      if (controller.signal.aborted) return
      setPhase('error')
      setErrorMessage(
        err instanceof Error && err.message
          ? err.message
          : 'Something went wrong while enhancing the article. Please try again.',
      )
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
    void startRun(payload)
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

  function handleReset(): void {
    abortRef.current?.abort()
    resetRunState()
    setStatusMessage('')
    setPhase('idle')
  }

  function handleExport(): void {
    const html = buildPrintableHtml(
      targetAccumRef.current.article || content,
      gapRef.current,
      recRef.current,
      covRef.current,
    )
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(html)
    win.document.close()
    win.focus()
    win.print()
  }

  const checklistStages: ChecklistStage[] = STAGE_ORDER.map((id) => ({
    id,
    label: STAGE_LABELS[id],
    status: stages[id],
  }))

  const showResults = phase === 'streaming' || phase === 'done'

  return (
    <div className="space-y-6">
      <form
        onSubmit={handleSubmit}
        noValidate
        className="card-enter rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8"
      >
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-5">
            <div>
              <label htmlFor="article-url" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-soft">
                Article URL
              </label>
              <input
                id="article-url"
                type="url"
                value={articleUrl}
                onChange={(e) => setArticleUrl(e.target.value)}
                disabled={phase === 'streaming'}
                placeholder="https://example.com/blog/my-post"
                aria-invalid={errors.articleUrl ? true : undefined}
                aria-describedby={errors.articleUrl ? 'article-url-error' : undefined}
                className={`${inputBase} ${errors.articleUrl ? 'border-rose-300' : 'border-slate-200'}`}
              />
              {errors.articleUrl && (
                <p id="article-url-error" className="mt-1.5 text-xs font-medium text-rose-600">
                  {errors.articleUrl}
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
                disabled={phase === 'streaming'}
                aria-invalid={errors.contentType ? true : undefined}
                aria-describedby={errors.contentType ? 'content-type-error' : undefined}
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
                <p id="content-type-error" className="mt-1.5 text-xs font-medium text-rose-600">
                  {errors.contentType}
                </p>
              )}
            </div>
            {contentType === 'Other' && (
              <div>
                <label htmlFor="other-type" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-soft">
                  Describe your content type
                </label>
                <input
                  id="other-type"
                  type="text"
                  value={otherType}
                  onChange={(e) => setOtherType(e.target.value)}
                  disabled={phase === 'streaming'}
                  placeholder="e.g. Technical whitepaper"
                  aria-invalid={errors.otherType ? true : undefined}
                  aria-describedby={errors.otherType ? 'other-type-error' : undefined}
                  className={`${inputBase} ${errors.otherType ? 'border-rose-300' : 'border-slate-200'}`}
                />
                {errors.otherType && (
                  <p id="other-type-error" className="mt-1.5 text-xs font-medium text-rose-600">
                    {errors.otherType}
                  </p>
                )}
              </div>
            )}
            <div className="hidden lg:block">
              <button
                type="submit"
                disabled={phase === 'streaming'}
                className="inline-flex w-full items-center justify-center rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-60"
              >
                {phase === 'streaming' ? 'Enhancing…' : 'Enhance article'}
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="article-text" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-soft">
              Article text
            </label>
            <textarea
              id="article-text"
              value={articleText}
              onChange={(e) => setArticleText(e.target.value)}
              disabled={phase === 'streaming'}
              rows={10}
              placeholder="Paste the full article text here…"
              aria-invalid={errors.articleText ? true : undefined}
              aria-describedby={errors.articleText ? 'article-text-error' : undefined}
              className={`${inputBase} min-h-[220px] resize-y ${errors.articleText ? 'border-rose-300' : 'border-slate-200'}`}
            />
            {errors.articleText && (
              <p id="article-text-error" className="mt-1.5 text-xs font-medium text-rose-600">
                {errors.articleText}
              </p>
            )}
          </div>
        </div>
        <div className="mt-5 lg:hidden">
          <button
            type="submit"
            disabled={phase === 'streaming'}
            className="inline-flex w-full items-center justify-center rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-60"
          >
            {phase === 'streaming' ? 'Enhancing…' : 'Enhance article'}
          </button>
        </div>
      </form>

      {phase === 'error' && <ErrorCard message={errorMessage} onRetry={handleRetry} />}

      {showResults && (
        <div className="space-y-4">
          <ProgressChecklist stages={checklistStages} />
          {phase === 'streaming' && (
            <StatusChip message={statusMessage || 'Working on it…'} elapsedSeconds={elapsed} />
          )}
          {phase === 'done' && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleExport}
                className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-indigo-200 hover:text-accent-deep"
              >
                Export / Print report
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-indigo-200 hover:text-accent-deep"
              >
                Start a new enhancement
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
