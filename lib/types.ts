export type RequestPhase = 'idle' | 'streaming' | 'done' | 'error'

// 'empty' = the run finished ([DONE]) but this section never produced usable data.
export type SectionStatus = 'pending' | 'streaming' | 'done' | 'empty'

export type PanelKey = 'article' | 'gapanalysis' | 'recommendations' | 'coverage'

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

// Gap Analysis (blockId 0f239b6f) — snake_case keys are FINAL, matching the API contract.
export interface GapAnalysisData {
  competitor_strengths: string[] | { title: string; detail?: string }[]
  coverage_gaps: string[] | { title: string; detail?: string }[]
  underdeveloped_sections: string[] | { title: string; detail?: string }[]
}

// Recommendations (blockId 5ae6657d)
export interface RecommendationItem {
  title: string
  detail: string
  priority?: 'high' | 'medium' | 'low' | string | null
  category?: string | null
}

export interface RecommendationsData {
  recommendations: RecommendationItem[]
}

// Coverage Verification (blockId c4bd5114)
export interface CriteriaItem {
  name: string
  passed: boolean | null
  score?: number | null
  notes?: string | null
}

export interface CoverageData {
  overall_score: number | null
  passed: boolean | null
  summary: string | null
  criteria: CriteriaItem[]
}

// A run of enhanced-article text, split on [+ADDED]…[/ADDED] markers.
// `added: true` segments were introduced by the enhancement pipeline and are
// rendered with an inline highlight instead of the literal bracket tokens.
export interface ArticleSegment {
  text: string
  added: boolean
}
