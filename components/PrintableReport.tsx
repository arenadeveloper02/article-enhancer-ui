"use client"

import type { CoverageData, GapAnalysisData, RecommendationsData, SectionStatus } from '@/lib/types'
import { ResultCard } from '@/components/ResultCard'
import { CoverageCard } from '@/components/CoverageCard'
import { GapAnalysisCard } from '@/components/GapAnalysisCard'
import { RecommendationsCard } from '@/components/RecommendationsCard'

interface PrintableReportProps {
  /** Enhanced article markdown. */
  content?: string
  /** Alternate prop name for the enhanced article markdown — resolved identically. */
  articleContent?: string
  articleStatus?: SectionStatus
  coverageData?: CoverageData | null
  coverageStatus?: SectionStatus
  gapData?: GapAnalysisData | null
  gapStatus?: SectionStatus
  recData?: RecommendationsData | null
  recStatus?: SectionStatus
  articleUrl?: string
  /** Content type of the run (accepted for caller compatibility; not rendered). */
  contentType?: string
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
  articleContent,
  articleStatus,
  coverageData,
  coverageStatus,
  gapData,
  gapStatus,
  recData,
  recStatus,
  articleUrl,
}: PrintableReportProps) {
  // Tolerant prop resolution: callers may pass either `content` or
  // `articleContent`; statuses default to 'done' for the print mirror when a
  // caller omits them (the mirror only renders completed data anyway).
  const resolvedContent = content ?? articleContent ?? ''
  const resolvedArticleStatus: SectionStatus = articleStatus ?? 'done'
  const resolvedCoverageData = coverageData ?? null
  const resolvedCoverageStatus: SectionStatus = coverageStatus ?? 'done'
  const resolvedGapData = gapData ?? null
  const resolvedGapStatus: SectionStatus = gapStatus ?? 'done'
  const resolvedRecData = recData ?? null
  const resolvedRecStatus: SectionStatus = recStatus ?? 'done'

  const hasAnything =
    resolvedContent.trim().length > 0 ||
    resolvedCoverageData !== null ||
    resolvedGapData !== null ||
    resolvedRecData !== null
  if (!hasAnything) return null

  return (
    <div className="print-report" aria-hidden="true">
      <header className="print-card mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          Article Enhancer Output
        </h1>
        {articleUrl ? <p className="mt-1 text-sm text-ink-soft">{articleUrl}</p> : null}
      </header>
      {resolvedContent.trim() ? (
        <div className="print-card mb-6">
          <ResultCard content={resolvedContent} status={resolvedArticleStatus} articleUrl={articleUrl} />
        </div>
      ) : null}
      {resolvedCoverageData !== null ? (
        <div className="print-card mb-6">
          <CoverageCard data={resolvedCoverageData} status={resolvedCoverageStatus} />
        </div>
      ) : null}
      {resolvedGapData !== null ? (
        <div className="print-card mb-6">
          <GapAnalysisCard data={resolvedGapData} status={resolvedGapStatus} />
        </div>
      ) : null}
      {resolvedRecData !== null ? (
        <div className="print-card mb-6">
          <RecommendationsCard data={resolvedRecData} status={resolvedRecStatus} />
        </div>
      ) : null}
    </div>
  )
}
