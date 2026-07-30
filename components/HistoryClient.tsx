"use client"

import { useCallback, useEffect, useState } from 'react'
import type { HistoryEntry } from '@/lib/types'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { ResultTabs } from '@/components/ResultTabs'
import { PrintableReport } from '@/components/PrintableReport'
import { normalizeCoverage, normalizeGapAnalysis, normalizeRecommendations } from '@/lib/normalize'

// NOTE: History lives in in-memory React state only — it is re-fetched from
// the build-history workflow each time this view mounts and resets on page
// reload. Cross-session persistence comes from that backend workflow, not
// from any browser storage.

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function valueToText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null || value === undefined) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}

function firstText(rec: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    if (key in rec) {
      const text = valueToText(rec[key]).trim()
      if (text) return text
    }
  }
  return ''
}

/**
 * Breadth-first search across the upstream response for the first array of
 * history-entry-like values. Handles envelopes such as
 * { output: { result: { history: [...] } } }, { result: [...] }, JSON encoded
 * as strings, and arbitrary nesting.
 */
function extractEntriesSource(data: unknown): unknown[] {
  const queue: unknown[] = [data]
  const seen = new Set<Record<string, unknown>>()
  let guard = 0
  while (queue.length > 0 && guard < 500) {
    guard++
    const current = queue.shift()
    if (current === null || current === undefined) continue
    if (typeof current === 'string') {
      const trimmed = current.trim()
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
          queue.push(JSON.parse(trimmed) as unknown)
        } catch {
          // Not parseable JSON — ignore.
        }
      }
      continue
    }
    if (Array.isArray(current)) {
      if (current.length > 0 && current.every((item) => isRecord(item) || typeof item === 'string')) {
        return current
      }
      for (const item of current) queue.push(item)
      continue
    }
    if (isRecord(current)) {
      if (seen.has(current)) continue
      seen.add(current)
      // Prefer an explicit history array when present.
      const history = current['history']
      if (Array.isArray(history) && history.length > 0 && history.every((item) => isRecord(item))) {
        return history
      }
      for (const value of Object.values(current)) queue.push(value)
    }
  }
  return []
}

