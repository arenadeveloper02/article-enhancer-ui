import type {
  ArticleSegment,
  CoverageData,
  CriteriaItem,
  GapAnalysisData,
  RecommendationItem,
  RecommendationsData,
} from '@/lib/types'

/**
 * Decodes literal unicode escape sequences (e.g. \u2013) into real characters.
 * Handles both single-escaped and double-escaped payloads.
 */
export function decodeUnicodeEscapes(input: string): string {
  let result = input.replace(/\\\\u([0-9a-fA-F]{4})/g, '\\u$1')
  result = result.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  )
  return result
}

/**
 * Attempts to extract and parse the first structurally complete (balanced)
 * JSON object or array from accumulated streamed text. Returns null while the
 * payload is still incomplete or unparseable — never throws.
 */
export function extractBalancedJson(text: string): unknown {
  const trimmed = text.trim()
  const start = trimmed.search(/[{[]/)
  if (start === -1) return null
  const candidate = trimmed.slice(start)
  let depth = 0
  let inString = false
  let escaped = false
  let end = -1
  for (let i = 0; i < candidate.length; i++) {
    const ch = candidate[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{' || ch === '[') {
      depth++
    } else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end === -1) return null
  try {
    return JSON.parse(candidate.slice(0, end + 1)) as unknown
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseMaybe(raw: unknown): unknown {
  if (typeof raw === 'string') {
    const parsed = extractBalancedJson(raw)
    return parsed === null ? raw : parsed
  }
  return raw
}

/**
 * Tolerant key lookup: exact key, dotted key (e.g. "gapanalysis.coverage_gaps"),
 * and one nested level (e.g. { gapanalysis: { coverage_gaps } }).
 */
function lookup(source: unknown, keys: string[]): unknown {
  if (!isRecord(source)) return undefined
  for (const key of keys) {
    if (key in source) return source[key]
  }
  for (const [entryKey, entryValue] of Object.entries(source)) {
    for (const key of keys) {
      if (entryKey.toLowerCase().endsWith(`.${key}`)) return entryValue
    }
    if (isRecord(entryValue)) {
      for (const key of keys) {
        if (key in entryValue) return entryValue[key]
      }
    }
  }
  return undefined
}

function firstString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in obj) return obj[key]
  }
  return undefined
}

function splitToLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => decodeUnicodeEscapes(line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()))
    .filter((line) => line.length > 0)
}

type GapEntry = string | { title: string; detail?: string }

function toGapEntries(value: unknown): GapEntry[] {
  try {
    let source = value
    if (typeof source === 'string') {
      const parsed = extractBalancedJson(source)
      if (Array.isArray(parsed)) {
        source = parsed
      } else {
        return splitToLines(source)
      }
    }
    const arr: unknown[] = Array.isArray(source)
      ? source
      : isRecord(source)
        ? [source]
        : source === null || source === undefined
          ? []
          : [String(source)]
    const out: GapEntry[] = []
    for (const item of arr) {
      if (typeof item === 'string') {
        const text = decodeUnicodeEscapes(item.trim())
        if (text) out.push(text)
        continue
      }
      if (typeof item === 'number' || typeof item === 'boolean') {
        out.push(String(item))
        continue
      }
      if (isRecord(item)) {
        const title = firstString(item, ['title', 'name', 'strength', 'gap', 'section', 'text', 'summary', 'item', 'label'])
        const detail = firstString(item, ['detail', 'details', 'description', 'notes', 'reason', 'explanation'])
        if (title) {
          if (detail && detail !== title) {
            out.push({ title: decodeUnicodeEscapes(title), detail: decodeUnicodeEscapes(detail) })
          } else {
            out.push({ title: decodeUnicodeEscapes(title) })
          }
        }
      }
    }
    return out
  } catch {
    return []
  }
}

export function normalizeGapAnalysis(raw: unknown): GapAnalysisData {
  try {
    const parsed = parseMaybe(raw)
    return {
      competitor_strengths: toGapEntries(lookup(parsed, ['competitor_strengths'])) as GapAnalysisData['competitor_strengths'],
      coverage_gaps: toGapEntries(lookup(parsed, ['coverage_gaps'])) as GapAnalysisData['coverage_gaps'],
      underdeveloped_sections: toGapEntries(lookup(parsed, ['underdeveloped_sections'])) as GapAnalysisData['underdeveloped_sections'],
    }
  } catch {
    return { competitor_strengths: [], coverage_gaps: [], underdeveloped_sections: [] }
  }
}

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

export function normalizeRecommendations(raw: unknown): RecommendationsData {
  try {
    const parsed = parseMaybe(raw)
    let list: unknown = parsed
    if (isRecord(parsed)) {
      const found = lookup(parsed, ['recommendations'])
      if (found !== undefined) {
        list = found
        if (isRecord(found)) {
          const inner = lookup(found, ['recommendations'])
          if (inner !== undefined) list = inner
        }
      }
    }
    if (typeof list === 'string') {
      const reparsed = extractBalancedJson(list)
      list = Array.isArray(reparsed) ? reparsed : splitToLines(list)
    }
    const arr: unknown[] = Array.isArray(list) ? list : isRecord(list) ? [list] : []
    const items: RecommendationItem[] = []
    for (const entry of arr) {
      if (typeof entry === 'string') {
        const text = decodeUnicodeEscapes(entry.trim())
        if (text) items.push({ title: text, detail: '', priority: null, category: null })
        continue
      }
      if (!isRecord(entry)) continue
      let title = firstString(entry, ['title', 'headline', 'name'])
      let detail = firstString(entry, ['detail', 'details', 'description', 'text', 'body', 'recommendation'])
      if (!title) {
        if (!detail) continue
        if (detail.length > 60) {
          title = `${detail.slice(0, 60).trim()}…`
        } else {
          title = detail
          detail = ''
        }
      }
      const rawPriority = firstString(entry, ['priority', 'importance', 'severity']).toLowerCase()
      const category = firstString(entry, ['category', 'type', 'area'])
      items.push({
        title: decodeUnicodeEscapes(title),
        detail: decodeUnicodeEscapes(detail),
        priority: rawPriority ? rawPriority : null,
        category: category ? decodeUnicodeEscapes(category) : null,
      })
    }
    const hasKnownPriority = items.some(
      (item) => typeof item.priority === 'string' && item.priority in PRIORITY_RANK,
    )
    if (hasKnownPriority) {
      const ranked = items.map((item, index) => ({ item, index }))
      ranked.sort((a, b) => {
        const rankA =
          typeof a.item.priority === 'string' && a.item.priority in PRIORITY_RANK
            ? PRIORITY_RANK[a.item.priority]
            : 3
        const rankB =
          typeof b.item.priority === 'string' && b.item.priority in PRIORITY_RANK
            ? PRIORITY_RANK[b.item.priority]
            : 3
        return rankA === rankB ? a.index - b.index : rankA - rankB
      })
      return { recommendations: ranked.map((r) => r.item) }
    }
    return { recommendations: items }
  } catch {
    return { recommendations: [] }
  }
}

function clampScore(value: unknown): number | null {
  let num: number | null = null
  if (typeof value === 'number') {
    num = value
  } else if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(/[^\d.+-]/g, ''))
    if (Number.isFinite(parsed)) num = parsed
  }
  if (num === null || !Number.isFinite(num)) return null
  if (num < 0) return 0
  if (num > 100) return 100
  return num
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase()
    if (['true', 'yes', 'pass', 'passed'].includes(lower)) return true
    if (['false', 'no', 'fail', 'failed'].includes(lower)) return false
  }
  return null
}

