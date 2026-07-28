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

/**
 * Extracts EVERY structurally complete JSON object/array found in raw text,
 * in order. Some stream runs emit a block's output as a plain sequence of
 * JSON arrays (no wrapping object keys) — this lets normalizers route those
 * payloads positionally instead of dropping everything after the first array.
 */
function extractAllBalancedJson(text: string): unknown[] {
  const results: unknown[] = []
  let cursor = 0
  while (cursor < text.length) {
    const rel = text.slice(cursor).search(/[{[]/)
    if (rel === -1) break
    const start = cursor + rel
    let depth = 0
    let inString = false
    let escaped = false
    let end = -1
    for (let i = start; i < text.length; i++) {
      const ch = text[i]
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
    if (end === -1) break
    try {
      results.push(JSON.parse(text.slice(start, end + 1)) as unknown)
    } catch {
      // Skip unparseable regions and keep scanning.
    }
    cursor = end + 1
  }
  return results
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
        const detail = firstString(item, ['detail', 'details', 'description', 'notes', 'reason', 'explanation', 'why_it_matters', 'rationale'])
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
    let strengths = lookup(parsed, ['competitor_strengths'])
    let gaps = lookup(parsed, ['coverage_gaps'])
    let underdeveloped = lookup(parsed, ['underdeveloped_sections'])
    // Keyless fallback: current stream runs emit the gap-analysis block as a
    // plain SEQUENCE of JSON arrays (competitor strengths, then coverage gaps,
    // then underdeveloped sections) with no wrapping object keys. Route those
    // positionally so the panel never stays empty.
    if (
      strengths === undefined &&
      gaps === undefined &&
      underdeveloped === undefined &&
      typeof raw === 'string'
    ) {
      const arrays = extractAllBalancedJson(raw).filter((entry): entry is unknown[] => Array.isArray(entry))
      if (arrays.length > 0) {
        strengths = arrays[0]
        gaps = arrays.length > 1 ? arrays[1] : undefined
        underdeveloped = arrays.length > 2 ? arrays[2] : undefined
      }
    }
    return {
      competitor_strengths: toGapEntries(strengths) as GapAnalysisData['competitor_strengths'],
      coverage_gaps: toGapEntries(gaps) as GapAnalysisData['coverage_gaps'],
      underdeveloped_sections: toGapEntries(underdeveloped) as GapAnalysisData['underdeveloped_sections'],
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
      let detail = firstString(entry, ['detail', 'details', 'description', 'text', 'body', 'recommendation', 'rationale'])
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
      const category = firstString(entry, ['category', 'type', 'area', 'placement'])
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
      const notes = firstString(entry, ['notes', 'note', 'comment', 'reason', 'explanation', 'justification', 'rationale'])
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

// ────────────────────────────────────────────────────────────────────────────
// Enhanced-article [+ADDED]…[/ADDED] marker handling
// ────────────────────────────────────────────────────────────────────────────

const ADDED_OPEN = '[+ADDED]'
const ADDED_CLOSE = '[/ADDED]'

/**
 * Hides a partially streamed marker token at the very end of the text so the
 * literal bracket characters never flash in the UI mid-stream.
 */
function trimPartialMarker(text: string): string {
  const maxLen = Math.max(ADDED_OPEN.length, ADDED_CLOSE.length) - 1
  for (let len = Math.min(text.length, maxLen); len > 0; len--) {
    const tail = text.slice(text.length - len)
    if (ADDED_OPEN.startsWith(tail) || ADDED_CLOSE.startsWith(tail)) {
      return text.slice(0, text.length - len)
    }
  }
  return text
}

/**
 * Splits enhanced-article text into plain and added segments using the
 * [+ADDED]…[/ADDED] markers. Works progressively while streaming: an opening
 * marker without its closing pair still highlights the trailing text.
 */
export function splitArticleSegments(content: string): ArticleSegment[] {
  const text = trimPartialMarker(content)
  const segments: ArticleSegment[] = []
  let rest = text
  while (rest.length > 0) {
    const open = rest.indexOf(ADDED_OPEN)
    if (open === -1) {
      segments.push({ text: rest, added: false })
      break
    }
    if (open > 0) segments.push({ text: rest.slice(0, open), added: false })
    const afterOpen = rest.slice(open + ADDED_OPEN.length)
    const close = afterOpen.indexOf(ADDED_CLOSE)
    if (close === -1) {
      if (afterOpen) segments.push({ text: afterOpen, added: true })
      break
    }
    if (close > 0) segments.push({ text: afterOpen.slice(0, close), added: true })
    rest = afterOpen.slice(close + ADDED_CLOSE.length)
  }
  return segments.filter((segment) => segment.text.length > 0)
}

/**
 * Wraps one line of added markdown in <mark> while keeping list/heading/quote
 * prefixes and table pipes OUTSIDE the tag so markdown structure still parses.
 */
function highlightLine(line: string): string {
  if (!line.trim()) return line
  if (line.trimStart().startsWith('|')) {
    return line
      .split('|')
      .map((cell) => {
        const inner = cell.trim()
        if (!inner) return cell
        if (/^[-: ]+$/.test(inner)) return cell
        return cell.replace(inner, `<mark>${inner}</mark>`)
      })
      .join('|')
  }
  const prefixMatch = line.match(/^(\s*(?:(?:[-*+]|\d+[.)]|#{1,6}|>)\s+)?)([\s\S]*)$/)
  if (prefixMatch && prefixMatch[2].trim()) {
    return `${prefixMatch[1]}<mark>${prefixMatch[2]}</mark>`
  }
  return `<mark>${line}</mark>`
}

function markAddedText(text: string): string {
  return text
    .split('\n')
    .map((line) => highlightLine(line))
    .join('\n')
}

/**
 * Converts <br> tags to markdown hard breaks OUTSIDE table rows (tables need
 * their <br> cell separators preserved for GFM parsing).
 */
function convertLineBreaks(content: string): string {
  return content
    .split('\n')
    .map((line) => (line.trimStart().startsWith('|') ? line : line.replace(/<br\s*\/?>/gi, '  \n')))
    .join('\n')
}

/**
 * Single shared preprocessing step for the article panel: normalizes <br>
 * usage and converts [+ADDED]…[/ADDED] markers into inline <mark> highlights.
 * Progressive while streaming — raw marker tokens never reach the renderer.
 */
export function preprocessArticleContent(content: string): string {
  const normalized = convertLineBreaks(content)
  return splitArticleSegments(normalized)
    .map((segment) => (segment.added ? markAddedText(segment.text) : segment.text))
    .join('')
}

/**
 * Removes [+ADDED]/[/ADDED] marker tokens entirely (clipboard / word counts).
 */
export function stripArticleMarkers(content: string): string {
  return trimPartialMarker(content).replace(/\[\+ADDED\]/g, '').replace(/\[\/ADDED\]/g, '')
}