function derivePreview(content: string, fallback: string): string {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const heading = lines.find((line) => /^#{1,3}\s+/.test(line))
  const source = heading ? heading.replace(/^#{1,3}\s+/, '') : (lines[0] ?? fallback)
  const clean = source.trim()
  if (!clean) return fallback
  return clean.length > 140 ? `${clean.slice(0, 140).trim()}…` : clean
}

function toHistoryEntry(raw: unknown, index: number): HistoryEntry {
  if (typeof raw === 'string') {
    const text = raw.trim()
    return {
      id: `history-${index}`,
      keyword: derivePreview(text, 'Untitled run'),
      client: '',
      timestamp: null,
      preview: derivePreview(text, 'Untitled run'),
      content: text,
    }
  }
  const rec = isRecord(raw) ? raw : {}

  // Structured build-history entries carry input (article_url / content_type)
  // and output (gap_analysis / recommendations / enhanced_article /
  // coverage_report) — mirror the Generator's data shape from them.
  const input = isRecord(rec.input) ? rec.input : null
  const output = isRecord(rec.output) ? rec.output : null

  const articleUrl =
    (input ? firstText(input, ['article_url', 'url']) : '') || firstText(rec, ['article_url', 'url'])
  const contentType =
    (input ? firstText(input, ['content_type', 'contentType']) : '') ||
    firstText(rec, ['content_type', 'contentType'])

  const enhancedRaw = output ? output['enhanced_article'] : undefined
  const articleContent = typeof enhancedRaw === 'string' ? enhancedRaw : ''
  const gapData = output && 'gap_analysis' in output ? normalizeGapAnalysis(output['gap_analysis']) : null
  const recData =
    output && 'recommendations' in output ? normalizeRecommendations(output['recommendations']) : null
  const coverageData =
    output && 'coverage_report' in output ? normalizeCoverage(output['coverage_report']) : null

  const keyword =
    articleUrl ||
    firstText(rec, ['target_keyword', 'keyword', 'title', 'topic', 'h1', 'name']) ||
    'Untitled run'
  const client = contentType || firstText(rec, ['client', 'brand', 'client_brand', 'company'])
  // createdAt is the canonical run timestamp from the API response — it is
  // checked first (top level, then output/input envelopes) so the History
  // list shows the real date/time instead of "Unknown time".
  const timestampRaw =
    firstText(rec, ['createdAt', 'created_at', 'timestamp', 'generated_at', 'date', 'time', 'updated_at']) ||
    (output ? firstText(output, ['createdAt', 'created_at', 'timestamp']) : '') ||
    (input ? firstText(input, ['createdAt', 'created_at', 'timestamp']) : '')
  let content =
    articleContent ||
    firstText(rec, [
      'output',
      'result',
      'content',
      'article',
      'enhanced_article',
      'markdown',
      'recommendations',
      'body',
      'text',
      'data',
    ])
  if (!content) content = valueToText(rec)
  return {
    id: firstText(rec, ['id', '_id', 'uuid', 'run_id']) || `history-${index}`,
    keyword,
    client,
    timestamp: timestampRaw || null,
    preview: derivePreview(articleContent || content, keyword),
    content,
    articleUrl: articleUrl || undefined,
    contentType: contentType || undefined,
    articleContent: articleContent || undefined,
    gapData,
    recData,
    coverageData,
  }
}

function normalizeHistory(data: unknown): HistoryEntry[] {
  const source = extractEntriesSource(data)
  const entries = source.map((raw, index) => toHistoryEntry(raw, index))
  // Reverse-chronological (newest first) when timestamps parse; entries
  // without a parseable timestamp keep their original relative order at the end.
  const ranked = entries.map((entry, index) => {
    const ms = entry.timestamp ? Date.parse(entry.timestamp) : Number.NaN
    return { entry, index, ms: Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY }
  })
  ranked.sort((a, b) => (a.ms === b.ms ? a.index - b.index : b.ms - a.ms))
  return ranked.map((r) => r.entry)
}

function formatTimestamp(value: string | null): string {
  if (!value) return 'Unknown time'
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return value
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function looksLikeJson(content: string): boolean {
  const trimmed = content.trim()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

function hasStructuredResults(entry: HistoryEntry): boolean {
  return (
    (typeof entry.articleContent === 'string' && entry.articleContent.trim().length > 0) ||
    entry.gapData != null ||
    entry.recData != null ||
    entry.coverageData != null
  )
}

export function HistoryClient() {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<HistoryEntry | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/history', { cache: 'no-store' })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error || `History request failed (${res.status}).`)
      }
      const data: unknown = await res.json()
      setEntries(normalizeHistory(data))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load history.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleExport(): Promise<void> {
    try {
      await document.fonts.ready
    } catch {
      // Fonts API unavailable — print with whatever is loaded.
    }
    window.print()
  }

  if (selected) {
    // Structured runs render the EXACT same tabbed format as the Generator
    // (Enhanced Article / Coverage Verification / Gap Analysis /
    // Recommendations) via the shared ResultTabs component. The article view
    // always opens full-screen with an explicit Back button (no collapse
    // toggle) plus the same Export behavior as the Generator flow. The
    // print-only PrintableReport mirror powers the Export output.
    if (hasStructuredResults(selected)) {
      const articleText = selected.articleContent ?? ''
      return (
        <section aria-label="History run detail" className="mx-auto max-w-4xl">
          <div className="screen-only">
            <div className="card-enter mb-4 flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-card sm:px-6">
              <div className="min-w-0">
                <h2 className="truncate font-display text-lg font-semibold text-ink">
                  {selected.articleUrl || selected.keyword}
                </h2>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                  {selected.contentType ? (
                    <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-accent-deep">
                      {selected.contentType}
                    </span>
                  ) : null}
                  <span className="tabular-nums">{formatTimestamp(selected.timestamp)}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Read-only
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="shrink-0 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-ink-soft transition hover:border-indigo-200 hover:text-accent-deep focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
              >
                ← Back to history
              </button>
            </div>
            <ResultTabs
              content={articleText}
              articleStatus={articleText.trim() ? 'done' : 'empty'}
              coverageData={selected.coverageData ?? null}
              coverageStatus={selected.coverageData ? 'done' : 'empty'}
              gapData={selected.gapData ?? null}
              gapStatus={selected.gapData ? 'done' : 'empty'}
              recData={selected.recData ?? null}
              recStatus={selected.recData ? 'done' : 'empty'}
              articleUrl={selected.articleUrl}
              onBack={() => setSelected(null)}
              onExport={() => {
                void handleExport()
              }}
            />
          </div>
          <PrintableReport
            content={articleText}
            articleStatus={articleText.trim() ? 'done' : 'empty'}
            coverageData={selected.coverageData ?? null}
            coverageStatus={selected.coverageData ? 'done' : 'empty'}
            gapData={selected.gapData ?? null}
            gapStatus={selected.gapData ? 'done' : 'empty'}
            recData={selected.recData ?? null}
            recStatus={selected.recData ? 'done' : 'empty'}
            articleUrl={selected.articleUrl}
          />
        </section>
      )
    }

    // Legacy / unstructured runs fall back to the raw markdown / JSON view.
    return (
      <section aria-label="History run detail" className="screen-only mx-auto max-w-4xl">
        <div className="card-enter overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-indigo-50/40 px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <h2 className="truncate font-display text-lg font-semibold text-ink">{selected.keyword}</h2>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                {selected.client ? (
                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-accent-deep">
                    {selected.client}
                  </span>
                ) : null}
                <span className="tabular-nums">{formatTimestamp(selected.timestamp)}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Read-only
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="shrink-0 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-ink-soft transition hover:border-indigo-200 hover:text-accent-deep focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
            >
              ← Back to history
            </button>
          </div>
          <div className="p-5 sm:p-6">
            {looksLikeJson(selected.content) ? (
              <pre className="overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
                {selected.content}
              </pre>
            ) : (
              <MarkdownRenderer content={selected.content} baseUrl={selected.articleUrl} />
            )}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section aria-label="Previous runs" className="screen-only mx-auto max-w-4xl">
      <div className="card-enter rounded-2xl border border-slate-200 bg-white shadow-card">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
          <h2 className="font-display text-xs font-semibold uppercase tracking-wider text-ink-soft">
            Previous runs
          </h2>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-ink-soft transition hover:border-indigo-200 hover:text-accent-deep focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          >
            Refresh
          </button>
        </div>
        {loading ? (
          <div className="space-y-3 p-5 sm:p-6" aria-hidden="true">
            <div className="skeleton-bar h-14 w-full rounded-xl bg-slate-100" />
            <div className="skeleton-bar h-14 w-full rounded-xl bg-slate-100" />
            <div className="skeleton-bar h-14 w-5/6 rounded-xl bg-slate-100" />
          </div>
        ) : error ? (
          <div className="p-5 sm:p-6">
            <p className="text-sm text-rose-700">{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-ink-soft transition hover:border-indigo-200 hover:text-accent-deep"
            >
              Try again
            </button>
          </div>
        ) : entries.length === 0 ? (
          <p className="p-5 text-sm italic text-slate-400 sm:p-6">No previous runs yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{entry.keyword}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                    {entry.contentType || entry.client ? (
                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-accent-deep">
                        {entry.contentType || entry.client}
                      </span>
                    ) : null}
                    <span className="tabular-nums">{formatTimestamp(entry.timestamp)}</span>
                  </p>
                  <p className="mt-1 truncate text-xs text-slate-400">{entry.preview}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(entry)}
                  className="shrink-0 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-ink-soft transition hover:border-indigo-200 hover:text-accent-deep focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
                >
                  View
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
