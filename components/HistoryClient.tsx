"use client"

import { useCallback, useEffect, useState } from 'react'
import type { HistoryEntry } from '@/lib/types'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'

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
 * history-entry-like values. Handles envelopes such as { output: { "buildhistory.result": [...] } },
 * { result: [...] }, JSON encoded as strings, and arbitrary nesting.
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
  const keyword =
    firstText(rec, ['target_keyword', 'keyword', 'article_url', 'url', 'title', 'topic', 'h1', 'name']) ||
    'Untitled run'
  const client = firstText(rec, ['client', 'brand', 'client_brand', 'company', 'content_type'])
  const timestampRaw = firstText(rec, [
    'timestamp',
    'created_at',
    'createdAt',
    'generated_at',
    'date',
    'time',
    'updated_at',
  ])
  let content = firstText(rec, [
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
    preview: derivePreview(content, keyword),
    content,
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

  if (selected) {
    return (
      <section aria-label="History run detail" className="mx-auto max-w-3xl">
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
          <div className="max-h-[70vh] overflow-y-auto p-5 sm:p-6 lg:p-8">
            {looksLikeJson(selected.content) ? (
              <pre className="overflow-x-auto rounded-xl bg-slate-900 p-4 text-sm leading-relaxed text-slate-100">
                {selected.content}
              </pre>
            ) : (
              <div className="max-w-[68ch]">
                <MarkdownRenderer content={selected.content} />
              </div>
            )}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section aria-label="Previous runs" className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-display text-xs font-semibold uppercase tracking-wider text-ink-soft">
          Previous runs
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-ink-soft transition hover:border-indigo-200 hover:text-accent-deep focus:outline-none focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {loading ? (
        <div className="space-y-3" aria-hidden="true">
          <div className="skeleton-bar h-24 w-full rounded-2xl bg-slate-100" />
          <div className="skeleton-bar h-24 w-full rounded-2xl bg-slate-100" />
          <div className="skeleton-bar h-24 w-5/6 rounded-2xl bg-slate-100" />
        </div>
      ) : error ? (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50/70 p-5 shadow-card">
          <p className="text-sm font-medium text-rose-800">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 inline-flex items-center rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700"
          >
            Try again
          </button>
        </div>
      ) : entries.length === 0 ? (
        <div className="card-enter rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-card">
          <span aria-hidden="true" className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-xl text-accent">
            🕘
          </span>
          <p className="mt-4 text-sm font-medium text-ink">No previous runs yet</p>
          <p className="mt-1 text-sm text-ink-soft">
            Generate your first recommendation to see it here.
          </p>
        </div>
      ) : (
        <ol className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="card-enter">
              <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card transition hover:border-indigo-200 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold text-ink">{entry.keyword}</h3>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                      {entry.client ? (
                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-accent-deep">
                          {entry.client}
                        </span>
                      ) : null}
                      <span className="tabular-nums">{formatTimestamp(entry.timestamp)}</span>
                    </p>
                    <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-ink-soft">{entry.preview}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelected(entry)}
                    className="shrink-0 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white transition hover:bg-accent-deep focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    View
                  </button>
                </div>
              </article>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
