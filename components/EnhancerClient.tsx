"use client"

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { EnhanceFormErrors, RequestPhase } from '@/lib/types'
import {
  decodeUnicodeEscapes,
  extractStatusMessage,
  extractToken,
  isHeartbeatMessage,
} from '@/lib/stream'
import { StatusChip } from '@/components/StatusChip'
import { ResultCard } from '@/components/ResultCard'
import { ErrorCard } from '@/components/ErrorCard'

const CONTENT_TYPES = ['Blog Post', 'Landing Page', 'Guide', 'News', 'Product Page', 'Other'] as const

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

  async function runEnhance(): Promise<void> {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setPhase('streaming')
    setContent('')
    setStatusMessage('')
    setErrorMessage('')
    setElapsed(0)
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
        const token = extractToken(parsed)
        if (token !== null) {
          if (isHeartbeatMessage(token)) {
            setStatusMessage(decodeUnicodeEscapes(token))
            return
          }
          setContent((prev) => prev + decodeUnicodeEscapes(token))
        }
        return
      } catch {
        // Not JSON — treat as plain text below.
      }

      if (isHeartbeatMessage(line)) {
        setStatusMessage(decodeUnicodeEscapes(line))
        return
      }
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
        const token = status ? null : extractToken(data)
        if (token !== null) {
          setContent(decodeUnicodeEscapes(token))
        } else if (!status) {
          setContent(decodeUnicodeEscapes(JSON.stringify(data, null, 2)))
        }
        setPhase('done')
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

      setPhase('done')
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

  const isStreaming = phase === 'streaming'
  const showResult = phase === 'streaming' || phase === 'done'

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
          <button
            type="submit"
            disabled={isStreaming}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isStreaming ? (
              <>
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:hidden"
                  aria-hidden="true"
                />
                Enhancing…
              </>
            ) : (
              'Enhance Article'
            )}
          </button>
          {isStreaming && (
            <StatusChip
              message={statusMessage || 'Enhancing your article'}
              elapsedSeconds={elapsed}
            />
          )}
        </div>
      </form>

      {phase === 'error' && <ErrorCard message={errorMessage} onRetry={handleRetry} />}

      {showResult && <ResultCard content={content} streaming={isStreaming} />}
    </div>
  )
}
