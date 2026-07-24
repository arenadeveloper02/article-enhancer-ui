"use client"

import { useState } from 'react'
import type { GapAnalysisData, RecommendationsData, SectionStatus } from '@/lib/types'
import { GapAnalysisCard } from '@/components/GapAnalysisCard'
import { RecommendationsCard } from '@/components/RecommendationsCard'

interface InsightTabsProps {
  gapData: GapAnalysisData | null
  gapStatus: SectionStatus
  recData: RecommendationsData | null
  recStatus: SectionStatus
}

type TabKey = 'gap' | 'rec'

export function InsightTabs({ gapData, gapStatus, recData, recStatus }: InsightTabsProps) {
  const [active, setActive] = useState<TabKey>('gap')

  const gapCount = gapData
    ? gapData.competitor_strengths.length +
      gapData.coverage_gaps.length +
      gapData.underdeveloped_sections.length
    : 0
  const recCount = recData ? recData.recommendations.length : 0

  const tabs: Array<{ key: TabKey; label: string; count: number; live: boolean }> = [
    { key: 'gap', label: 'Gap Analysis', count: gapCount, live: gapStatus === 'streaming' },
    { key: 'rec', label: 'Recommendations', count: recCount, live: recStatus === 'streaming' },
  ]

  return (
    <section
      aria-label="Gap analysis and recommendations"
      className="card-enter overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card"
    >
      <div role="tablist" aria-label="Insight sections" className="flex border-b border-slate-100">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`tab-${tab.key}`}
            aria-selected={active === tab.key}
            aria-controls={`panel-${tab.key}`}
            onClick={() => setActive(tab.key)}
            className={`flex flex-1 items-center justify-center gap-2 px-3 py-3 text-xs font-semibold transition focus:outline-none focus-visible:outline-2 focus-visible:outline-accent ${
              active === tab.key
                ? 'border-b-2 border-accent bg-indigo-50/50 text-accent-deep'
                : 'border-b-2 border-transparent text-ink-soft hover:bg-slate-50 hover:text-ink'
            }`}
          >
            <span>{tab.label}</span>
            <span
              className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${
                active === tab.key ? 'bg-indigo-100 text-accent-deep' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {tab.count}
            </span>
            {tab.live && (
              <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60 motion-reduce:hidden" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
              </span>
            )}
            {tab.live && <span className="sr-only">receiving live updates</span>}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`panel-${active}`}
        aria-labelledby={`tab-${active}`}
        className="p-5 sm:p-6"
      >
        {active === 'gap' ? (
          <GapAnalysisCard data={gapData} status={gapStatus} embedded />
        ) : (
          <RecommendationsCard data={recData} status={recStatus} embedded />
        )}
      </div>
    </section>
  )
}
