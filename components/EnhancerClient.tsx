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

// Metadata keys on stream events that must never be treated as panel outputs.
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
  'data',
  'output',
  'outputs',
  'result',
  'error',
  'timestamp',
  'id',
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
    // <br> tags become real newlines and [+ADDED]…[/ADDED] spans render as
    // visually highlighted text — the literal marker tokens never reach the PDF.
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
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Article Enhancer Output</title><style>body{font-family:Georgia,serif;max-width:720px;margin:32px auto;padding:0 24px;color:#1b2040;line-height:1.6}h1{font-size:24px}h2{font-size:19px;margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:6px}h3{font-size:15px;margin-top:18px}.article{white-space:pre-wrap}.added{background:#e4e4fb;color:#3d3da8;border-radius:3px;padding:0 2px;-webkit-box-decoration-break:clone;box-decoration-break:clone;-webkit-print-color-adjust:exact;print-color-adjust:exact}li{margin-bottom:6px}@media print{body{margin:0;max-width:none}}</style></head><body><h1>Article Enhancer Output</h1>${sections.join('')}</body></html>`
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
  // The URL the current run was submitted with — used to resolve relative
  // links in the rendered enhanced article.
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
  const blockTargetRef = useRef<Record<string, PanelKey>>({})
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
  // when Gap Analysis / Coverage Verification never streamed per-block chunks.
  const rawTranscriptRef = useRef('')
  // Merged final (non-chunked) outputs from any final/output events.
  const finalOutputRef = useRef<Record<string, unknown> | null>(null)
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

  /**
   * Activates a stage. Previously-active stages only flip to 'done' when their
   * panel has actually produced real (non-default) data — a stage never looks
   * complete just because the next stage started while its own panel is empty.
   */
  function activateStage(id: StageId): void {
    setStages((prev) => {
      let changed = false
      const next: Record<StageId, StageStatus> = { ...prev }
      for (const stageId of STAGE_ORDER) {
        if (
          stageId !== id &&
          next[stageId] === 'active' &&
          dataPresentRef.current[PANEL_FOR_STAGE[stageId]]
        ) {
          next[stageId] = 'done'
          changed = true
        }
      }
      if (next[id] === 'pending') {
        next[id] = 'active'
        changed = true
      }
      return changed ? next : prev
    })
  }

  function markSectionStreaming(key: PanelKey): void {
    setSections((prev) => (prev[key] === 'pending' ? { ...prev, [key]: 'streaming' } : prev))
  }

  function routeToPanel(key: PanelKey, text: string): void {
    if (!text) return
    targetAccumRef.current[key] += text
    activateStage(STAGE_FOR_PANEL[key])
    markSectionStreaming(key)
    if (key === 'article') {
      const decoded = decodeUnicodeEscapes(targetAccumRef.current.article)
      if (decoded.trim()) dataPresentRef.current.article = true
      setContent(decoded)
      return
    }
    const parsed = extractBalancedJson(targetAccumRef.current[key])
    if (parsed === null) return
    if (key === 'gapanalysis') {
      const normalized = normalizeGapAnalysis(parsed)
      gapRef.current = normalized
      if (!isGapAnalysisEmpty(normalized)) dataPresentRef.current.gapanalysis = true
      setGapData(normalized)
    } else if (key === 'recommendations') {
      const normalized = normalizeRecommendations(parsed)
      recRef.current = normalized
      if (!isRecommendationsEmpty(normalized)) dataPresentRef.current.recommendations = true
      setRecData(normalized)
    } else {
      const normalized = normalizeCoverage(parsed)
      covRef.current = normalized
      if (!isCoverageEmpty(normalized)) dataPresentRef.current.coverage = true
      setCoverage(normalized)
    }
  }

  function trySetGap(candidate: unknown): boolean {
    if (candidate === undefined || candidate === null) return false
    const normalized = normalizeGapAnalysis(candidate)
    if (isGapAnalysisEmpty(normalized)) return false
    gapRef.current = normalized
    dataPresentRef.current.gapanalysis = true
    setGapData(normalized)
    markSectionStreaming('gapanalysis')
    return true
  }

  function trySetCoverage(candidate: unknown): boolean {
    if (candidate === undefined || candidate === null) return false
    const normalized = normalizeCoverage(candidate)
    if (isCoverageEmpty(normalized)) return false
    covRef.current = normalized
    dataPresentRef.current.coverage = true
    setCoverage(normalized)
    markSectionStreaming('coverage')
    return true
  }

  function trySetRecommendations(candidate: unknown): boolean {
    if (candidate === undefined || candidate === null) return false
    const normalized = normalizeRecommendations(candidate)
    if (isRecommendationsEmpty(normalized)) return false
    recRef.current = normalized
    dataPresentRef.current.recommendations = true
    setRecData(normalized)
    markSectionStreaming('recommendations')
    return true
  }

  /**
   * Applies final (non-chunked) workflow outputs. Sim final events carry the
   * selected outputs as dotted keys (e.g. "gapanalysis.coverage_gaps",
   * "coverageverifier.overall_score") or as nested per-block objects. This is
   * the authoritative fix for the Gap Analysis / Coverage Verification panels
   * showing empty: even when no per-block chunks streamed, the final payload
   * still populates the panels here.
   */
  function applyFinalOutputs(output: Record<string, unknown>): void {
    const gapObj: Record<string, unknown> = {}
    const covObj: Record<string, unknown> = {}
    let recValue: unknown
    let articleValue: unknown
    for (const [key, value] of Object.entries(output)) {
      if (RESERVED_KEYS.has(key.toLowerCase())) continue
      const target = resolveBlockTarget(key)
      const shortKey = key.includes('.') ? key.slice(key.indexOf('.') + 1) : key
      if (target === 'gapanalysis') {
        const nested = asRecord(parseIfJsonLike(value))
        if (nested && !key.includes('.')) {
          Object.assign(gapObj, nested)
        } else {
          gapObj[shortKey] = parseIfJsonLike(value)
        }
      } else if (target === 'coverage') {
        const nested = asRecord(parseIfJsonLike(value))
        if (nested && !key.includes('.')) {
          Object.assign(covObj, nested)
        } else {
          covObj[shortKey] = parseIfJsonLike(value)
        }
      } else if (target === 'recommendations') {
        recValue = parseIfJsonLike(value)
      } else if (target === 'article') {
        if (typeof value === 'string' && value.trim()) {
          articleValue = value
        } else {
          const text = extractArticleContent(value)
          if (text) articleValue = text
        }
      }
    }
    if (Object.keys(gapObj).length > 0) trySetGap(gapObj)
    if (Object.keys(covObj).length > 0) trySetCoverage(covObj)
    if (recValue !== undefined) trySetRecommendations(recValue)
    if (typeof articleValue === 'string' && articleValue.trim()) {
      const decoded = decodeUnicodeEscapes(articleValue)
      if (decoded.trim().length >= targetAccumRef.current.article.trim().length) {
        targetAccumRef.current.article = articleValue
        dataPresentRef.current.article = true
        setContent(decoded)
        markSectionStreaming('article')
      }
    }
  }

  /** Mines the raw transcript for the given JSON keys (raw + unescaped passes). */
  function scanTranscript(keys: string[]): Record<string, unknown> | null {
    const raw = rawTranscriptRef.current
    if (!raw) return null
    const attempts = [raw, raw.replace(/\\"/g, '"')]
    for (const text of attempts) {
      const out: Record<string, unknown> = {}
      for (const key of keys) {
        const value = extractKeyValue(text, key)
        if (value !== undefined) out[key] = value
      }
      if (Object.keys(out).length > 0) return out
    }
    return null
  }

  function salvageFromUnknownBlocks(panel: PanelKey, apply: (candidate: unknown) => boolean): boolean {
    for (const [blockId, text] of Object.entries(blockAccumRef.current)) {
      const assigned = blockTargetRef.current[blockId]
      if (assigned && assigned !== panel) continue
      const parsed = extractBalancedJson(text)
      if (parsed !== null && apply(parsed)) return true
    }
    return false
  }

  /**
   * Multi-layer salvage pass run at stream end. Guarantees the Gap Analysis,
   * Coverage Verification, and Recommendations panels show data whenever the
   * workflow produced it in ANY form: per-panel buffers, unclassified block
   * buffers, merged final outputs, and finally the raw stream transcript.
   */
  function salvageMissingPanels(): void {
    if (!dataPresentRef.current.gapanalysis) {
      let ok = trySetGap(extractBalancedJson(targetAccumRef.current.gapanalysis))
      if (!ok) ok = salvageFromUnknownBlocks('gapanalysis', trySetGap)
      if (!ok && finalOutputRef.current) ok = trySetGap(finalOutputRef.current)
      if (!ok) {
        const scavenged = scanTranscript(['competitor_strengths', 'coverage_gaps', 'underdeveloped_sections'])
        if (scavenged) trySetGap(scavenged)
      }
    }
    if (!dataPresentRef.current.coverage) {
      let ok = trySetCoverage(extractBalancedJson(targetAccumRef.current.coverage))
      if (!ok) ok = salvageFromUnknownBlocks('coverage', trySetCoverage)
      if (!ok && finalOutputRef.current) ok = trySetCoverage(finalOutputRef.current)
      if (!ok) {
        const scavenged = scanTranscript(['overall_score', 'passed', 'summary', 'criteria'])
        if (scavenged) trySetCoverage(scavenged)
      }
    }
    if (!dataPresentRef.current.recommendations) {
      let ok = trySetRecommendations(extractBalancedJson(targetAccumRef.current.recommendations))
      if (!ok) ok = salvageFromUnknownBlocks('recommendations', trySetRecommendations)
      if (!ok && finalOutputRef.current) ok = trySetRecommendations(finalOutputRef.current)
      if (!ok) {
        const scavenged = scanTranscript(['recommendations'])
        if (scavenged) trySetRecommendations(scavenged)
      }
    }
  }

  function fail(message: string): void {
    setPhase('error')
    setErrorMessage(message)
    setStatusMessage('')
  }

  function finish(): void {
    salvageMissingPanels()
    setSections((prev) => {
      const next = { ...prev }
      for (const key of Object.keys(next) as PanelKey[]) {
        next[key] = dataPresentRef.current[key] ? 'done' : 'empty'
      }
      return next
    })
    setStages(() => {
      const next: Record<StageId, StageStatus> = { ...INITIAL_STAGES }
      for (const id of STAGE_ORDER) next[id] = 'done'
      return next
    })
    setStatusMessage('')
    setPhase((prev) => (prev === 'error' ? prev : 'done'))
  }

  function handleEvent(parsed: unknown): void {
    const record = asRecord(parsed)
    if (!record) return
    const blockIdRaw = record.blockId ?? record.block_id ?? record.blockName
    const blockId = typeof blockIdRaw === 'string' ? blockIdRaw : ''
    const chunkRaw = record.chunk ?? record.delta
    const chunk = typeof chunkRaw === 'string' ? chunkRaw : ''

    if (chunk) {
      if (blockId) {
        const target = resolveBlockTarget(blockId)
        if (target === 'status-theme' || target === 'status-research') {
          setStatusMessage(statusLabelFor(target))
          return
        }
        if (target) {
          routeToPanel(target, chunk)
          return
        }
        blockAccumRef.current[blockId] = (blockAccumRef.current[blockId] ?? '') + chunk
        const assigned = blockTargetRef.current[blockId]
        if (assigned) {
          routeToPanel(assigned, chunk)
          return
        }
        const classified = classifyUnknownPayload(blockAccumRef.current[blockId])
        if (classified) {
          blockTargetRef.current[blockId] = classified
          routeToPanel(classified, blockAccumRef.current[blockId])
        }
        return
      }
      if (isHeartbeatMessage(chunk)) {
        setStatusMessage(chunk.trim())
        return
      }
      const classified = classifyUnknownPayload(chunk)
      if (classified) routeToPanel(classified, chunk)
      return
    }

    // Chunk payload nested under a data envelope.
    const dataRecord = asRecord(record.data)
    if (dataRecord && (typeof dataRecord.chunk === 'string' || typeof dataRecord.blockId === 'string')) {
      handleEvent(dataRecord)
      return
    }

    // Final outputs flattened at the top level (dotted or block-named keys).
    const panelKeys = Object.keys(record).filter(
      (key) => !RESERVED_KEYS.has(key.toLowerCase()) && resolveBlockTarget(key) !== null,
    )
    if (panelKeys.length > 0) {
      finalOutputRef.current = { ...(finalOutputRef.current ?? {}), ...record }
      applyFinalOutputs(record)
      return
    }

    // Final outputs nested under output / outputs / result / data.
    for (const containerKey of ['output', 'outputs', 'result', 'data']) {
      const container = asRecord(record[containerKey])
      if (container) {
        finalOutputRef.current = { ...(finalOutputRef.current ?? {}), ...container }
        applyFinalOutputs(container)
        return
      }
    }

    if (typeof record.message === 'string' && record.message.trim()) {
      setStatusMessage(record.message.trim())
    }
  }

  function processLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    if (trimmed.startsWith('event:') || trimmed.startsWith('id:') || trimmed.startsWith('retry:')) return
    const data = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed
    if (!data) return
    if (data === '[DONE]') {
      doneRef.current = true
      return
    }
    rawTranscriptRef.current += `${data}\n`
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      if (isHeartbeatMessage(data)) {
        setStatusMessage(data)
        return
      }
      const target = classifyUnknownPayload(data)
      if (target) routeToPanel(target, data)
      return
    }
    handleEvent(parsed)
  }

  async function runEnhancement(payload: EnhancePayload): Promise<void> {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    startRef.current = Date.now()
    doneRef.current = false
    targetAccumRef.current = { article: '', gapanalysis: '', recommendations: '', coverage: '' }
    blockAccumRef.current = {}
    blockTargetRef.current = {}
    gapRef.current = null
    recRef.current = null
    covRef.current = null
    dataPresentRef.current = { article: false, gapanalysis: false, recommendations: false, coverage: false }
    rawTranscriptRef.current = ''
    finalOutputRef.current = null
    setContent('')
    setGapData(null)
    setRecData(null)
    setCoverage(null)
    setStages({ ...INITIAL_STAGES })
    setSections({ ...INITIAL_SECTIONS })
    setElapsed(0)
    setErrorMessage('')
    setStatusMessage('Contacting the enhancement agent…')
    setPhase('streaming')

    let response: Response
    try {
      response = await fetch('/api/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
    } catch {
      if (controller.signal.aborted) return
      fail('Could not reach the server. Check your connection and try again.')
      return
    }

    if (!response.ok) {
      let message = `The enhancement request failed (${response.status}).`
      try {
        const errJson = (await response.json()) as { error?: unknown }
        if (typeof errJson.error === 'string' && errJson.error) message = errJson.error
      } catch {
        // keep default message
      }
      fail(message)
      return
    }

    const responseType = response.headers.get('content-type') ?? ''
    if (responseType.includes('application/json')) {
      // Non-streamed fallback: the whole result arrives as one JSON body.
      try {
        const json = (await response.json()) as unknown
        rawTranscriptRef.current += JSON.stringify(json)
        const record = asRecord(json)
        if (record) {
          const output = asRecord(record.output) ?? record
          finalOutputRef.current = { ...(finalOutputRef.current ?? {}), ...output }
          applyFinalOutputs(output)
          if (!dataPresentRef.current.article) {
            const article = extractArticleContent(output)
            if (article) routeToPanel('article', article)
          }
        }
        finish()
      } catch {
        fail('The enhancement service returned an unreadable response.')
      }
      return
    }

    if (!response.body) {
      fail('The enhancement service returned an empty response.')
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) processLine(line)
      }
      if (buffer.trim()) processLine(buffer)
    } catch {
      if (controller.signal.aborted) return
      // Salvage whatever streamed before the connection dropped.
      salvageMissingPanels()
      const anyData = Object.values(dataPresentRef.current).some(Boolean)
      if (anyData) {
        finish()
        return
      }
      fail('The stream was interrupted before any results arrived. Please try again.')
      return
    }
    finish()
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (phase === 'streaming') return
    if (!validate()) return
    const resolvedType = contentType === 'Other' ? otherType.trim() : contentType
    const payload: EnhancePayload = {
      article_url: articleUrl.trim(),
      article_text: articleText.trim(),
      content_type: resolvedType,
    }
    lastPayloadRef.current = payload
    setSubmittedUrl(articleUrl.trim())
    void runEnhancement(payload)
  }

  function handleRetry(): void {
    setErrorMessage('')
    if (lastPayloadRef.current) {
      void runEnhancement(lastPayloadRef.current)
    } else {
      setPhase('idle')
    }
  }

  function handleExportPdf(): void {
    const html = buildPrintableHtml(content, gapData, recData, coverage)
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(html)
    win.document.close()
    win.focus()
    win.print()
  }

  const isStreaming = phase === 'streaming'

  const checklistStages: ChecklistStage[] = STAGE_ORDER.map((id) => ({
    id,
    label: STAGE_LABELS[id],
    status: stages[id],
  }))

  return (
    <div className="space-y-8">
      <section
        aria-label="Article input"
        className="card-enter rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8"
      >
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="article-url" className="mb-1.5 block text-sm font-medium text-ink">
                Article URL
              </label>
              <input
                id="article-url"
                type="url"
                value={articleUrl}
                onChange={(e) => setArticleUrl(e.target.value)}
                placeholder="https://example.com/post"
                disabled={isStreaming}
                aria-invalid={Boolean(errors.articleUrl)}
                aria-describedby={errors.articleUrl ? 'article-url-error' : undefined}
                className={`${inputBase} ${errors.articleUrl ? 'border-rose-300' : 'border-slate-200'}`}
              />
              {errors.articleUrl && (
                <p id="article-url-error" className="mt-1.5 text-xs font-medium text-rose-600">
                  {errors.articleUrl}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="content-type" className="mb-1.5 block text-sm font-medium text-ink">
                Content type
              </label>
              <select
                id="content-type"
                value={contentType}
                onChange={(e) => setContentType(e.target.value)}
                disabled={isStreaming}
                aria-invalid={Boolean(errors.contentType)}
                aria-describedby={errors.contentType ? 'content-type-error' : undefined}
                className={`${inputBase} ${errors.contentType ? 'border-rose-300' : 'border-slate-200'}`}
              >
                <option value="">Select a type…</option>
                {CONTENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              {errors.contentType && (
                <p id="content-type-error" className="mt-1.5 text-xs font-medium text-rose-600">
                  {errors.contentType}
                </p>
              )}
            </div>
          </div>
          {contentType === 'Other' && (
            <div>
              <label htmlFor="other-type" className="mb-1.5 block text-sm font-medium text-ink">
                Describe your content type
              </label>
              <input
                id="other-type"
                type="text"
                value={otherType}
                onChange={(e) => setOtherType(e.target.value)}
                placeholder="e.g. Case study"
                disabled={isStreaming}
                aria-invalid={Boolean(errors.otherType)}
                aria-describedby={errors.otherType ? 'other-type-error' : undefined}
                className={`${inputBase} ${errors.otherType ? 'border-rose-300' : 'border-slate-200'}`}
              />
              {errors.otherType && (
                <p id="other-type-error" className="mt-1.5 text-xs font-medium text-rose-600">
                  {errors.otherType}
                </p>
              )}
            </div>
          )}
          <div>
            <label htmlFor="article-text" className="mb-1.5 block text-sm font-medium text-ink">
              Article text
            </label>
            <textarea
              id="article-text"
              rows={10}
              value={articleText}
              onChange={(e) => setArticleText(e.target.value)}
              placeholder="Paste the full article text here…"
              disabled={isStreaming}
              aria-invalid={Boolean(errors.articleText)}
              aria-describedby={errors.articleText ? 'article-text-error' : undefined}
              className={`${inputBase} resize-y ${errors.articleText ? 'border-rose-300' : 'border-slate-200'}`}
            />
            {errors.articleText && (
              <p id="article-text-error" className="mt-1.5 text-xs font-medium text-rose-600">
                {errors.articleText}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={isStreaming}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isStreaming ? 'Enhancing…' : 'Enhance article'}
            </button>
            {phase === 'done' && content.trim() ? (
              <button
                type="button"
                onClick={handleExportPdf}
                className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-ink-soft transition hover:border-indigo-200 hover:text-accent-deep"
              >
                Export PDF
              </button>
            ) : null}
          </div>
        </form>
      </section>

      {phase === 'error' && <ErrorCard message={errorMessage} onRetry={handleRetry} />}

      {(phase === 'streaming' || phase === 'done') && (
        <div className="space-y-4">
          {phase === 'streaming' && (
            <StatusChip message={statusMessage || 'Enhancing your article…'} elapsedSeconds={elapsed} />
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
        </div>
      )}
    </div>
  )
}
