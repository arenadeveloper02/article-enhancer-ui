export type RequestPhase = 'idle' | 'streaming' | 'done' | 'error'

export interface EnhanceFormErrors {
  articleUrl?: string
  articleText?: string
  contentType?: string
  otherType?: string
}

export interface EnhancePayload {
  article_url: string
  article_text: string
  content_type: string
}

export type StageId = 'gapanalysis' | 'recommendations' | 'enhancedarticlewriter' | 'coverageverifier'

export type StageStatus = 'pending' | 'active' | 'done'

export interface StageItem {
  id: StageId
  label: string
  status: StageStatus
}

export type SelectedOutputKey =
  | 'recommendations.recommendations'
  | 'enhancedarticlewriter.content'
  | 'coverageverifier.criteria'
  | 'gapanalysis.competitor_strengths'
  | 'gapanalysis.coverage_gaps'
  | 'gapanalysis.underdeveloped_sections'
  | 'coverageverifier.overall_score'
  | 'coverageverifier.passed'
  | 'coverageverifier.summary'

export interface GapAnalysisData {
  competitorStrengths: string[]
  coverageGaps: string[]
  underdevelopedSections: string[]
}

export interface CoverageData {
  overallScore: number | null
  passed: boolean | null
  summary: string
  criteria: string[]
}
