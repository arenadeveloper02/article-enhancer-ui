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

  function finishRun(): void {
    const articleFinal = decodeUnicodeEscapes(targetAccumRef.current.article)
    const gapText = targetAccumRef.current.gapanalysis
    const recText = targetAccumRef.current.recommendations
    const covText = targetAccumRef.current.coverage

    let finalGap = gapRef.current
    if (finalGap === null && gapText.trim()) finalGap = normalizeGapAnalysis(gapText)
    let finalRec = recRef.current
    if (finalRec === null && recText.trim()) finalRec = normalizeRecommendations(recText)
    let finalCov = covRef.current
    if (finalCov === null && covText.trim()) finalCov = normalizeCoverage(covText)

    gapRef.current = finalGap
    recRef.current = finalRec
    covRef.current = finalCov
    setGapData(finalGap)
    setRecData(finalRec)
    setCoverage(finalCov)

    const articleEmpty = !articleFinal.trim()
    const gapEmpty = finalGap === null || isGapAnalysisEmpty(finalGap)
    const recEmpty = finalRec === null || isRecommendationsEmpty(finalRec)
    const covEmpty = finalCov === null || isCoverageEmpty(finalCov)

    if (process.env.NODE_ENV !== 'production' && covText.trim() && covEmpty) {
      console.warn(
        '[article-enhancer] Coverage block (c4bd5114) accumulated content, but normalizeCoverage() produced the default empty shape at stream end. Upstream likely sent unparseable or unexpected JSON for this block. Raw prefix:',
        covText.slice(0, 400),
      )
    }

    // At [DONE] the run has genuinely ended, so every stage is complete on the
    // checklist; panels that never produced data get the distinct 'empty' state.
    setStages(() => {
      const next: Record<StageId, StageStatus> = { ...INITIAL_STAGES }
      for (const id of STAGE_ORDER) next[id] = 'done'
      return next
    })
    setSections({
      article: articleEmpty ? 'empty' : 'done',
      gapanalysis: gapEmpty ? 'empty' : 'done',
      recommendations: recEmpty ? 'empty' : 'done',
      coverage: covEmpty ? 'empty' : 'done',
    })
    setContent(articleFinal)
    setStatusMessage('')
    setPhase('done')
  }

  function completeRun(): void {
    if (doneRef.current) return
    doneRef.current = true
    finishRun()
  }

  function resetRunState(): void {
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
    setStatusMessage('')
    setElapsed(0)
  }

  function applyFallbackJson(data: unknown): void {
    const article = extractArticleContent(data)
    if (article.trim()) {
      targetAccumRef.current.article = article
      dataPresentRef.current.article = true
    }
    const gap = normalizeGapAnalysis(data)
    if (!isGapAnalysisEmpty(gap)) {
      gapRef.current = gap
      dataPresentRef.current.gapanalysis = true
    }
    const rec = normalizeRecommendations(data)
    if (!isRecommendationsEmpty(rec)) {
      recRef.current = rec
      dataPresentRef.current.recommendations = true
    }
    const cov = normalizeCoverage(data)
    if (!isCoverageEmpty(cov)) {
      covRef.current = cov
      dataPresentRef.current.coverage = true
    }
  }

  function handleChunk(blockId: string, text: string): void {
    if (!text) return
    const target = blockId ? resolveBlockTarget(blockId) : null
    if (target === 'status-theme' || target === 'status-research') {
      setStatusMessage(statusLabelFor(target))
      return
    }
    if (target) {
      routeToPanel(target, text)
      return
    }
    if (isHeartbeatMessage(text)) {
      setStatusMessage(text.trim())
      return
    }
    const key = blockId || '__unrouted__'
    const assigned = blockTargetRef.current[key]
    if (assigned) {
      routeToPanel(assigned, text)
      return
    }
    blockAccumRef.current[key] = (blockAccumRef.current[key] ?? '') + text
    const classified = classifyUnknownPayload(blockAccumRef.current[key])
    if (classified) {
      blockTargetRef.current[key] = classified
      routeToPanel(classified, blockAccumRef.current[key])
      blockAccumRef.current[key] = ''
    }
  }

  function processSseLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(':')) return
    const payload = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed
    if (!payload) return
    if (payload === '[DONE]') {
      completeRun()
      return
    }
    let parsed: unknown = null
    try {
      parsed = JSON.parse(payload)
    } catch {
      parsed = null
    }
    const record = asRecord(parsed)
    if (!record) {
      handleChunk('', payload)
      return
    }
    const blockId =
      typeof record.blockId === 'string'
        ? record.blockId
        : typeof record.block_id === 'string'
          ? record.block_id
          : typeof record.id === 'string'
            ? record.id
            : ''
    const rawChunk =
      typeof record.chunk === 'string'
        ? record.chunk
        : typeof record.content === 'string'
          ? record.content
          : typeof record.delta === 'string'
            ? record.delta
            : typeof record.text === 'string'
              ? record.text
              : typeof record.output === 'string'
                ? record.output
                : ''
    if (rawChunk) {
      handleChunk(blockId, rawChunk)
      return
    }
    // Structured (non-string) payload — treat as a JSON data fallback.
    applyFallbackJson(record)
  }

  async function runEnhancement(payload: EnhancePayload, signal: AbortSignal): Promise<void> {
    const response = await fetch('/api/enhance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
    const contentTypeHeader = response.headers.get('content-type') ?? ''
    if (!response.ok) {
      let message = `The enhancement request failed (${response.status}).`
      if (contentTypeHeader.includes('application/json')) {
        try {
          const data = (await response.json()) as { error?: unknown }
          if (typeof data.error === 'string' && data.error) message = data.error
        } catch {
          // Keep the default message.
        }
      }
      throw new Error(message)
    }
    if (contentTypeHeader.includes('application/json')) {
      const data = (await response.json()) as unknown
      applyFallbackJson(data)
      completeRun()
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
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) processSseLine(line)
    }
    buffer += decoder.decode()
    if (buffer.trim()) processSseLine(buffer)
    completeRun()
  }

  function startRun(): void {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    resetRunState()
    startRef.current = Date.now()
    setPhase('streaming')
    setStatusMessage('Contacting the enhancement agent…')
    const payload: EnhancePayload = {
      article_url: articleUrl.trim(),
      article_text: articleText.trim(),
      content_type: contentType === 'Other' ? otherType.trim() : contentType,
    }
    void runEnhancement(payload, controller.signal).catch((error: unknown) => {
      if (controller.signal.aborted) return
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Something went wrong while streaming the enhancement.'
      setErrorMessage(message)
      setStatusMessage('')
      setPhase('error')
    })
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (phase === 'streaming') return
    if (!validate()) return
    startRun()
  }

  function handleExportPdf(): void {
    const html = buildPrintableHtml(content, gapData, recData, coverage)
    const win = window.open('', '_blank')
    if (!win) return
    win.document.open()
    win.document.write(html)
    win.document.close()
    win.focus()
    window.setTimeout(() => {
      win.print()
    }, 250)
  }

  const checklistStages: ChecklistStage[] = STAGE_ORDER.map((id) => ({
    id,
    label: STAGE_LABELS[id],
    status: stages[id],
  }))

  const streaming = phase === 'streaming'
  const showResults = phase === 'streaming' || phase === 'done'

  return (
    <div className="grid gap-8 lg:grid-cols-[400px_minmax(0,1fr)] lg:items-start">
      <form
        onSubmit={handleSubmit}
        noValidate
        aria-label="Article enhancement form"
        className="card-enter rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-7 lg:sticky lg:top-6"
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
              placeholder="https://example.com/post"
              disabled={streaming}
              aria-invalid={Boolean(errors.articleUrl)}
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
            <label htmlFor="article-text" className="mb-1.5 block text-sm font-medium text-ink">
              Article text
            </label>
            <textarea
              id="article-text"
              rows={10}
              value={articleText}
              onChange={(event) => setArticleText(event.target.value)}
              placeholder="Paste the full article text here…"
              disabled={streaming}
              aria-invalid={Boolean(errors.articleText)}
              aria-describedby={errors.articleText ? 'article-text-error' : undefined}
              className={`${inputBase} resize-y ${errors.articleText ? 'border-rose-300' : 'border-slate-200'}`}
            />
            {errors.articleText && (
              <p id="article-text-error" className="mt-1.5 text-xs font-medium text-rose-600">
                {errors.articleText}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="content-type" className="mb-1.5 block text-sm font-medium text-ink">
              Content type
            </label>
            <select
              id="content-type"
              value={contentType}
              onChange={(event) => setContentType(event.target.value)}
              disabled={streaming}
              aria-invalid={Boolean(errors.contentType)}
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
              <label htmlFor="other-type" className="mb-1.5 block text-sm font-medium text-ink">
                Describe your content type
              </label>
              <input
                id="other-type"
                type="text"
                value={otherType}
                onChange={(event) => setOtherType(event.target.value)}
                placeholder="e.g. Technical whitepaper"
                disabled={streaming}
                aria-invalid={Boolean(errors.otherType)}
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
          <button
            type="submit"
            disabled={streaming}
            className="w-full rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-white transition hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-60"
          >
            {streaming ? 'Enhancing…' : phase === 'done' ? 'Enhance again' : 'Enhance article'}
          </button>
          {phase === 'done' && content.trim() && (
            <button
              type="button"
              onClick={handleExportPdf}
              className="w-full rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-ink-soft transition hover:border-indigo-200 hover:text-accent-deep"
            >
              Export full report (PDF)
            </button>
          )}
        </div>
      </form>
      <div className="min-w-0 space-y-4">
        {phase === 'error' ? (
          <ErrorCard message={errorMessage} onRetry={startRun} />
        ) : (
          <>
            {streaming && statusMessage && (
              <StatusChip message={statusMessage} elapsedSeconds={elapsed} />
            )}
            {showResults && <ProgressChecklist stages={checklistStages} />}
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
              />
            ) : (
              <section className="card-enter rounded-2xl border border-dashed border-slate-200 bg-white/60 p-10 text-center">
                <p className="font-display text-lg font-semibold text-ink">Ready when you are</p>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
                  Fill in the form and start an enhancement to watch gap analysis, recommendations,
                  the enhanced article, and coverage verification stream in live.
                </p>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
