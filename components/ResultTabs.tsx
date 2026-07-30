"use client"

import { useState } from 'react'
import type { CoverageData, GapAnalysisData, RecommendationsData, SectionStatus } from '@/lib/types'
import { ResultCard } from '@/components/ResultCard'
import { CoverageCard } from '@/components/CoverageCard'
import { GapAnalysisCard } from '@/components/GapAnalysisCard'
import { RecommendationsCard } from '@/components/RecommendationsCard'

type ResultTabKey = 'article' | 'coverage' | 'gap' | 'rec'

interface ResultTabsProps {
  content: string
  articleStatus: SectionStatus
  coverageData: CoverageData | null
  coverageStatus: SectionStatus
  gapData: GapAnalysisData | null
  gapStatus: SectionStatus
  recData: RecommendationsData | null
  recStatus: SectionStatus
  articleUrl?: string
  /**
   * When provided (History view), the full-screen Back button returns to the
   * history list. When omitted (Generator), Back closes the full-screen view
   * and shows a compact "View results" card that re-opens it.
   */
  onBack?: () => void
  /** When provided, an Export button appears in the full-screen header. */
  onExport?: () => void
}

function TabStatusIcon({ status }: { status: SectionStatus }) {
  if (status === 'done') {
    return (
      <span
        aria-hidden="true"
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"
      >
        <svg
          viewBox="0 0 16 16"
          className="h-2.5 w-2.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 8.5l3.2 3L13 4.5" />
        </svg>
      </span>
    )
  }
  if (status === 'streaming') {
    return (
      <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60 motion-reduce:hidden" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
      </span>
    )
  }
  if (status === 'empty') {
    return (
      <span
        aria-hidden="true"
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold leading-none text-slate-400"
      >
        –
      </span>
    )
  }
  return <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-slate-300" />
}

function statusSrText(status: SectionStatus): string {
  if (status === 'streaming') return 'receiving live updates'
  if (status === 'done') return 'complete'
  if (status === 'empty') return 'completed with no data returned'
  return 'pending'
}

export function ResultTabs({
  content,
  articleStatus,
  coverageData,
  coverageStatus,
  gapData,
  gapStatus,
  recData,
  recStatus,
  articleUrl,
  onBack,
  onExport,
}: ResultTabsProps) {
  const [active, setActive] = useState<ResultTabKey>('article')
  // EVERY tab now renders in the full-viewport view — there is no per-tab
  // collapsible layout anymore. The header offers a single Back action:
  // in History (onBack set) it returns to the history list; in the Generator
  // it closes the full-screen view, leaving a compact "View results" card
  // that re-opens it.
  const [fullscreen, setFullscreen] = useState(true)

  const gapCount = gapData
    ? gapData.competitor_strengths.length +
      gapData.coverage_gaps.length +
      gapData.underdeveloped_sections.length
    : null
  const recCount = recData ? recData.recommendations.length : null

  const tabs: Array<{ key: ResultTabKey; label: string; status: SectionStatus; count: number | null }> = [
    { key: 'article', label: 'Enhanced Article', status: articleStatus, count: null },
    { key: 'coverage', label: 'Coverage Verification', status: coverageStatus, count: null },
    { key: 'gap', label: 'Gap Analysis', status: gapStatus, count: gapCount },
    { key: 'rec', label: 'Recommendations', status: recStatus, count: recCount },
  ]

  const coveragePassed = coverageData ? coverageData.passed : null

  function handleBack(): void {
    if (onBack) {
      onBack()
    } else {
      setFullscreen(false)
    }
  }

  const headerButtonClasses =
    'flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-ink-soft transition hover:border-indigo-200 hover:text-accent-deep focus:outline-none focus-visible:outline-2 focus-visible:outline-accent'

  const tabList = (
    <div
      role="tablist"
      aria-label="Result sections"
      className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-card"
    >
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          id={`tab-${tab.key}`}
          aria-selected={active === tab.key}
          aria-controls={`panel-${tab.key}`}
          onClick={() => setActive(tab.key)}
          className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none ${
            active === tab.key
              ? 'bg-indigo-50 text-accent-deep'
              : 'text-ink-soft hover:bg-slate-50 hover:text-ink'
          }`}
        >
          <TabStatusIcon status={tab.status} />
          <span>{tab.label}</span>
          {tab.count !== null && (
            <span
              className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${
                active === tab.key ? 'bg-indigo-100 text-accent-deep' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {tab.count}
            </span>
          )}
          {tab.key === 'coverage' && coveragePassed !== null && (
            <span
              aria-hidden="true"
              className={`h-2 w-2 shrink-0 rounded-full ${coveragePassed ? 'bg-emerald-500' : 'bg-rose-500'}`}
            />
          )}
          {tab.key === 'coverage' && coveragePassed !== null && (
            <span className="sr-only">{coveragePassed ? 'passed' : 'failed'}</span>
          )}
          <span className="sr-only">({statusSrText(tab.status)})</span>
        </button>
      ))}
    </div>
  )

  // ── Compact re-opener card (Generator only, after Back) ────────────────
  if (!fullscreen) {
    return (
      <section
        aria-label="Enhancement results"
        className="screen-only card-enter flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-card"
      >
        <p className="text-sm font-medium text-ink">Enhancement results are ready.</p>
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          className="shrink-0 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white transition hover:bg-accent-deep focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        >
          View results
        </button>
      </section>
    )
  }

  // ── Full-screen view (ALL tabs) ─────────────────────────────────────────
  return (
    <section
      aria-label="Enhancement results"
      className="screen-only fixed inset-0 z-50 flex flex-col bg-surface"
    >
      <div className="shrink-0 border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur sm:px-4">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 overflow-x-auto">{tabList}</div>
          {onExport && (
            <button
              type="button"
              onClick={onExport}
              aria-label="Export as PDF / print"
              className={headerButtonClasses}
            >
              <svg
                viewBox="0 0 16 16"
                aria-hidden="true"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M8 2v8" />
                <path d="M4.5 6.5L8 10l3.5-3.5" />
                <path d="M3 13.5h10" />
              </svg>
              <span className="hidden sm:inline">Export</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleBack}
            aria-label={onBack ? 'Back to history' : 'Back'}
            className={headerButtonClasses}
          >
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10 3L5 8l5 5" />
            </svg>
            Back
          </button>
        </div>
      </div>
      <div
        role="tabpanel"
        id={`panel-${active}`}
        aria-labelledby={`tab-${active}`}
        className="flex-1 overflow-y-auto px-4 py-6 sm:px-8 lg:px-12"
      >
        <div className="mx-auto w-full max-w-4xl rounded-2xl border border-slate-200 bg-white p-5 shadow-card sm:p-8">
          {active === 'article' && (
            <ResultCard content={content} status={articleStatus} embedded articleUrl={articleUrl} />
          )}
          {active === 'coverage' && <CoverageCard data={coverageData} status={coverageStatus} embedded />}
          {active === 'gap' && <GapAnalysisCard data={gapData} status={gapStatus} embedded />}
          {active === 'rec' && <RecommendationsCard data={recData} status={recStatus} embedded />}
        </div>
      </div>
    </section>
  )
}
