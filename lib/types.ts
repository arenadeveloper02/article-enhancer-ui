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
