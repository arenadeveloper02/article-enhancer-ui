"use client"

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type {
  CoverageData,
  EnhanceFormErrors,
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
    sections.push(
      `<section><h2>Enhanced Article</h2><div class="article">${escapeHtml(content)}</div></section>`,
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
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Article Enhancer Output</title><style>body{font-family:Georgia,serif;max-width:720px;margin:32px auto;padding:0 24px;color:#1b2040;line-height:1.6}h1{font-size:24px}h2{font-size:19px;margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:6px}h3{font-size:15px;margin-top:18px}.article{white-space:pre-wrap}li{margin-bottom:6px}@media print{body{margin:0;max-width:none}}</style></head><body><h1>Article Enhancer Output</h1>${sections.join('')}</body></html>`
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
    setStatusMessage('')
    setPhase('done')
  }

  async function runEnhance(): Promise<void> {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    // Optimistic UI: reset everything and start the run state immediately.
    setPhase('streaming')
    setContent('')
    setStatusMessage('')
    setErrorMessage('')
    setElapsed(0)
    setGapData(null)
    setRecData(null)
    setCoverage(null)
    setSections({ ...INITIAL_SECTIONS })
    setStages({ ...INITIAL_STAGES, gapanalysis: 'active' })
    targetAccumRef.current = { article: '', gapanalysis: '', recommendations: '', coverage: '' }
    blockAccumRef.current = {}
    blockTargetRef.current = {}
    gapRef.current = null
    recRef.current = null
    covRef.current = null
    dataPresentRef.current = { article: false, gapanalysis: false, recommendations: false, coverage: false }
    startRef.current = Date.now()

    const resolvedType = contentType === 'Other' ? otherType.trim() : contentType

    // Returns true when the [DONE] sentinel is seen.
    const handleLine = (rawLine: string): boolean => {
      const line = rawLine.trim()
      if (!line.startsWith('data:')) return false
      const payload = line.slice(5).trim()
      if (!payload) return false
      if (payload === '[DONE]') return true
      let parsed: unknown
      try {
        parsed = JSON.parse(payload)
      } catch {
        // Partial or non-JSON line — ignore silently.
        return false
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false
      const event = parsed as { blockId?: unknown; chunk?: unknown }
      const blockId = typeof event.blockId === 'string' ? event.blockId : ''
      const chunk = typeof event.chunk === 'string' ? event.chunk : ''
      if (!chunk) return false
      if (isHeartbeatMessage(chunk)) {
        setStatusMessage(decodeUnicodeEscapes(chunk.trim()))
        return false
      }
      const target = resolveBlockTarget(blockId)
      if (target === 'status-theme' || target === 'status-research') {
        setStatusMessage(statusLabelFor(target))
        return false
      }
      if (target !== null) {
        routeToPanel(target, chunk)
        return false
      }
      // Unknown blockId fallback: accumulate, then classify by content.
      const assigned = blockTargetRef.current[blockId]
      if (assigned) {
        routeToPanel(assigned, chunk)
        return false
      }
      const accumulated = (blockAccumRef.current[blockId] ?? '') + chunk
      blockAccumRef.current[blockId] = accumulated
      const guess = classifyUnknownPayload(accumulated)
      if (guess !== null) {
        blockTargetRef.current[blockId] = guess
        blockAccumRef.current[blockId] = ''
        routeToPanel(guess, accumulated)
      }
      return false
    }

    try {
      const res = await fetch('/api/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          article_url: articleUrl.trim(),
          article_text: articleText.trim(),
          content_type: resolvedType,
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        let message = `Request failed with status ${res.status}.`
        try {
          const data = (await res.json()) as { error?: string }
          if (data.error) message = data.error
        } catch {
          // Keep the default message.
        }
        throw new Error(message)
      }

      const responseType = res.headers.get('content-type') ?? ''

      // Non-streamed JSON fallback.
      if (responseType.includes('application/json')) {
        const data: unknown = await res.json()
        const g = normalizeGapAnalysis(data)
        gapRef.current = g
        if (!isGapAnalysisEmpty(g)) dataPresentRef.current.gapanalysis = true
        setGapData(g)
        const r = normalizeRecommendations(data)
        recRef.current = r
        if (!isRecommendationsEmpty(r)) dataPresentRef.current.recommendations = true
        setRecData(r)
        const c = normalizeCoverage(data)
        covRef.current = c
        if (!isCoverageEmpty(c)) dataPresentRef.current.coverage = true
        setCoverage(c)
        const fallbackArticle = extractArticleContent(data)
        if (fallbackArticle) {
          targetAccumRef.current.article = fallbackArticle
          dataPresentRef.current.article = true
          setContent(decodeUnicodeEscapes(fallbackArticle))
        }
        finishRun()
        return
      }

      if (!res.body) {
        throw new Error('No response body was received from the server.')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finished = false

      while (!finished) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (handleLine(line)) {
            finished = true
            break
          }
        }
      }
      if (!finished) {
        buffer += decoder.decode()
        if (buffer.trim()) handleLine(buffer)
      }

      finishRun()
    } catch (err) {
      if (controller.signal.aborted) return
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setPhase('error')
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!validate()) return
    void runEnhance()
  }

  function handleRetry(): void {
    if (!validate()) return
    void runEnhance()
  }

  function handleCancel(): void {
    abortRef.current?.abort()
    setPhase('idle')
    setStatusMessage('')
    setElapsed(0)
    setContent('')
    setGapData(null)
    setRecData(null)
    setCoverage(null)
    setStages({ ...INITIAL_STAGES })
    setSections({ ...INITIAL_SECTIONS })
    setErrorMessage('')
    targetAccumRef.current = { article: '', gapanalysis: '', recommendations: '', coverage: '' }
    blockAccumRef.current = {}
    blockTargetRef.current = {}
    gapRef.current = null
    recRef.current = null
    covRef.current = null
    dataPresentRef.current = { article: false, gapanalysis: false, recommendations: false, coverage: false }
  }

  function handleDownloadPdf(): void {
    const win = window.open('', '_blank')
    if (!win) return
    win.document.open()
    win.document.write(buildPrintableHtml(content, gapData, recData, coverage))
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

  const hasAnyOutput =
    Boolean(content.trim()) || gapData !== null || recData !== null || coverage !== null
  const showResults = phase === 'streaming' || phase === 'done'

  return (
    <div className="space-y-8">
      <form
        noValidate
        onSubmit={handleSubmit}
        className="card-enter mx-auto w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8"
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
              onChange={(e) => setArticleUrl(e.target.value)}
              placeholder="https://example.com/post"
              aria-invalid={Boolean(errors.articleUrl)}
              aria-describedby={errors.articleUrl ? 'article-url-error' : undefined}
              className={`${inputBase} ${errors.articleUrl ? 'border-rose-300' : 'border-slate-200'}`}
            />
            {errors.articleUrl && (
              <p id="article-url-error" role="alert" className="mt-1.5 text-xs font-medium text-rose-600">
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
              rows={8}
              value={articleText}
              onChange={(e) => setArticleText(e.target.value)}
              placeholder="Paste the full article text here…"
              aria-invalid={Boolean(errors.articleText)}
              aria-describedby={errors.articleText ? 'article-text-error' : undefined}
              className={`${inputBase} resize-y ${errors.articleText ? 'border-rose-300' : 'border-slate-200'}`}
            />
            {errors.articleText && (
              <p id="article-text-error" role="alert" className="mt-1.5 text-xs font-medium text-rose-600">
                {errors.articleText}
              </p>
            )}
          </div>
          <fieldset>
            <legend className="mb-2 block text-sm font-medium text-ink">Content type</legend>
            <div className="flex flex-wrap gap-2">
              {CONTENT_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  aria-pressed={contentType === type}
                  onClick={() => {
                    setContentType(type)
                    setErrors((prev) => ({ ...prev, contentType: undefined }))
                  }}
                  className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:outline-2 focus-visible:outline-accent ${
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
              <p role="alert" className="mt-1.5 text-xs font-medium text-rose-600">
                {errors.contentType}
              </p>
            )}
            {contentType === 'Other' && (
              <div className="mt-3">
                <label htmlFor="other-type" className="mb-1.5 block text-sm font-medium text-ink">
                  Describe your content type
                </label>
                <input
                  id="other-type"
                  type="text"
                  value={otherType}
                  onChange={(e) => setOtherType(e.target.value)}
                  placeholder="e.g. Case study, whitepaper…"
                  aria-invalid={Boolean(errors.otherType)}
                  aria-describedby={errors.otherType ? 'other-type-error' : undefined}
                  className={`${inputBase} ${errors.otherType ? 'border-rose-300' : 'border-slate-200'}`}
                />
                {errors.otherType && (
                  <p id="other-type-error" role="alert" className="mt-1.5 text-xs font-medium text-rose-600">
                    {errors.otherType}
                  </p>
                )}
              </div>
            )}
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={phase === 'streaming'}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-60"
            >
              {phase === 'streaming' ? 'Enhancing…' : 'Enhance article'}
            </button>
            {phase === 'streaming' && (
              <button
                type="button"
                onClick={handleCancel}
                className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-ink-soft transition hover:border-rose-200 hover:text-rose-600"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </form>

      {phase === 'error' && errorMessage ? (
        <div className="mx-auto w-full max-w-3xl">
          <ErrorCard message={errorMessage} onRetry={handleRetry} />
        </div>
      ) : null}

      {showResults && (
        <div className="space-y-5">
          {/* Always-visible top bar: status chip + pipeline progress + PDF export. */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                {phase === 'streaming' ? (
                  <StatusChip
                    message={statusMessage || 'Enhancing your article…'}
                    elapsedSeconds={elapsed}
                  />
                ) : (
                  <span className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800">
                    ✓ Completed in {elapsed}s
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={!hasAnyOutput}
                className="inline-flex shrink-0 items-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-ink transition hover:border-indigo-200 hover:text-accent-deep disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto"
              >
                <span aria-hidden="true">⤓</span>
                Download as PDF
              </button>
            </div>
            <ProgressChecklist stages={checklistStages} />
          </div>

          {/* Tabbed results area — all four sections keep streaming in the background. */}
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
        </div>
      )}
    </div>
  )
}
