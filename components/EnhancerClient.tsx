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
  normalizeCoverage,
  normalizeGapAnalysis,
  normalizeRecommendations,
} from '@/lib/normalize'
import { StatusChip } from '@/components/StatusChip'
import { ResultCard } from '@/components/ResultCard'
import { ErrorCard } from '@/components/ErrorCard'
import { ProgressChecklist } from '@/components/ProgressChecklist'
import type { ChecklistStage } from '@/components/ProgressChecklist'
import { GapAnalysisCard } from '@/components/GapAnalysisCard'
import { RecommendationsCard } from '@/components/RecommendationsCard'
import { CoverageCard } from '@/components/CoverageCard'

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

const inputBase =
  'w-full rounded-xl border bg-white px-4 py-2.5 text-sm text-ink shadow-sm transition placeholder:text-slate-400 focus:outline-none focus-visible:outline-2 focus-visible:outline-accent'

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

  function activateStage(id: StageId): void {
    setStages((prev) => {
      if (prev[id] !== 'pending') return prev
      const next: Record<StageId, StageStatus> = { ...prev }
      for (const stageId of STAGE_ORDER) {
        if (stageId !== id && next[stageId] === 'active') next[stageId] = 'done'
      }
      next[id] = 'active'
      return next
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
      setContent(decodeUnicodeEscapes(targetAccumRef.current.article))
      return
    }
    const parsed = extractBalancedJson(targetAccumRef.current[key])
    if (parsed === null) return
    if (key === 'gapanalysis') {
      setGapData(normalizeGapAnalysis(parsed))
    } else if (key === 'recommendations') {
      setRecData(normalizeRecommendations(parsed))
    } else {
      setCoverage(normalizeCoverage(parsed))
    }
  }

  function finishRun(): void {
    setStages(() => {
      const next: Record<StageId, StageStatus> = { ...INITIAL_STAGES }
      for (const id of STAGE_ORDER) next[id] = 'done'
      return next
    })
    setSections({ article: 'done', gapanalysis: 'done', recommendations: 'done', coverage: 'done' })
    setStatusMessage('')
    const gapText = targetAccumRef.current.gapanalysis
    if (gapText.trim()) {
      setGapData((prev) => prev ?? normalizeGapAnalysis(gapText))
    }
    const recText = targetAccumRef.current.recommendations
    if (recText.trim()) {
      setRecData((prev) => prev ?? normalizeRecommendations(recText))
    }
    const covText = targetAccumRef.current.coverage
    if (covText.trim()) {
      setCoverage((prev) => prev ?? normalizeCoverage(covText))
    }
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
        setGapData(normalizeGapAnalysis(data))
        setRecData(normalizeRecommendations(data))
        setCoverage(normalizeCoverage(data))
        const fallbackArticle = extractArticleContent(data)
        if (fallbackArticle) {
          targetAccumRef.current.article = fallbackArticle
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
  }

  const checklistStages: ChecklistStage[] = STAGE_ORDER.map((id) => ({
    id,
    label: STAGE_LABELS[id],
    status: stages[id],
  }))

  const streaming = phase === 'streaming'

  return (
    <div className="space-y-8">
      <form
        onSubmit={handleSubmit}
        noValidate
        className="card-enter rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8"
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
              disabled={streaming}
              aria-invalid={Boolean(errors.articleUrl)}
              className={`${inputBase} ${errors.articleUrl ? 'border-rose-300' : 'border-slate-200'}`}
            />
            {errors.articleUrl && <p className="mt-1.5 text-xs text-rose-600">{errors.articleUrl}</p>}
          </div>
          <div>
            <label htmlFor="article-text" className="mb-1.5 block text-sm font-medium text-ink">
              Article Text
            </label>
            <textarea
              id="article-text"
              value={articleText}
              onChange={(e) => setArticleText(e.target.value)}
              rows={8}
              placeholder="Paste the full article text here…"
              disabled={streaming}
              aria-invalid={Boolean(errors.articleText)}
              className={`${inputBase} resize-y ${errors.articleText ? 'border-rose-300' : 'border-slate-200'}`}
            />
            {errors.articleText && <p className="mt-1.5 text-xs text-rose-600">{errors.articleText}</p>}
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="content-type" className="mb-1.5 block text-sm font-medium text-ink">
                Content Type
              </label>
              <select
                id="content-type"
                value={contentType}
                onChange={(e) => setContentType(e.target.value)}
                disabled={streaming}
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
              {errors.contentType && <p className="mt-1.5 text-xs text-rose-600">{errors.contentType}</p>}
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
                  onChange={(e) => setOtherType(e.target.value)}
                  placeholder="e.g. Case study"
                  disabled={streaming}
                  aria-invalid={Boolean(errors.otherType)}
                  className={`${inputBase} ${errors.otherType ? 'border-rose-300' : 'border-slate-200'}`}
                />
                {errors.otherType && <p className="mt-1.5 text-xs text-rose-600">{errors.otherType}</p>}
              </div>
            )}
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={streaming}
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-60"
          >
            {streaming ? (
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
          {streaming && (
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-ink-soft transition hover:border-rose-200 hover:text-rose-600"
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      {streaming && (
        <StatusChip message={statusMessage || 'Enhancing your article…'} elapsedSeconds={elapsed} />
      )}

      {phase !== 'idle' && (
        <>
          <ProgressChecklist stages={checklistStages} />
          {phase === 'error' ? (
            <ErrorCard message={errorMessage} onRetry={handleRetry} />
          ) : (
            <div className="space-y-6">
              <ResultCard content={content} status={sections.article} />
              <GapAnalysisCard data={gapData} status={sections.gapanalysis} />
              <RecommendationsCard data={recData} status={sections.recommendations} />
              <CoverageCard data={coverage} status={sections.coverage} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
