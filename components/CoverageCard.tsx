"use client"

import { useState } from 'react'
import type { CoverageData, SectionStatus } from '@/lib/types'
import { SectionHeader } from '@/components/SectionHeader'

interface CoverageCardProps {
  data: CoverageData | null
  status: SectionStatus
  embedded?: boolean
}

function scoreClasses(score: number): string {
  if (score >= 80) return 'border-emerald-300 bg-emerald-50 text-emerald-700'
  if (score >= 60) return 'border-amber-300 bg-amber-50 text-amber-700'
  return 'border-rose-300 bg-rose-50 text-rose-700'
}

export function CoverageCard({ data, status, embedded = false }: CoverageCardProps) {
  const [expandedJustifications, setExpandedJustifications] = useState<Set<number>>(new Set())

  function toggleJustification(index: number): void {
    setExpandedJustifications((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  const showSkeleton = data === null && status !== 'done' && status !== 'empty'
  return (
    <section
      aria-label="Coverage verification"
      className={
        embedded ? '' : 'card-enter rounded-2xl border border-slate-200 bg-white p-5 shadow-card sm:p-6'
      }
    >
      <SectionHeader title="Coverage Verification" icon="✔" status={status} />
      {showSkeleton ? (
        <div className="flex items-center gap-5" aria-hidden="true">
          <div className="skeleton-bar h-20 w-20 shrink-0 rounded-full bg-slate-100" />
          <div className="flex-1 space-y-3">
            <div className="skeleton-bar h-4 w-1/4 rounded-lg bg-slate-100" />
            <div className="skeleton-bar h-4 w-full rounded-lg bg-slate-100" />
            <div className="skeleton-bar h-4 w-2/3 rounded-lg bg-slate-100" />
          </div>
        </div>
      ) : status === 'empty' || data === null ? (
        <p className="text-sm italic text-slate-400">No data returned for this section.</p>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-4">
            {data.overall_score !== null ? (
              <div
                aria-label={`Overall score ${Math.round(data.overall_score)} out of 100`}
                className={`flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-full border-4 ${scoreClasses(data.overall_score)}`}
              >
                <span className="font-display text-xl font-bold leading-none">
                  {Math.round(data.overall_score)}
                </span>
                <span className="mt-0.5 text-[10px] font-semibold uppercase opacity-70">/ 100</span>
              </div>
            ) : (
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-4 border-slate-200 bg-slate-50 text-center text-[11px] font-medium leading-tight text-slate-400">
                No score yet
              </div>
            )}
            <div className="min-w-0 flex-1">
              {data.passed === true && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                  ✓ Pass
                </span>
              )}
              {data.passed === false && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700">
                  ✗ Fail
                </span>
              )}
              {data.passed === null && (
                <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                  Not determined
                </span>
              )}
              <p className="mt-3 text-sm leading-relaxed text-ink-soft">
                {data.summary ?? 'No summary provided'}
              </p>
            </div>
          </div>
          {data.criteria.length > 0 ? (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-soft">Criteria</h3>
              <div className="max-h-72 overflow-y-auto pr-1">
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                  {data.criteria.map((item, index) => (
                    <li key={index} className="flex items-start gap-3 px-4 py-3">
                      {item.passed === true ? (
                        <span
                          aria-hidden="true"
                          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[11px] font-bold text-emerald-600"
                        >
                          ✓
                        </span>
                      ) : item.passed === false ? (
                        <span
                          aria-hidden="true"
                          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-100 text-[11px] font-bold text-rose-600"
                        >
                          ✗
                        </span>
                      ) : (
                        <span
                          aria-hidden="true"
                          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-400"
                        >
                          –
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-ink">{item.name}</span>
                          {typeof item.score === 'number' && (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-600">
                              {Math.round(item.score)}
                            </span>
                          )}
                        </div>
                        {item.notes ? (
                          <div className="mt-1">
                            <button
                              type="button"
                              onClick={() => toggleJustification(index)}
                              aria-expanded={expandedJustifications.has(index)}
                              className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-semibold text-accent transition hover:text-accent-deep focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
                            >
                              <svg
                                viewBox="0 0 16 16"
                                aria-hidden="true"
                                className={`h-3 w-3 transition-transform motion-reduce:transition-none ${
                                  expandedJustifications.has(index) ? 'rotate-90' : ''
                                }`}
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M6 4l4 4-4 4" />
                              </svg>
                              Justification
                            </button>
                            {expandedJustifications.has(index) && (
                              <p className="mt-1 text-xs leading-relaxed text-ink-soft">{item.notes}</p>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : status === 'done' ? (
            <p className="text-sm italic text-slate-400">No criteria provided</p>
          ) : null}
        </div>
      )}
    </section>
  )
}