export function normalizeCoverage(raw: unknown): CoverageData {
  try {
    const parsed = parseMaybe(raw)
    if (!isRecord(parsed)) {
      return { overall_score: null, passed: null, summary: null, criteria: [] }
    }
    const overall_score = clampScore(lookup(parsed, ['overall_score', 'overallscore', 'score']))
    const passed = toBoolean(lookup(parsed, ['passed', 'pass']))
    const rawSummary = lookup(parsed, ['summary', 'verdict'])
    const summary =
      typeof rawSummary === 'string' && rawSummary.trim()
        ? decodeUnicodeEscapes(rawSummary.trim())
        : null
    const rawCriteria = lookup(parsed, ['criteria', 'checks', 'criteria_results'])
    const criteriaArr: unknown[] = Array.isArray(rawCriteria)
      ? rawCriteria
      : isRecord(rawCriteria)
        ? [rawCriteria]
        : []
    const criteria: CriteriaItem[] = []
    for (const entry of criteriaArr) {
      if (typeof entry === 'string') {
        const text = decodeUnicodeEscapes(entry.trim())
        if (text) criteria.push({ name: text, passed: null, score: null, notes: null })
        continue
      }
      if (!isRecord(entry)) continue
      const name = firstString(entry, ['name', 'criterion', 'criteria', 'title', 'label'])
      if (!name) continue
      const notes = firstString(entry, ['notes', 'note', 'comment', 'reason', 'explanation'])
      criteria.push({
        name: decodeUnicodeEscapes(name),
        passed: toBoolean(pick(entry, ['passed', 'pass', 'met', 'satisfied'])),
        score: clampScore(pick(entry, ['score', 'rating'])),
        notes: notes ? decodeUnicodeEscapes(notes) : null,
      })
    }
    return { overall_score, passed, summary, criteria }
  } catch {
    return { overall_score: null, passed: null, summary: null, criteria: [] }
  }
}

