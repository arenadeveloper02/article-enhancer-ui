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

function buildPrintableHtml(
  content: string,
  gap: GapAnalysisData | null,
  rec: RecommendationsData | null,
  cov: CoverageData | null,
): string {
  const sections: string[] = []
  if (content.trim()) {
    // <br> tags become real newlines and [+ADDED]…[/ADDED] spans render as
    // visually highlighted text — the literal marker tokens never reach the PDF.
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
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Article Enhancer Output</title><style>body{font-family:Georgia,serif;max-width:720px;margin:32px auto;padding:0 24px;color:#1b2040;line-height:1.6}h1{font-size:24px}h2{font-size:19px;margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:6px}h3{font-size:15px;margin-top:18px}.article{white-space:pre-wrap}.added{background:#e4e4fb;color:#3d3da8;border-radius:3px;padding:0 2px;-webkit-box-decoration-break:clone;box-decoration-break:clone;-webkit-print-color-adjust:exact;print-color-adjust:exact}li{margin-bottom:6px}@media print{body{margin:0;max-width:none}}</style></head><body><h1>Article Enhancer Output</h1>${sections.join('')}</body></html>`
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

  const abortRef = useRef<AbortController | null>(null)
  const startRef = useRef(0)
  const targetAccumRef = useRef<Record<PanelKey, string>>({
    article: '',
    gapanalysis: '',
    recommendations: '',
    coverage: '',
  })
  const blockAccumRef = useRef<Record<string, string>>({})
  const blockTargetRef = useRef<Record<string, PanelKey>>({})
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

  function markSectionStreaming(key: PanelKey): void {
    setSections((prev) => (prev[key] === 'pending' ? { ...prev, [key]: 'streaming' } : prev))
  }

  function routeToPanel(key: PanelKey, text: string): void {
    if (!text) return
    targetAccumRef.current[key] += text
    activateStage(STAGE_FOR_PANEL[key])
    markSectionStreaming(key)
    if (key === 'article') {
      const decoded = decodeUnicodeEscapes(targetAccumRef.current.article)
      if (decoded.trim()) dataPresentRef.current.article = true
      setContent(decoded)
      return
    }
    const parsed = extractBalancedJson(targetAccumRef.current[key])
    if (parsed === null) return
    if (key === 'gapanalysis') {
      const normalized = normalizeGapAnalysis(parsed)
      gapRef.current = normalized
      if (!isGapAnalysisEmpty(normalized)) dataPresentRef.current.gapanalysis = true
      setGapData(normalized)
    } else if (key === 'recommendations') {
      const normalized = normalizeRecommendations(parsed)
      recRef.current = normalized
      if (!isRecommendationsEmpty(normalized)) dataPresentRef.current.recommendations = true
      setRecData(normalized)
    } else {
      const normalized = normalizeCoverage(parsed)
      covRef.current = normalized
      if (!isCoverageEmpty(normalized)) dataPresentRef.current.coverage = true
      setCoverage(normalized)
    }
  }

  /**
   * Applies final (non-chunked) workflow outputs. Sim final events carry the
   * selected outputs as dotted keys (e.g. "gapanalysis.coverage_gaps",
   * "coverageverifier.overall_score") or as nested per-block objects. This is
   * the authoritative fix for the Gap Analysis / Coverage Verification panels
   * showing empty: even when no per-block chunks streamed, the final payload
   * still populates the panels here.
   */
  function applyFinalOutputs(output: Record<string, unknown>): void {
    const gapObj: Record<string, unknown> = {}
    const covObj: Record<string, unknown> = {}
    let recValue: unknown
    let articleValue: unknown
    for (const [key, value] of Object.entries(output)) {
      const target = resolveBlockTarget(key)
      const shortKey = key.includes('.') ? key.slice(key.lastIndexOf('.') + 1) : key
      if (target === 'gapanalysis') {
        gapObj[shortKey] = value
      } else if (target === 'coverage') {
        covObj[shortKey] = value
      } else if (target === 'recommendations') {
        recValue = value
      } else if (target === 'article') {
        articleValue = value
      }
    }
    if (Object.keys(gapObj).length > 0) {
      const normalized = normalizeGapAnalysis(gapObj)
      if (!isGapAnalysisEmpty(normalized)) {
        gapRef.current = normalized
        dataPresentRef.current.gapanalysis = true
        setGapData(normalized)
        markSectionStreaming('gapanalysis')
      }
    }
    if (Object.keys(covObj).length > 0) {
      const normalized = normalizeCoverage(covObj)
      if (!isCoverageEmpty(normalized)) {
        covRef.current = normalized
        dataPresentRef.current.coverage = true
        setCoverage(normalized)
        markSectionStreaming('coverage')
      }
    }
    if (recValue !== undefined) {
      const normalized = normalizeRecommendations(recValue)
      if (!isRecommendationsEmpty(normalized)) {
        recRef.current = normalized
        dataPresentRef.current.recommendations = true
        setRecData(normalized)
        markSectionStreaming('recommendations')
      }
    }
    if (articleValue !== undefined) {
      const text = extractArticleContent(articleValue)
      if (text.trim()) {
        targetAccumRef.current.article = text
        dataPresentRef.current.article = true
        setContent(decodeUnicodeEscapes(text))
        markSectionStreaming('article')
      }
    }
  }

  function routeUnknownText(text: string): void {
    const key = '__unknown'
    const cached = blockTargetRef.current[key]
    if (cached) {
      routeToPanel(cached, text)
      return
    }
    blockAccumRef.current[key] = (blockAccumRef.current[key] ?? '') + text
    const classified = classifyUnknownPayload(blockAccumRef.current[key])
    if (classified) {
      blockTargetRef.current[key] = classified
      routeToPanel(classified, blockAccumRef.current[key])
    }
  }

  function handleStreamEvent(payload: unknown): void {
    const record = asRecord(payload)
    if (!record) return
    const finalOutput = asRecord(record.output) ?? asRecord(record.result)
    if (finalOutput) {
      applyFinalOutputs(finalOutput)
      return
    }
    const message =
      typeof record.message === 'string'
        ? record.message
        : typeof record.status === 'string'
          ? record.status
          : ''
    if (message && isHeartbeatMessage(message)) {
      setStatusMessage(message.trim())
      return
    }
    const blockId =
      typeof record.blockId === 'string'
        ? record.blockId
        : typeof record.block_id === 'string'
          ? record.block_id
          : typeof record.blockName === 'string'
            ? record.blockName
            : ''
    const chunk =
      typeof record.chunk === 'string'
        ? record.chunk
        : typeof record.content === 'string'
          ? record.content
          : typeof record.data === 'string'
            ? record.data
            : ''
    if (!chunk) return
    if (!blockId) {
      if (isHeartbeatMessage(chunk)) {
        setStatusMessage(chunk.trim())
      } else {
        routeUnknownText(chunk)
      }
      return
    }
    const cached = blockTargetRef.current[blockId]
    if (cached) {
      routeToPanel(cached, chunk)
      return
    }
    const target = resolveBlockTarget(blockId)
    if (target === 'status-theme' || target === 'status-research') {
      setStatusMessage(statusLabelFor(target))
      return
    }
    if (target) {
      blockTargetRef.current[blockId] = target
      routeToPanel(target, chunk)
      return
    }
    blockAccumRef.current[blockId] = (blockAccumRef.current[blockId] ?? '') + chunk
    const classified = classifyUnknownPayload(blockAccumRef.current[blockId])
    if (classified) {
      blockTargetRef.current[blockId] = classified
      routeToPanel(classified, blockAccumRef.current[blockId])
    }
  }

  function processLine(rawLine: string): void {
    const line = rawLine.trim()
    if (!line || !line.startsWith('data:')) return
    const data = line.slice(5).trim()
    if (!data) return
    if (data === '[DONE]') {
      doneRef.current = true
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      if (!isHeartbeatMessage(data)) routeUnknownText(data)
      return
    }
    handleStreamEvent(parsed)
  }

  function finishRun(): void {
    setSections((prev) => {
      const next = { ...prev }
      for (const key of Object.keys(next) as PanelKey[]) {
        next[key] = dataPresentRef.current[key] ? 'done' : 'empty'
      }
      return next
    })
    setStages(() => {
      const next: Record<StageId, StageStatus> = { ...INITIAL_STAGES }
      for (const id of STAGE_ORDER) next[id] = 'done'
      return next
    })
    setStatusMessage('')
    setPhase('done')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!validate()) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    doneRef.current = false
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
    setStatusMessage('Contacting enhancement agent…')
    setElapsed(0)
    startRef.current = Date.now()
    setPhase('streaming')

    const resolvedType = contentType === 'Other' ? otherType.trim() : contentType
    const payload: EnhancePayload = {
      article_url: articleUrl.trim(),
      article_text: articleText.trim(),
      content_type: resolvedType,
    }

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
          const errBody = (await response.json()) as { error?: string }
          if (typeof errBody.error === 'string' && errBody.error) message = errBody.error
        } catch {
          // keep default message
        }
        throw new Error(message)
      }
      const respContentType = response.headers.get('content-type') ?? ''
      if (respContentType.includes('application/json')) {
        const json = (await response.json()) as unknown
        const record = asRecord(json)
        if (record) {
          const output = asRecord(record.output) ?? record
          applyFinalOutputs(output)
          const article = extractArticleContent(output)
          if (article.trim() && !dataPresentRef.current.article) {
            targetAccumRef.current.article = article
            dataPresentRef.current.article = true
            setContent(decodeUnicodeEscapes(article))
          }
        }
        finishRun()
        return
      }
      if (!response.body) {
        throw new Error('The enhancement service returned an empty response.')
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) processLine(line)
        if (doneRef.current) break
      }
      if (buffer.trim() && !doneRef.current) processLine(buffer)
      finishRun()
    } catch (err) {
      if (controller.signal.aborted) return
      setPhase('error')
      setErrorMessage(
        err instanceof Error && err.message ? err.message : 'Something went wrong. Please try again.',
      )
    }
  }

  function handleRetry(): void {
    setPhase('idle')
    setErrorMessage('')
  }

  function handleExport(): void {
    const articleSource = targetAccumRef.current.article
      ? decodeUnicodeEscapes(targetAccumRef.current.article)
      : content
    const html = buildPrintableHtml(articleSource, gapRef.current, recRef.current, covRef.current)
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
    <div className="grid gap-8 lg:grid-cols-[400px,1fr] lg:items-start">
      <form
        onSubmit={(e) => {
          void handleSubmit(e)
        }}
        noValidate
        className="card-enter rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-7"
      >
        <h2 className="mb-5 font-display text-lg font-semibold text-ink">Your article</h2>
        <div className="space-y-5">
          <div>
            <label htmlFor="article-url" className="mb-1.5 block text-sm font-medium text-ink">
              Article URL
            </label>
            <input
              id="article-url"
              type="url"
              value={articleUrl}
              onChange={(e) => setArticleUrl(e.target.value)}
              placeholder="https://example.com/post"
              disabled={phase === 'streaming'}
              aria-invalid={errors.articleUrl ? true : undefined}
              className={`${inputBase} ${errors.articleUrl ? 'border-rose-300' : 'border-slate-200'}`}
            />
            {errors.articleUrl ? (
              <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.articleUrl}</p>
            ) : null}
          </div>
          <div>
            <label htmlFor="article-text" className="mb-1.5 block text-sm font-medium text-ink">
              Article text
            </label>
            <textarea
              id="article-text"
              value={articleText}
              onChange={(e) => setArticleText(e.target.value)}
              rows={10}
              placeholder="Paste the full article text here…"
              disabled={phase === 'streaming'}
              aria-invalid={errors.articleText ? true : undefined}
              className={`${inputBase} resize-y ${errors.articleText ? 'border-rose-300' : 'border-slate-200'}`}
            />
            {errors.articleText ? (
              <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.articleText}</p>
            ) : null}
          </div>
          <div>
            <label htmlFor="content-type" className="mb-1.5 block text-sm font-medium text-ink">
              Content type
            </label>
            <select
              id="content-type"
              value={contentType}
              onChange={(e) => setContentType(e.target.value)}
              disabled={phase === 'streaming'}
              aria-invalid={errors.contentType ? true : undefined}
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
          {contentType === 'Other' ? (
            <div>
              <label htmlFor="other-type" className="mb-1.5 block text-sm font-medium text-ink">
                Describe your content type
              </label>
              <input
                id="other-type"
                type="text"
                value={otherType}
                onChange={(e) => setOtherType(e.target.value)}
                placeholder="e.g. Case Study"
                disabled={phase === 'streaming'}
                aria-invalid={errors.otherType ? true : undefined}
                className={`${inputBase} ${errors.otherType ? 'border-rose-300' : 'border-slate-200'}`}
              />
              {errors.otherType ? (
                <p className="mt-1.5 text-xs font-medium text-rose-600">{errors.otherType}</p>
              ) : null}
            </div>
          ) : null}
          <button
            type="submit"
            disabled={phase === 'streaming'}
            className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-60"
          >
            {phase === 'streaming' ? 'Enhancing…' : 'Enhance article'}
          </button>
        </div>
      </form>
      <div className="min-w-0 space-y-5">
        {phase === 'idle' && (
          <section
            aria-label="Getting started"
            className="card-enter flex min-h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/60 p-8 text-center"
          >
            <span aria-hidden="true" className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-xl">
              ✍
            </span>
            <h2 className="font-display text-lg font-semibold text-ink">Ready when you are</h2>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
              Fill in your article details and the enhanced version, gap analysis, recommendations,
              and coverage verification will stream in live here.
            </p>
          </section>
        )}
        {phase === 'error' && <ErrorCard message={errorMessage} onRetry={handleRetry} />}
        {showResults && (
          <>
            {phase === 'streaming' && (
              <StatusChip message={statusMessage || 'Working on it…'} elapsedSeconds={elapsed} />
            )}
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
            />
            {phase === 'done' && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleExport}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-ink-soft transition hover:border-indigo-200 hover:text-accent-deep"
                >
                  Export printable version
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
