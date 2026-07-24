"use client"

import { useState } from 'react'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { SectionHeader } from '@/components/SectionHeader'
import type { SectionStatus } from '@/lib/types'

interface ResultCardProps {
  content: string
  status: SectionStatus
}

export function ResultCard({ content, status }: ResultCardProps) {
  const [copied, setCopied] = useState(false)
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0

  function handleCopy(): void {
    void navigator.clipboard
      .writeText(content)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => undefined)
  }

  return (
    <section
      aria-label="Enhanced article"
      className="card-enter relative overflow-hidden rounded-2xl border-2 border-indigo-200 bg-white shadow-card"
    >
      {status === 'streaming' && <div className="gradient-line absolute inset-x-0 top-0 h-1" aria-hidden="true" />}
      <div className="p-6 sm:p-8">
        <SectionHeader
          title="Enhanced Article"
          icon="✍"
          status={status}
          accent
          actions={
            <>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-slate-600">
                {wordCount} {wordCount === 1 ? 'word' : 'words'}
              </span>
              {content ? (
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
        {content ? (
          <div className="max-w-[68ch]">
            <MarkdownRenderer content={content} />
            {status === 'streaming' && (
              <span
                aria-hidden="true"
                className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-accent align-middle motion-reduce:animate-none"
              />
            )}
          </div>
        ) : status === 'done' ? (
          <p className="text-sm italic text-slate-400">No data</p>
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
