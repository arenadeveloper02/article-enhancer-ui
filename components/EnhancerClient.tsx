"use client"

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type {
  CoverageData,
  EnhanceFormErrors,
  GapAnalysisData,
  RequestPhase,
  SelectedOutputKey,
  StageId,
  StageStatus,
} from '@/lib/types'
import {
  STAGE_ORDER,
  collectSelectedOutputs,
  decodeUnicodeEscapes,
  extractStatusMessage,
  extractToken,
  identifyStage,
  isHeartbeatMessage,
  toPassed,
  toScore,
  toStringList,
  toText,
} from '@/lib/stream'
import { StatusChip } from '@/components/StatusChip'
import { ResultCard } from '@/components/ResultCard'
import { ErrorCard } from '@/components/ErrorCard'
import { ProgressChecklist } from '@/components/ProgressChecklist'
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

const EMPTY_GAP: GapAnalysisData = {
  competitorStrengths: [],
  coverageGaps: [],
  underdevelopedSections: [],
}

const EMPTY_COVERAGE: CoverageData = {
  overallScore: null,
  passed: null,
  summary: '',
  criteria: [],
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
  const [stages, setStages] = useState<Record<StageId, StageStatus>>(INITIAL_STAGES)
  const [gapData, setGapData] = useState<GapAnalysisData | null>(null)
  const [recItems, setRecItems] = useState<string[] | null>(null)
  const [coverage, setCoverage] = useState<CoverageData | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const startRef = useRef(0)

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
    } else if (articleText.trim().length < 40) {
      next.articleText = 'Please paste at least 40 characters of article text.'
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
    setStages((prev) => (prev[id] === 'pending' ? { ...prev, [id]: 'active' } : prev))
  }

  function advanceStage(done: StageId): void {
    setStages((prev) => {
      const next: Record<StageId, StageStatus> = { ...prev }
      const idx = STAGE_ORDER.indexOf(done)
      for (let i = 0; i <= idx; i++) {
        next[STAGE_ORDER[i]] = 'done'
      }
      for (let i = idx + 1; i < STAGE_ORDER.length; i++) {
        const stageId = STAGE_ORDER[i]
        if (next[stageId] === 'active') break
        if (next[stageId] === 'pending') {
          next[stageId] = 'active'
          break
        }
      }
      return next
    })
  }

  function finishRun(): void {
    setStages(() => {
      const next: Record<StageId, StageStatus> = { ...INITIAL_STAGES }
      for (const id of STAGE_ORDER) next[id] = 'done'
      return next
    })
    setStatusMessage('')
    setPhase('done')
  }

  function applyOutputs(outputs: Partial<Record<SelectedOutputKey, unknown>>): boolean {
    let handled = false
    const entries = Object.entries(outputs) as [SelectedOutputKey, unknown][]
    for (const [key, value] of entries) {
      handled = true
      switch (key) {
        case 'gapanalysis.competitor_strengths':
          setGapData((prev) => ({ ...(prev ?? EMPTY_GAP), competitorStrengths: toStringList(value) }))
          advanceStage('gapanalysis')
          break
        case 'gapanalysis.coverage_gaps':
          setGapData((prev) => ({ ...(prev ?? EMPTY_GAP), coverageGaps: toStringList(value) }))
          advanceStage('gapanalysis')
          break
        case 'gapanalysis.underdeveloped_sections':
          setGapData((prev) => ({ ...(prev ?? EMPTY_GAP), underdevelopedSections: toStringList(value) }))
          advanceStage('gapanalysis')
          break
        case 'recommendations.recommendations':
          setRecItems(toStringList(value))
          advanceStage('recommendations')
          break
        case 'enhancedarticlewriter.content': {
          const text = toText(value)
          if (text) setContent((prev) => (text.length >= prev.length ? text : prev))
          advanceStage('enhancedarticlewriter')
          break
        }
        case 'coverageverifier.overall_score':
          setCoverage((prev) => ({ ...(prev ?? EMPTY_COVERAGE), overallScore: toScore(value) }))
          advanceStage('coverageverifier')
          break
        case 'coverageverifier.passed':
          setCoverage((prev) => ({ ...(prev ?? EMPTY_COVERAGE), passed: toPassed(value) }))
          advanceStage('coverageverifier')
          break
        case 'coverageverifier.summary':
          setCoverage((prev) => ({ ...(prev ?? EMPTY_COVERAGE), summary: toText(value) }))
          advanceStage('coverageverifier')
          break
        case 'coverageverifier.criteria':
          setCoverage((prev) => ({ ...(prev ?? EMPTY_COVERAGE), criteria: toStringList(value) }))
          advanceStage('coverageverifier')
          break
      }
    }
    return handled
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
    setRecItems(null)
    setCoverage(null)
    setStages({ ...INITIAL_STAGES, gapanalysis: 'active' })
    startRef.current = Date.now()

    const resolvedType = contentType === 'Other' ? otherType.trim() : contentType

    const handleLine = (rawLine: string): void => {
      let line = rawLine.trim()
      if (!line) return
      if (line.startsWith('data:')) {
        line = line.slice(5).trim()
      } else if (
        line.startsWith('event:') ||
        line.startsWith('id:') ||
        line.startsWith('retry:') ||
        line.startsWith(':')
      ) {
        return
      }
      if (!line || line === '[DONE]') return

      try {
        const parsed: unknown = JSON.parse(line)
        const status = extractStatusMessage(parsed)
        if (status) {
          setStatusMessage(decodeUnicodeEscapes(status))
          return
        }
        const outputs = collectSelectedOutputs(parsed)
        const handledOutputs = applyOutputs(outputs)
        const stage = identifyStage(parsed)
        if (handledOutputs) return
        const token = extractToken(parsed)
        if (token !== null) {
          if (isHeartbeatMessage(token)) {
            setStatusMessage(decodeUnicodeEscapes(token))
            return
          }
          if (stage === null || stage === 'enhancedarticlewriter') {
            activateStage('enhancedarticlewriter')
            setContent((prev) => prev + decodeUnicodeEscapes(token))
          } else {
            activateStage(stage)
          }
          return
        }
        if (stage !== null) activateStage(stage)
        return
      } catch {
        // Not JSON — treat as plain text below.
      }

      if (isHeartbeatMessage(line)) {
        setStatusMessage(decodeUnicodeEscapes(line))
        return
      }
      activateStage('enhancedarticlewriter')
      setContent((prev) => prev + decodeUnicodeEscapes(line) + '\n')
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

      // Non-streamed JSON fallback
      if (responseType.includes('application/json')) {
        const data: unknown = await res.json()
        const status = extractStatusMessage(data)
        const outputs = collectSelectedOutputs(data)
        const handled = applyOutputs(outputs)
        if (!handled && !status) {
          const token = extractToken(data)
          if (token !== null) {
            setContent(decodeUnicodeEscapes(token))
          } else {
            setContent(decodeUnicodeEscapes(JSON.stringify(data, null, 2)))
          }
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

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) handleLine(line)
      }
      buffer += decoder.decode()
      if (buffer.trim()) handleLine(buffer)

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
    setRecItems(null)
    setCoverage(null)
    setStages(INITIAL_STAGES)
    setErrorMessage('')
  }

  const isStreaming = phase === 'streaming'
  const showChecklist = phase === 'streaming' || phase === 'done'
  const showArticleCard =
    phase === 'done' ||
    content.length > 0 ||
    (phase === 'streaming' && stages.enhancedarticlewriter !== 'pending')

  return (
    <div className="space-y-6">
      <form
        onSubmit={handleSubmit}
        noValidate
        className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8"
      >
        <div className="space-y-5">
          <div>
            <label htmlFor="article-url" className="mb-1.5 block text-sm font-medium text-ink">
              Article URL <span className="text-accent">*</span>
            </label>
            <input
              id="article-url"
              type="text"
              inputMode="url"
              value={articleUrl}
              onChange={(e) => {
                setArticleUrl(e.target.value)
                if (errors.articleUrl) setErrors((prev) => ({ ...prev, articleUrl: undefined }))
              }}
              placeholder="https://example.com/my-article"
              aria-invalid={Boolean(errors.articleUrl)}
              aria-describedby={errors.articleUrl ? 'article-url-error' : undefined}
              className={`${inputBase} ${errors.articleUrl ? 'border-rose-400' : 'border-slate-200'}`}
            />
            {errors.articleUrl && (
              <p id="article-url-error" className="mt-1.5 text-xs font-medium text-rose-600">
                {errors.articleUrl}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="article-text" className="mb-1.5 block text-sm font-medium text-ink">
              Article Text <span className="text-accent">*</span>
            </label>
            <textarea
              id="article-text"
              rows={8}
              value={articleText}
              onChange={(e) => {
                setArticleText(e.target.value)
                if (errors.articleText) setErrors((prev) => ({ ...prev, articleText: undefined }))
              }}
              placeholder="Paste the full article text here…"
              aria-invalid={Boolean(errors.articleText)}
              aria-describedby={errors.articleText ? 'article-text-error' : undefined}
              className={`${inputBase} resize-y ${errors.articleText ? 'border-rose-400' : 'border-slate-200'}`}
            />
            {errors.articleText && (
              <p id="article-text-error" className="mt-1.5 text-xs font-medium text-rose-600">
                {errors.articleText}
              </p>
            )}
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="content-type" className="mb-1.5 block text-sm font-medium text-ink">
                Content Type <span className="text-accent">*</span>
              </label>
              <select
                id="content-type"
                value={contentType}
                onChange={(e) => {
                  setContentType(e.target.value)
                  if (errors.contentType) setErrors((prev) => ({ ...prev, contentType: undefined }))
                }}
                aria-invalid={Boolean(errors.contentType)}
                aria-describedby={errors.contentType ? 'content-type-error' : undefined}
                className={`${inputBase} appearance-none ${errors.contentType ? 'border-rose-400' : 'border-slate-200'}`}
              >
                <option value="" disabled>
                  Select a content type…
                </option>
                {CONTENT_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {option}
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
                  Describe it <span className="text-accent">*</span>
                </label>
                <input
                  id="other-type"
                  type="text"
                  value={otherType}
                  onChange={(e) => {
                    setOtherType(e.target.value)
                    if (errors.otherType) setErrors((prev) => ({ ...prev, otherType: undefined }))
                  }}
                  placeholder="e.g. Case Study, Newsletter…"
                  aria-invalid={Boolean(errors.otherType)}
                  aria-describedby={errors.otherType ? 'other-type-error' : undefined}
                  className={`${inputBase} ${errors.otherType ? 'border-rose-400' : 'border-slate-200'}`}
                />
                {errors.otherType && (
                  <p id="other-type-error" className="mt-1.5 text-xs font-medium text-rose-600">
                    {errors.otherType}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={isStreaming}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isStreaming && (
                <span
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none"
                />
              )}
              {isStreaming ? 'Enhancing…' : 'Enhance Article'}
            </button>
            {isStreaming && (
              <button
                type="button"
                onClick={handleCancel}
                className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-ink-soft shadow-sm transition hover:border-slate-300 hover:text-ink"
              >
                Cancel
              </button>
            )}
          </div>
          <p className="text-xs text-slate-400">
            <span className="text-accent">*</span> Required fields
          </p>
        </div>
      </form>

      {isStreaming && (
        <div className="card-enter">
          <StatusChip
            message={statusMessage || 'Contacting the enhancement agent…'}
            elapsedSeconds={elapsed}
          />
        </div>
      )}

      {showChecklist && (
        <ProgressChecklist
          stages={STAGE_ORDER.map((id) => ({ id, label: STAGE_LABELS[id], status: stages[id] }))}
        />
      )}

      {gapData && <GapAnalysisCard data={gapData} />}

      {recItems && recItems.length > 0 && <RecommendationsCard items={recItems} />}

      {showArticleCard && (
        <div className="card-enter">
          <h2 className="mb-2 px-1 font-display text-xs font-semibold uppercase tracking-wider text-ink-soft">
            Enhanced Article
          </h2>
          <ResultCard content={content} streaming={isStreaming} />
        </div>
      )}

      {coverage && <CoverageCard data={coverage} />}

      {phase === 'error' && <ErrorCard message={errorMessage} onRetry={handleRetry} />}
    </div>
  )
}
