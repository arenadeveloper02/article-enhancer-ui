"use client"

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type {
  CoverageData,
  EnhanceFormErrors,
  EnhancePayload,
  GapAnalysisData,
  PanelKey,
  RecommendationsData,
  RequestPhase,
  SectionStatus,
  StageId,
  StageStatus,
} from '@/lib/types'
import type { BlockTarget } from '@/lib/stream'
import {
  STAGE_ORDER,
  classifyUnknownPayload,
  isHeartbeatMessage,
  resolveBlockTarget,
  statusLabelFor,
} from '@/lib/stream'
import {
  decodeUnicodeEscapes,
  extractArticleContent,
  extractBalancedJson,
  isCoverageEmpty,
  isGapAnalysisEmpty,
  isRecommendationsEmpty,
  normalizeCoverage,
  normalizeGapAnalysis,
  normalizeRecommendations,
  splitArticleSegments,
} from '@/lib/normalize'
import { StatusChip } from '@/components/StatusChip'
import { ErrorCard } from '@/components/ErrorCard'
import { ProgressChecklist } from '@/components/ProgressChecklist'
import type { ChecklistStage } from '@/components/ProgressChecklist'
import { ResultTabs } from '@/components/ResultTabs'

const CONTENT_TYPES = ['Blog Post', 'Landing Page', 'Guide', 'News', 'Product Page', 'Other'] as const

const STAGE_LABELS: Record<StageId, string> = {
  gapanalysis: 'Analyzing gaps',
  recommendations: 'Generating recommendations',
  enhancedarticlewriter: 'Writing enhanced draft',
  coverageverifier: 'Verifying coverage',
}

const INITIAL_STAGES: Record<StageId, StageStatus> = {
  gapanalysis: 'pending',
  recommendations: 'pending',
  enhancedarticlewriter: 'pending',
  coverageverifier: 'pending',
}

const INITIAL_SECTIONS: Record<PanelKey, SectionStatus> = {
  article: 'pending',
  gapanalysis: 'pending',
  recommendations: 'pending',
  coverage: 'pending',
}

const STAGE_FOR_PANEL: Record<PanelKey, StageId> = {
  article: 'enhancedarticlewriter',
  gapanalysis: 'gapanalysis',
  recommendations: 'recommendations',
  coverage: 'coverageverifier',
}

const PANEL_FOR_STAGE: Record<StageId, PanelKey> = {
  gapanalysis: 'gapanalysis',
  recommendations: 'recommendations',
  enhancedarticlewriter: 'article',
  coverageverifier: 'coverage',
}

// Metadata keys on stream events that must never be merged as panel outputs.
const RESERVED_KEYS = new Set([
  'blockid',
  'block_id',
  'blockname',
  'chunk',
  'delta',
  'text',
  'event',
  'type',
  'message',
  'status',
  'success',
  'error',
  'timestamp',
  'id',
  'done',
])

const inputBase =
  'w-full rounded-xl border bg-white px-4 py-2.5 text-sm text-ink shadow-sm transition placeholder:text-slate-400 focus:outline-none focus-visible:outline-2 focus-visible:outline-accent'

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function gapEntryText(entry: string | { title: string; detail?: string }): string {
  if (typeof entry === 'string') return entry
  return entry.detail ? `${entry.title} — ${entry.detail}` : entry.title
}

/** Parses a string value that itself contains JSON; returns non-strings unchanged. */
function parseIfJsonLike(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value
  const parsed = extractBalancedJson(trimmed)
  return parsed === null ? value : parsed
}

/**
 * Last-resort salvage: pulls the value for a JSON key straight out of raw
 * stream text. Handles structured values ({...} / [...]) and scalar values
 * (strings, numbers, booleans). Returns undefined when the key is absent.
 */
