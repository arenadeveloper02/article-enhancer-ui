"use client"

import { useRef, useState } from 'react'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { SectionHeader } from '@/components/SectionHeader'
import { preprocessArticleContent, stripArticleMarkers } from '@/lib/normalize'
import { stripBoilerplateListBlocks } from '@/lib/boilerplate'
import { formatEnhancedMarkdown } from '@/lib/format'
import type { SectionStatus } from '@/lib/types'

interface ResultCardProps {
  content: string
  status: SectionStatus
  embedded?: boolean
  articleUrl?: string
}

export function ResultCard({ content, status, embedded = false, articleUrl }: ResultCardProps) {
  const [copied, setCopied] = useState(false)

  // Shared preprocessing pipeline before rendering:
  //  1. preprocessArticleContent: <br> -> real line breaks, [+ADDED]...[/ADDED]
  //     -> inline <mark> highlights (progressive while streaming). The raw
  //     marker tokens never reach the renderer or the clipboard.
  //  2. stripBoilerplateListBlocks: defensive filter that removes scraped
  //     nav/footer-style link-only list blocks.
  //  3. formatEnhancedMarkdown (presentation only): strips raw JSON code
  //     blocks, bare JSON dumps AND trailing structured-data dumps (coverage
  //     arrays, citation lists, bare scores/booleans) so machine payloads
  //     never appear in the UI; decodes unicode escapes so \uXXXX codes are
  //     never shown as text; normalizes markdown tables to consistent column
  //     counts; and normalizes em/en dash clause separators to natural
  //     punctuation. Streaming-safe: JSON is only removed once structurally
  //     complete.
  const formattedDisplay = formatEnhancedMarkdown(
    stripBoilerplateListBlocks(preprocessArticleContent(content)),
  )
  // UI FIX (post-stream blanking): once streaming completes, the FINAL
  // payload can collapse into a shape the presentation formatter strips
  // entirely (e.g. the closing chunk turns the accumulated text into one
  // structurally complete JSON dump, which formatEnhancedMarkdown removes),
  // or the parent can momentarily clear `content` while finalizing. Either
  // way the formatted output goes empty AFTER the article already rendered,
  // wiping the Enhanced Article tab at completion. Remember the last
  // non-empty render and keep showing it whenever the fresh formatting pass
  // comes back empty \u2014 the article never disappears once it has been shown.
  const lastDisplayRef = useRef('')
  if (formattedDisplay.trim()) {
    lastDisplayRef.current = formattedDisplay
  }
  const displayContent = formattedDisplay.trim()
    ? formattedDisplay
    : lastDisplayRef.current.trim()
      ? lastDisplayRef.current
      : stripBoilerplateListBlocks(preprocessArticleContent(content))
  // Clipboard copy gets the same presentation cleanup so copied text matches
  // exactly what is rendered on screen (minus the highlight marks) \u2014 with the
  // same last-good fallback so Copy keeps working after the stream finishes.
  const formattedClean = formatEnhancedMarkdown(stripArticleMarkers(content))
  const lastCleanRef = useRef('')
  if (formattedClean.trim()) {
    lastCleanRef.current = formattedClean
  }
  const cleanContent = formattedClean.trim()
    ? formattedClean
    : lastCleanRef.current.trim()
      ? lastCleanRef.current
      : stripArticleMarkers(content)
  const wordCount = cleanContent.trim() ? cleanContent.trim().split(/\s+/).length : 0

  function handleCopy(): void {
    void navigator.clipboard
      .writeText(cleanContent)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => undefined)
  }

  return (
    <section
      aria-label="Enhanced article"
      className={
        embedded
          ? 'relative'
          : 'card-enter relative overflow-hidden rounded-2xl border-2 border-indigo-200 bg-white shadow-card'
      }
    >
      {status === 'streaming' && !embedded && (
        <div className="gradient-line absolute inset-x-0 top-0 h-1" aria-hidden="true" />
      )}
      <div className={embedded ? '' : 'p-6 sm:p-8'}>
        <SectionHeader
          title="Enhanced Article"
          icon="\u270D"
          status={status}
          accent
          actions={
            <>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-slate-600">
                {wordCount} {wordCount === 1 ? 'word' : 'words'}
              </span>
              {cleanContent.trim() ? (
                <button
                  type="button"
                  onClick={handleCopy}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-ink-soft transition hover:border-indigo-200 hover:text-accent-deep"
                >
                  {copied ? 'Copied!' : 'Copy article'}
                </button>
              ) : null}
            </>
          }
        />
        {displayContent.trim() ? (
          // Full-width article column: headings, lists and markdown tables use
          // the entire available panel width instead of a narrow 68ch strip,
          // so comparison tables and sectioned lists read clearly across the
          // tab. Line lengths stay comfortable because the surrounding panel
          // already caps overall width.
          <div className="w-full">
            <MarkdownRenderer content={displayContent} baseUrl={articleUrl} />
            {status === 'streaming' && (
              <span
                aria-hidden="true"
                className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-accent align-middle motion-reduce:animate-none"
              />
            )}
          </div>
        ) : status === 'done' || status === 'empty' ? (
          <p className="text-sm italic text-slate-400">No data returned for this section.</p>
        ) : (
          <div className="space-y-3" aria-hidden="true">
            <div className="skeleton-bar h-6 w-2/3 rounded-lg bg-slate-100" />
            <div className="skeleton-bar h-4 w-full rounded-lg bg-slate-100" />
            <div className="skeleton-bar h-4 w-11/12 rounded-lg bg-slate-100" />
            <div className="skeleton-bar h-4 w-4/5 rounded-lg bg-slate-100" />
            <div className="skeleton-bar mt-6 h-5 w-1/2 rounded-lg bg-slate-100" />
            <div className="skeleton-bar h-4 w-full rounded-lg bg-slate-100" />
            <div className="skeleton-bar h-4 w-3/4 rounded-lg bg-slate-100" />
          </div>
        )}
      </div>
    </section>
  )
}
