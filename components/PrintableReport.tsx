"use client"

import type { CoverageData, GapAnalysisData, RecommendationsData, SectionStatus } from '@/lib/types'
import { ResultCard } from '@/components/ResultCard'
import { CoverageCard } from '@/components/CoverageCard'
import { GapAnalysisCard } from '@/components/GapAnalysisCard'
import { RecommendationsCard } from '@/components/RecommendationsCard'

interface PrintableReportProps {
  content: string
  articleStatus: SectionStatus
  coverageData: CoverageData | null
  coverageStatus: SectionStatus
  gapData: GapAnalysisData | null
  gapStatus: SectionStatus
  recData: RecommendationsData | null
  recStatus: SectionStatus
  articleUrl?: string
}

/**
 * Print-only mirror of the on-screen results. It reuses the EXACT same React
 * components that render the UI (ResultCard, CoverageCard, GapAnalysisCard,
 * RecommendationsCard) — no separate PDF template — so the printed/PDF output
 * matches the browser rendering. Visibility is controlled purely by the
 * `.print-report` / `.screen-only` rules in app/globals.css:
 * hidden on screen, shown only inside @media print.
 */
export function PrintableReport({
  content,
  articleStatus,
  coverageData,
  coverageStatus,
  gapData,
  gapStatus,
  recData,
  recStatus,
  articleUrl,
}: PrintableReportProps) {
  const hasAnything =
    content.trim().length > 0 || coverageData !== null || gapData !== null || recData !== null
  if (!hasAnything) return null

  return (
    <div className="print-report" aria-hidden="true">
      <header className="print-card mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          Article Enhancer Output
        </h1>
        {articleUrl ? <p className="mt-1 text-sm text-ink-soft">{articleUrl}</p> : null}
      </header>
      {content.trim() ? (
        <div className="print-card mb-6">
          <ResultCard content={content} status={articleStatus} articleUrl={articleUrl} />
        </div>
      ) : null}
      {coverageData !== null ? (
        <div className="print-card mb-6">
          <CoverageCard data={coverageData} status={coverageStatus} />
        </div>
      ) : null}
      {gapData !== null ? (
        <div className="print-card mb-6">
          <GapAnalysisCard data={gapData} status={gapStatus} />
        </div>
      ) : null}
      {recData !== null ? (
        <div className="print-card mb-6">
          <RecommendationsCard data={recData} status={recStatus} />
        </div>
      ) : null}
    </div>
  )
}