function extractKeyValue(text: string, key: string): unknown {
  const token = `"${key}"`
  let from = 0
  while (from < text.length) {
    const idx = text.indexOf(token, from)
    if (idx === -1) return undefined
    const colon = text.indexOf(':', idx + token.length)
    if (colon === -1) return undefined
    const rest = text.slice(colon + 1, colon + 1 + 60000).replace(/^\s+/, '')
    if (rest.startsWith('{') || rest.startsWith('[')) {
      const structured = extractBalancedJson(rest)
      if (structured !== null) return structured
    } else {
      const scalar = rest.match(/^(?:"((?:[^"\\]|\\.)*)"|(-?\d+(?:\.\d+)?)|(true|false))/)
      if (scalar) {
        if (scalar[1] !== undefined) return decodeUnicodeEscapes(scalar[1].replace(/\\"/g, '"'))
        if (scalar[2] !== undefined) return Number(scalar[2])
        return scalar[3] === 'true'
      }
    }
    from = idx + token.length
  }
  return undefined
}

function buildPrintableHtml(
  content: string,
  gap: GapAnalysisData | null,
  rec: RecommendationsData | null,
  cov: CoverageData | null,
): string {
  const sections: string[] = []
  if (content.trim()) {
    const articleHtml = splitArticleSegments(content)
      .map((segment) =>
        segment.added
          ? `<span class="added">${escapeHtml(segment.text)}</span>`
          : escapeHtml(segment.text),
      )
      .join('')
    sections.push(
      `<section><h2>Enhanced Article</h2><div class="article">${articleHtml}</div></section>`,
    )
  }
  if (cov) {
    const rows = cov.criteria
      .map(
        (c) =>
          `<li><strong>${escapeHtml(c.name)}</strong>${
            c.passed === true ? ' — Pass' : c.passed === false ? ' — Fail' : ''
          }${typeof c.score === 'number' ? ` (${Math.round(c.score)})` : ''}${
            c.notes ? `<br/><em>${escapeHtml(c.notes)}</em>` : ''
          }</li>`,
      )
      .join('')
    sections.push(
      `<section><h2>Coverage Verification</h2><p>Overall score: ${
        cov.overall_score !== null ? Math.round(cov.overall_score) : 'n/a'
      } / 100 · ${
        cov.passed === true ? 'Pass' : cov.passed === false ? 'Fail' : 'Not determined'
      }</p>${cov.summary ? `<p>${escapeHtml(cov.summary)}</p>` : ''}${rows ? `<ul>${rows}</ul>` : ''}</section>`,
    )
  }
  if (gap) {
    const group = (title: string, items: Array<string | { title: string; detail?: string }>): string =>
      items.length > 0
        ? `<h3>${title}</h3><ul>${items.map((i) => `<li>${escapeHtml(gapEntryText(i))}</li>`).join('')}</ul>`
        : ''
    const body =
      group('Competitor Strengths', gap.competitor_strengths) +
      group('Coverage Gaps', gap.coverage_gaps) +
      group('Underdeveloped Sections', gap.underdeveloped_sections)
    if (body) sections.push(`<section><h2>Gap Analysis</h2>${body}</section>`)
  }
  if (rec && rec.recommendations.length > 0) {
    sections.push(
      `<section><h2>Recommendations</h2><ol>${rec.recommendations
        .map(
          (r) =>
            `<li><strong>${escapeHtml(r.title)}</strong>${
              r.priority ? ` [${escapeHtml(r.priority)}]` : ''
            }${r.detail ? `<br/>${escapeHtml(r.detail)}` : ''}</li>`,
        )
        .join('')}</ol></section>`,
    )
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Article Enhancer Output</title><style>body{font-family:Poppins,Georgia,serif;max-width:720px;margin:32px auto;padding:0 24px;color:#2C2D33;line-height:1.6}h1{font-size:24px}h2{font-size:19px;margin-top:28px;border-bottom:1px solid #E2E3E5;padding-bottom:6px}h3{font-size:15px;margin-top:18px}.article{white-space:pre-wrap}.added{background:#D1E3FA;color:#10458B;border-radius:3px;padding:0 2px;-webkit-box-decoration-break:clone;box-decoration-break:clone;-webkit-print-color-adjust:exact;print-color-adjust:exact}li{margin-bottom:6px}@media print{body{margin:0;max-width:none}}</style></head><body><h1>Article Enhancer Output</h1>${sections.join('')}</body></html>`
}

export function EnhancerClient() {
  const [articleUrl, setArticleUrl] = useState('')
  const [articleText, setArticleText] = useState('')
  const [contentType, setContentType] = useState('')
  const [otherType, setOtherType] = useState('')
  const [errors, setErrors] = useState<EnhanceFormErrors>({})
  const [phase, setPhase] = useState<RequestPhase>('idle')
  const [content, setContent] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [stages, setStages] = useState<Record<StageId, StageStatus>>({ ...INITIAL_STAGES })
  const [sections, setSections] = useState<Record<PanelKey, SectionStatus>>({ ...INITIAL_SECTIONS })
  const [gapData, setGapData] = useState<GapAnalysisData | null>(null)
  const [recData, setRecData] = useState<RecommendationsData | null>(null)
  const [coverage, setCoverage] = useState<CoverageData | null>(null)
  const [submittedUrl, setSubmittedUrl] = useState('')

  const abortRef = useRef<AbortController | null>(null)
  const startRef = useRef(0)
  const targetAccumRef = useRef<Record<PanelKey, string>>({
    article: '',
    gapanalysis: '',
    recommendations: '',
    coverage: '',
  })
  const blockAccumRef = useRef<Record<string, string>>({})
  const blockTargetRef = useRef<Record<string, BlockTarget>>({})
  const gapRef = useRef<GapAnalysisData | null>(null)
  const recRef = useRef<RecommendationsData | null>(null)
  const covRef = useRef<CoverageData | null>(null)
  const dataPresentRef = useRef<Record<PanelKey, boolean>>({
    article: false,
    gapanalysis: false,
    recommendations: false,
    coverage: false,
  })
  const doneRef = useRef(false)
  // Full raw transcript of every stream payload — the salvage pass mines this
  // when a panel never received routable data.
  const rawTranscriptRef = useRef('')
  // Merged structured outputs from ANY event carrying dotted keys, panel-name
  // keys, or output/result/data envelopes. Applied after every event so the
  // UI renders as soon as usable data appears — not only at [DONE].
  const finalOutputRef = useRef<Record<string, unknown> | null>(null)
  const looseTextRef = useRef('')
  const streamErrorRef = useRef('')
  const lastPayloadRef = useRef<EnhancePayload | null>(null)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (phase !== 'streaming') return
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }, 1000)
    return () => window.clearInterval(id)
  }, [phase])

  function validate(): boolean {
    const next: EnhanceFormErrors = {}
    const url = articleUrl.trim()
    if (!url) {
      next.articleUrl = 'Article URL is required.'
    } else {
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          next.articleUrl = 'Enter a valid http(s) URL.'
        }
      } catch {
        next.articleUrl = 'Enter a valid URL, e.g. https://example.com/post'
      }
    }
    if (!articleText.trim()) {
      next.articleText = 'Article text is required.'
    }
    if (!contentType) {
      next.contentType = 'Choose a content type.'
    } else if (contentType === 'Other' && !otherType.trim()) {
      next.otherType = 'Describe your content type.'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function resetRun(): void {
    abortRef.current?.abort()
    doneRef.current = false
    streamErrorRef.current = ''
    looseTextRef.current = ''
    rawTranscriptRef.current = ''
    finalOutputRef.current = null
    targetAccumRef.current = { article: '', gapanalysis: '', recommendations: '', coverage: '' }
    blockAccumRef.current = {}
    blockTargetRef.current = {}
    gapRef.current = null
    recRef.current = null
    covRef.current = null
    dataPresentRef.current = { article: false, gapanalysis: false, recommendations: false, coverage: false }
    setContent('')
    setGapData(null)
    setRecData(null)
    setCoverage(null)
    setStages({ ...INITIAL_STAGES })
    setSections({ ...INITIAL_SECTIONS })
    setErrorMessage('')
    setStatusMessage('')
    setElapsed(0)
  }

  function setPanelStreaming(panel: PanelKey): void {
    if (doneRef.current) return
    setSections((prev) => {
      if (prev[panel] === 'streaming') return prev
      const next: Record<PanelKey, SectionStatus> = { ...prev }
      next[panel] = 'streaming'
      return next
    })
    setStages((prev) => {
      const stage = STAGE_FOR_PANEL[panel]
      const next: Record<StageId, StageStatus> = { ...prev }
      let changed = false
      for (const s of STAGE_ORDER) {
        if (s !== stage && next[s] === 'active' && dataPresentRef.current[PANEL_FOR_STAGE[s]]) {
          next[s] = 'done'
          changed = true
        }
      }
      if (next[stage] === 'pending') {
        next[stage] = 'active'
        changed = true
      }
      return changed ? next : prev
    })
  }

  function applyGap(raw: unknown): void {
    const normalized = normalizeGapAnalysis(raw)
    if (isGapAnalysisEmpty(normalized)) return
    const prev = gapRef.current
    const merged: GapAnalysisData = {
      competitor_strengths:
        normalized.competitor_strengths.length > 0
          ? normalized.competitor_strengths
          : prev?.competitor_strengths ?? [],
      coverage_gaps: normalized.coverage_gaps.length > 0 ? normalized.coverage_gaps : prev?.coverage_gaps ?? [],
      underdeveloped_sections:
        normalized.underdeveloped_sections.length > 0
          ? normalized.underdeveloped_sections
          : prev?.underdeveloped_sections ?? [],
    }
    gapRef.current = merged
    dataPresentRef.current.gapanalysis = true
    setGapData(merged)
    setPanelStreaming('gapanalysis')
  }

  function applyRec(raw: unknown): void {
    const normalized = normalizeRecommendations(raw)
    if (isRecommendationsEmpty(normalized)) return
    const prev = recRef.current
    if (prev && prev.recommendations.length > normalized.recommendations.length) return
    recRef.current = normalized
    dataPresentRef.current.recommendations = true
    setRecData(normalized)
    setPanelStreaming('recommendations')
  }

  function applyCoverage(raw: unknown): void {
    const normalized = normalizeCoverage(raw)
    if (isCoverageEmpty(normalized)) return
    const prev = covRef.current
    const merged: CoverageData = {
      overall_score: normalized.overall_score ?? prev?.overall_score ?? null,
      passed: normalized.passed ?? prev?.passed ?? null,
      summary: normalized.summary ?? prev?.summary ?? null,
      criteria: normalized.criteria.length > 0 ? normalized.criteria : prev?.criteria ?? [],
    }
    covRef.current = merged
    dataPresentRef.current.coverage = true
    setCoverage(merged)
    setPanelStreaming('coverage')
  }

  function appendArticleChunk(chunk: string): void {
    if (!chunk) return
    if (isHeartbeatMessage(chunk) && !targetAccumRef.current.article) return
    targetAccumRef.current.article += chunk
    dataPresentRef.current.article = true
    setContent(targetAccumRef.current.article)
    setPanelStreaming('article')
  }

  function setArticleFull(text: string): void {
    const decoded = decodeUnicodeEscapes(text)
    if (!decoded.trim()) return
    if (decoded.trim().length > targetAccumRef.current.article.trim().length) {
      targetAccumRef.current.article = decoded
      setContent(decoded)
    }
    dataPresentRef.current.article = true
    setPanelStreaming('article')
  }

  function deliverChunk(panel: PanelKey, chunk: string): void {
    if (panel === 'article') {
      appendArticleChunk(chunk)
      return
    }
    targetAccumRef.current[panel] += chunk
    setPanelStreaming(panel)
    const accumulated = targetAccumRef.current[panel]
    if (panel === 'gapanalysis') applyGap(accumulated)
    else if (panel === 'recommendations') applyRec(accumulated)
    else applyCoverage(accumulated)
  }

  function routeChunk(blockId: string, chunk: string): void {
    const known = blockTargetRef.current[blockId] ?? resolveBlockTarget(blockId)
    if (known) {
      blockTargetRef.current[blockId] = known
      if (known === 'status-theme' || known === 'status-research') {
        setStatusMessage(statusLabelFor(known))
        return
      }
      deliverChunk(known, chunk)
      return
    }
    blockAccumRef.current[blockId] = (blockAccumRef.current[blockId] ?? '') + chunk
    const classified = classifyUnknownPayload(blockAccumRef.current[blockId])
    if (classified) {
      blockTargetRef.current[blockId] = classified
      deliverChunk(classified, blockAccumRef.current[blockId])
      blockAccumRef.current[blockId] = ''
    }
  }

  /**
   * Merges any structured payload (dotted selected-output keys, panel-name
   * keys, or nested output/result/data envelopes) into finalOutputRef. The
   * tolerant lookup() inside lib/normalize resolves both dotted keys
   * ("gapanalysis.coverage_gaps") and one nested level, so simply merging
   * everything flat is enough for the normalizers to find their data.
   */
  function collectStructured(value: unknown): void {
    const record = asRecord(parseIfJsonLike(value))
    if (!record) return
    const merged: Record<string, unknown> = finalOutputRef.current ?? {}
    finalOutputRef.current = merged
    for (const [key, raw] of Object.entries(record)) {
      const lower = key.toLowerCase()
      if (
        lower === 'output' ||
        lower === 'outputs' ||
        lower === 'result' ||
        lower === 'results' ||
        lower === 'data' ||
        lower === 'final' ||
        lower === 'response'
      ) {
        collectStructured(raw)
        continue
      }
      if (RESERVED_KEYS.has(lower)) continue
      merged[key] = parseIfJsonLike(raw)
    }
  }

  function applyFinalOutputs(): void {
    const source = finalOutputRef.current
    if (!source || Object.keys(source).length === 0) return
    applyGap(source)
    applyRec(source)
    applyCoverage(source)
    const article = extractArticleContent(source)
    if (article) setArticleFull(article)
  }

  function salvageFromTranscript(): void {
    const raw = rawTranscriptRef.current
    if (!raw) return
    if (!gapRef.current || isGapAnalysisEmpty(gapRef.current)) {
      applyGap({
        competitor_strengths: extractKeyValue(raw, 'competitor_strengths'),
        coverage_gaps: extractKeyValue(raw, 'coverage_gaps'),
        underdeveloped_sections: extractKeyValue(raw, 'underdeveloped_sections'),
      })
    }
    if (!recRef.current || isRecommendationsEmpty(recRef.current)) {
      applyRec({ recommendations: extractKeyValue(raw, 'recommendations') })
    }
    if (!covRef.current || isCoverageEmpty(covRef.current)) {
      applyCoverage({
        overall_score: extractKeyValue(raw, 'overall_score'),
        passed: extractKeyValue(raw, 'passed'),
        summary: extractKeyValue(raw, 'summary'),
        criteria: extractKeyValue(raw, 'criteria'),
      })
    }
    if (!targetAccumRef.current.article.trim()) {
      const found = extractKeyValue(raw, 'content')
      if (typeof found === 'string' && found.trim().length > 80) setArticleFull(found)
    }
  }

  function finalize(): void {
    if (doneRef.current) return
    doneRef.current = true
    applyFinalOutputs()
    salvageFromTranscript()
    const hasArticle = targetAccumRef.current.article.trim().length > 0
    const hasGap = gapRef.current !== null && !isGapAnalysisEmpty(gapRef.current)
    const hasRec = recRef.current !== null && !isRecommendationsEmpty(recRef.current)
    const hasCov = covRef.current !== null && !isCoverageEmpty(covRef.current)
    if (!hasArticle && !hasGap && !hasRec && !hasCov) {
      setPhase('error')
      setErrorMessage(
        streamErrorRef.current ||
          'The enhancement service finished without returning any usable output. Please try again.',
      )
      return
    }
    setSections({
      article: hasArticle ? 'done' : 'empty',
      gapanalysis: hasGap ? 'done' : 'empty',
      recommendations: hasRec ? 'done' : 'empty',
      coverage: hasCov ? 'done' : 'empty',
    })
    setStages({
      gapanalysis: 'done',
      recommendations: 'done',
      enhancedarticlewriter: 'done',
      coverageverifier: 'done',
    })
    setStatusMessage('')
    setPhase('done')
  }

  function handleEvent(obj: Record<string, unknown>): void {
    if (doneRef.current) return
    const blockIdRaw = obj.blockId ?? obj.block_id ?? obj.blockName ?? obj.blockname
    const blockId = typeof blockIdRaw === 'string' ? blockIdRaw : ''
    const chunkRaw = obj.chunk ?? obj.delta ?? obj.text
    const chunk = typeof chunkRaw === 'string' ? chunkRaw : ''
    const message =
      typeof obj.message === 'string' ? obj.message : typeof obj.status === 'string' ? obj.status : ''
    const errText = typeof obj.error === 'string' ? obj.error.trim() : ''
    if (errText) streamErrorRef.current = errText

    if (message && isHeartbeatMessage(message)) {
      setStatusMessage(message)
    } else if (message && !blockId && !chunk && message.length <= 160) {
      setStatusMessage(message)
    }

    if (chunk) {
      if (blockId) {
        routeChunk(blockId, chunk)
      } else {
        looseTextRef.current += chunk
        const classified = classifyUnknownPayload(looseTextRef.current)
        if (classified === 'article') appendArticleChunk(chunk)
        else if (classified === 'gapanalysis') applyGap(looseTextRef.current)
        else if (classified === 'recommendations') applyRec(looseTextRef.current)
        else if (classified === 'coverage') applyCoverage(looseTextRef.current)
      }
    }

    // Mine structured/final outputs off EVERY event and render immediately —
    // this is what makes dotted selected-output payloads show up in the UI.
    collectStructured(obj)
    applyFinalOutputs()
  }

  function processLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    if (trimmed.startsWith(':') || trimmed.startsWith('event:') || trimmed.startsWith('id:') || trimmed.startsWith('retry:')) {
      return
    }
    const payload = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed
    if (!payload) return
    rawTranscriptRef.current += payload + '\n'
    if (payload === '[DONE]' || payload === 'DONE') {
      finalize()
      return
    }
    let parsed: unknown = null
    try {
      parsed = JSON.parse(payload) as unknown
    } catch {
      parsed = extractBalancedJson(payload)
    }
    const record = asRecord(parsed)
    if (record) {
      handleEvent(record)
      return
    }
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        const entryRecord = asRecord(entry)
        if (entryRecord) handleEvent(entryRecord)
      }
      return
    }
    // Plain text line — heartbeat vs. loose content.
    if (isHeartbeatMessage(payload)) {
      setStatusMessage(payload)
      return
    }
    looseTextRef.current += payload + '\n'
    const classified = classifyUnknownPayload(looseTextRef.current)
    if (classified === 'article') appendArticleChunk(payload + '\n')
    else if (classified === 'gapanalysis') applyGap(looseTextRef.current)
    else if (classified === 'recommendations') applyRec(looseTextRef.current)
    else if (classified === 'coverage') applyCoverage(looseTextRef.current)
  }

  async function runEnhancement(payload: EnhancePayload): Promise<void> {
    const controller = new AbortController()
    abortRef.current = controller
    startRef.current = Date.now()
    setSubmittedUrl(payload.article_url)
    setPhase('streaming')
    setStatusMessage('Contacting the enhancement agent…')
    try {
      const response = await fetch('/api/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      if (!response.ok) {
        let detail = ''
        try {
          const errBody = (await response.json()) as { error?: unknown }
          if (typeof errBody.error === 'string') detail = errBody.error
        } catch {
          detail = ''
        }
        throw new Error(detail || `The enhancement request failed (${response.status}).`)
      }
      const responseContentType = response.headers.get('content-type') ?? ''
      if (responseContentType.includes('application/json')) {
        // Non-streamed JSON fallback — mine the whole document at once.
        const data: unknown = await response.json()
        try {
          rawTranscriptRef.current += JSON.stringify(data) + '\n'
        } catch {
          // ignore serialization issues
        }
        const record = asRecord(data)
        if (record) {
          handleEvent(record)
        } else if (Array.isArray(data)) {
          for (const entry of data) {
            const entryRecord = asRecord(entry)
            if (entryRecord) handleEvent(entryRecord)
          }
        } else {
          collectStructured(data)
          applyFinalOutputs()
        }
        finalize()
        return
      }
      if (!response.body) {
        throw new Error('The enhancement service returned an empty response.')
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) processLine(line)
      }
      buffer += decoder.decode()
      if (buffer.trim()) processLine(buffer)
      finalize()
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      if (doneRef.current) return
      doneRef.current = true
      setPhase('error')
      setErrorMessage(
        err instanceof Error ? err.message : 'Something went wrong while enhancing the article.',
      )
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (phase === 'streaming') return
    if (!validate()) return
    const payload: EnhancePayload = {
      article_url: articleUrl.trim(),
      article_text: articleText.trim(),
      content_type: contentType === 'Other' ? otherType.trim() : contentType,
    }
    lastPayloadRef.current = payload
    resetRun()
    await runEnhancement(payload)
  }

  function handleRetry(): void {
    const payload = lastPayloadRef.current
    if (!payload) {
      setPhase('idle')
      setErrorMessage('')
      return
    }
    resetRun()
    void runEnhancement(payload)
  }

  function handleExport(): void {
    const html = buildPrintableHtml(content, gapData, recData, coverage)
    const win = window.open('', '_blank')
    if (!win) return
    win.document.open()
    win.document.write(html)
    win.document.close()
  }

  const checklistStages: ChecklistStage[] = STAGE_ORDER.map((id) => ({
    id,
    label: STAGE_LABELS[id],
    status: stages[id],
  }))

  return (
    <div className="grid gap-8 lg:grid-cols-[400px_minmax(0,1fr)]">
      <div className="space-y-4">
        <form
          onSubmit={handleSubmit}
          noValidate
          className="card-enter rounded-2xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"
        >
          <h2 className="mb-4 font-display text-lg font-semibold text-ink">Enhance an article</h2>
          <div className="space-y-4">
            <div>
              <label
                htmlFor="article-url"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-soft"
              >
                Article URL
              </label>
              <input
                id="article-url"
                type="url"
                value={articleUrl}
                onChange={(e) => setArticleUrl(e.target.value)}
                placeholder="https://example.com/post"
                aria-invalid={Boolean(errors.articleUrl)}
                className={`${inputBase} ${errors.articleUrl ? 'border-rose-300' : 'border-slate-200'}`}
              />
              {errors.articleUrl && <p className="mt-1 text-xs text-rose-600">{errors.articleUrl}</p>}
            </div>
            <div>
              <label
                htmlFor="article-text"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-soft"
              >
                Article text
              </label>
              <textarea
                id="article-text"
                rows={8}
                value={articleText}
                onChange={(e) => setArticleText(e.target.value)}
                placeholder="Paste the full article text here…"
                aria-invalid={Boolean(errors.articleText)}
                className={`${inputBase} resize-y ${errors.articleText ? 'border-rose-300' : 'border-slate-200'}`}
              />
              {errors.articleText && <p className="mt-1 text-xs text-rose-600">{errors.articleText}</p>}
            </div>
            <div>
              <label
                htmlFor="content-type"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-soft"
              >
                Content type
              </label>
              <select
                id="content-type"
                value={contentType}
                onChange={(e) => setContentType(e.target.value)}
                aria-invalid={Boolean(errors.contentType)}
                className={`${inputBase} ${errors.contentType ? 'border-rose-300' : 'border-slate-200'}`}
              >
                <option value="">Select a content type…</option>
                {CONTENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              {errors.contentType && <p className="mt-1 text-xs text-rose-600">{errors.contentType}</p>}
            </div>
            {contentType === 'Other' && (
              <div>
                <label
                  htmlFor="other-type"
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-soft"
                >
                  Describe the content type
                </label>
                <input
                  id="other-type"
                  type="text"
                  value={otherType}
                  onChange={(e) => setOtherType(e.target.value)}
                  placeholder="e.g. Case study"
                  aria-invalid={Boolean(errors.otherType)}
                  className={`${inputBase} ${errors.otherType ? 'border-rose-300' : 'border-slate-200'}`}
                />
                {errors.otherType && <p className="mt-1 text-xs text-rose-600">{errors.otherType}</p>}
              </div>
            )}
            <button
              type="submit"
              disabled={phase === 'streaming'}
              className="w-full rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-60"
            >
              {phase === 'streaming' ? 'Enhancing…' : 'Enhance article'}
            </button>
          </div>
        </form>
      </div>

      <div className="min-w-0 space-y-4">
        {phase === 'idle' && (
          <div className="card-enter flex min-h-[320px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white/60 p-8 text-center">
            <span
              aria-hidden="true"
              className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-xl text-accent"
            >
              ✍
            </span>
            <h2 className="font-display text-lg font-semibold text-ink">Results will appear here</h2>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
              Submit an article and watch the enhanced draft, gap analysis, recommendations, and
              coverage verification stream in live.
            </p>
          </div>
        )}

        {phase === 'error' && <ErrorCard message={errorMessage} onRetry={handleRetry} />}

        {(phase === 'streaming' || phase === 'done') && (
          <>
            {phase === 'streaming' && (
              <StatusChip
                message={statusMessage || 'Enhancing your article…'}
                elapsedSeconds={elapsed}
              />
            )}
            <ProgressChecklist stages={checklistStages} />
            <ResultTabs
              content={content}
              articleStatus={sections.article}
              coverageData={coverage}
              coverageStatus={sections.coverage}
              gapData={gapData}
              gapStatus={sections.gapanalysis}
              recData={recData}
              recStatus={sections.recommendations}
              articleUrl={submittedUrl || undefined}
            />
            {phase === 'done' && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleExport}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-ink-soft transition hover:border-indigo-200 hover:text-accent-deep"
                >
                  Export / Print report
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