/**
 * Pulls enhanced-article markdown out of a non-streamed JSON fallback payload.
 */
export function extractArticleContent(raw: unknown): string {
  try {
    if (typeof raw === 'string') return raw
    if (!isRecord(raw)) return ''
    const found = lookup(raw, ['content', 'article', 'enhanced_article', 'markdown', 'text'])
    return typeof found === 'string' ? found : ''
  } catch {
    return ''
  }
}

/**
 * True when a normalized GapAnalysisData is still the all-empty default shape.
 */
export function isGapAnalysisEmpty(data: GapAnalysisData): boolean {
  return (
    data.competitor_strengths.length === 0 &&
    data.coverage_gaps.length === 0 &&
    data.underdeveloped_sections.length === 0
  )
}

/**
 * True when a normalized RecommendationsData is still the empty default shape.
 */
export function isRecommendationsEmpty(data: RecommendationsData): boolean {
  return data.recommendations.length === 0
}

/**
 * True when a normalized CoverageData is still the all-null/empty default shape.
 */
export function isCoverageEmpty(data: CoverageData): boolean {
  return (
    data.overall_score === null &&
    data.passed === null &&
    data.summary === null &&
    data.criteria.length === 0
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Enhanced-article presentation helpers
//
// The article stream may contain literal <br> tags (which must render as real
// line breaks) and [+ADDED]…[/ADDED] marker pairs (which must render as inline
// highlights, never as visible bracket tokens). Everything below is the single
// shared preprocessing step applied before the string reaches the Markdown
// renderer, the clipboard, or the PDF export.
// ─────────────────────────────────────────────────────────────────────────────

const MARKER_OPEN = '[+ADDED]'
const MARKER_CLOSE = '[/ADDED]'

// Tokens whose *partial* prefixes must never flash on screen at the current
// streaming boundary (e.g. "[+ADD" or "<br" arriving mid-chunk).
const DANGLING_TOKENS = [MARKER_OPEN, MARKER_CLOSE, '<br />', '<br/>', '<br>'] as const

function trimDanglingToken(text: string): string {
  for (const token of DANGLING_TOKENS) {
    for (let len = token.length - 1; len >= 1; len--) {
      if (text.length < len) continue
      const tail = text.slice(text.length - len).toLowerCase()
      if (tail === token.slice(0, len).toLowerCase()) {
        return text.slice(0, text.length - len)
      }
    }
  }
  return text
}

/**
 * Splits accumulated article text into plain and "added" segments.
 * - `<br>`, `<br/>`, `<br />` become markdown hard line breaks ("  \n").
 * - `[+ADDED]…[/ADDED]` pairs produce `added: true` segments (markers removed).
 * - Streaming-safe: an unclosed `[+ADDED]` highlights from the marker to the
 *   current end of text and keeps extending as more chunks arrive (progressive
 *   highlight extension), so the live-typing effect is never interrupted.
 * - A dangling partial marker/tag at the very end of the text is held back so
 *   raw fragments like "[+ADD" or "<br" never appear on screen.
 */
export function splitArticleSegments(input: string): ArticleSegment[] {
  const withBreaks = input.replace(/<br\s*\/?>/gi, '  \n')
  const text = trimDanglingToken(withBreaks)
  const segments: ArticleSegment[] = []
  let cursor = 0
  while (cursor < text.length) {
    const openIdx = text.indexOf(MARKER_OPEN, cursor)
    if (openIdx === -1) {
      segments.push({ text: text.slice(cursor), added: false })
      break
    }
    if (openIdx > cursor) {
      segments.push({ text: text.slice(cursor, openIdx), added: false })
    }
    const innerStart = openIdx + MARKER_OPEN.length
    const closeIdx = text.indexOf(MARKER_CLOSE, innerStart)
    if (closeIdx === -1) {
      // Progressive streaming highlight: [+ADDED] arrived but [/ADDED] has not.
      segments.push({ text: text.slice(innerStart), added: true })
      break
    }
    segments.push({ text: text.slice(innerStart, closeIdx), added: true })
    cursor = closeIdx + MARKER_CLOSE.length
  }
  return segments.filter((segment) => segment.text.length > 0)
}

/**
 * Wraps one line of "added" text in <mark>, preserving markdown block prefixes
 * (headings, list bullets, blockquotes) and trailing hard-break whitespace
 * outside the tag so block structure and "  \n" hard breaks keep working.
 */
function wrapAddedLine(line: string): string {
  const trailingMatch = line.match(/\s+$/)
  const trailing = trailingMatch ? trailingMatch[0] : ''
  const core = trailing ? line.slice(0, line.length - trailing.length) : line
  if (!core.trim()) return line
  const blockMatch = core.match(/^(\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*))(.*)$/)
  if (blockMatch) {
    const prefix = blockMatch[1] ?? ''
    const rest = blockMatch[2] ?? ''
    if (!rest.trim()) return line
    return `${prefix}<mark>${rest}</mark>${trailing}`
  }
  return `<mark>${core}</mark>${trailing}`
}

/**
 * Single shared preprocessing step for on-screen rendering: converts <br>
 * variants to markdown hard breaks and [+ADDED]…[/ADDED] spans to <mark>
 * inline highlights. The output is handed to the Markdown renderer — the raw
 * substrings "<br>", "[+ADDED]", and "[/ADDED]" never survive this transform.
 */
export function preprocessArticleContent(input: string): string {
  return splitArticleSegments(input)
    .map((segment) =>
      segment.added
        ? segment.text
            .split('\n')
            .map((line) => wrapAddedLine(line))
            .join('\n')
        : segment.text,
    )
    .join('')
}

/**
 * Marker-free plain markdown for 'Copy article': <br> variants become real
 * line breaks and [+ADDED]/[/ADDED] tokens are stripped entirely.
 */
export function stripArticleMarkers(input: string): string {
  return splitArticleSegments(input)
    .map((segment) => segment.text)
    .join('')
}
