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

/**
 * Maps an arbitrary list-ish payload to RecommendationItem[]. Shared by the
 * primary recommendations list and the additional citation_opportunities /
 * faq_suggestions outputs — extra keys map object fields tolerantly
 * (question/answer for FAQs, source/url/reason for citations) onto the same
 * title + detail card shape, so no new UI pattern is needed.
 */
function toRecommendationItems(rawList: unknown, defaultCategory: string | null): RecommendationItem[] {
  let list = rawList
  if (typeof list === 'string') {
    const reparsed = extractBalancedJson(list)
    list = Array.isArray(reparsed) ? reparsed : splitToLines(list)
  }
  const arr: unknown[] = Array.isArray(list) ? list : isRecord(list) ? [list] : []
  const items: RecommendationItem[] = []
  for (const entry of arr) {
    if (typeof entry === 'string') {
      const text = decodeUnicodeEscapes(entry.trim())
      if (text) items.push({ title: text, detail: '', priority: null, category: defaultCategory })
      continue
    }
    if (!isRecord(entry)) continue
    let title = firstString(entry, ['title', 'headline', 'name', 'question', 'source', 'topic', 'citation', 'opportunity'])
    let detail = firstString(entry, ['detail', 'details', 'description', 'text', 'body', 'recommendation', 'rationale', 'answer', 'suggestion', 'reason', 'why_it_matters', 'url', 'link'])
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
    const category = firstString(entry, ['category', 'type', 'area', 'placement']) || (defaultCategory ?? '')
    items.push({
      title: decodeUnicodeEscapes(title),
      detail: decodeUnicodeEscapes(detail),
      priority: rawPriority ? rawPriority : null,
      category: category ? decodeUnicodeEscapes(category) : null,
    })
  }
  return items
}

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
    const items = toRecommendationItems(list, null)

    // Additional recommendation outputs from the workflow:
    // recommendations.citation_opportunities and recommendations.faq_suggestions.
    // They render as extra entries in the same list/card style; missing or
    // empty keys contribute nothing (same behavior as other empty types).
    const containers: unknown[] = [parsed]
    if (isRecord(parsed)) {
      const found = lookup(parsed, ['recommendations'])
      if (isRecord(found)) containers.push(found)
    }
    let citationsRaw: unknown
    let faqsRaw: unknown
    for (const container of containers) {
      if (citationsRaw === undefined) {
        citationsRaw = lookup(container, ['citation_opportunities', 'citationopportunities', 'citations'])
      }
      if (faqsRaw === undefined) {
        faqsRaw = lookup(container, ['faq_suggestions', 'faqsuggestions', 'faqs'])
      }
    }
    const combined = [
      ...items,
      ...toRecommendationItems(citationsRaw, 'Citation Opportunity'),
      ...toRecommendationItems(faqsRaw, 'FAQ Suggestion'),
    ]

    const hasKnownPriority = combined.some(
      (item) => typeof item.priority === 'string' && item.priority in PRIORITY_RANK,
    )
    if (hasKnownPriority) {
      const ranked = combined.map((item, index) => ({ item, index }))
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
    return { recommendations: combined }
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
    const criteriaSource =
      typeof rawCriteria === 'string' ? extractBalancedJson(rawCriteria) : rawCriteria
    const criteriaArr: unknown[] = Array.isArray(criteriaSource) ? criteriaSource : []
    const criteria: CriteriaItem[] = []
    for (const entry of criteriaArr) {
      if (typeof entry === 'string') {
        const text = decodeUnicodeEscapes(entry.trim())
        if (text) criteria.push({ name: text, passed: null, score: null, notes: null })
        continue
      }
      if (!isRecord(entry)) continue
      const name = firstString(entry, ['name', 'criterion', 'criteria', 'title', 'check', 'label'])
      if (!name) continue
      const notes = firstString(entry, ['notes', 'justification', 'reason', 'explanation', 'detail', 'details', 'comment'])
      criteria.push({
        name: decodeUnicodeEscapes(name),
        passed: toBoolean(pick(entry, ['passed', 'pass', 'met', 'ok'])),
        score: clampScore(pick(entry, ['score', 'value', 'rating'])),
        notes: notes ? decodeUnicodeEscapes(notes) : null,
      })
    }
    return { overall_score, passed, summary, criteria }
  } catch {
    return { overall_score: null, passed: null, summary: null, criteria: [] }
  }
}

const ADDED_OPEN = '[+ADDED]'
const ADDED_CLOSE = '[/ADDED]'

/**
 * Splits enhanced-article text on [+ADDED]…[/ADDED] markers into segments.
 * An unclosed opening marker (mid-stream) highlights the remaining tail so
 * highlighting is progressive while streaming.
 */
export function splitArticleSegments(content: string): ArticleSegment[] {
  const segments: ArticleSegment[] = []
  let cursor = 0
  while (cursor < content.length) {
    const openIdx = content.indexOf(ADDED_OPEN, cursor)
    if (openIdx === -1) {
      segments.push({ text: content.slice(cursor), added: false })
      break
    }
    if (openIdx > cursor) {
      segments.push({ text: content.slice(cursor, openIdx), added: false })
    }
    const closeIdx = content.indexOf(ADDED_CLOSE, openIdx + ADDED_OPEN.length)
    if (closeIdx === -1) {
      segments.push({ text: content.slice(openIdx + ADDED_OPEN.length), added: true })
      break
    }
    segments.push({ text: content.slice(openIdx + ADDED_OPEN.length, closeIdx), added: true })
    cursor = closeIdx + ADDED_CLOSE.length
  }
  return segments.filter((segment) => segment.text.length > 0)
}

/** Removes a trailing partially-streamed marker token so raw fragments never render. */
function stripTrailingPartialMarker(text: string): string {
  for (const token of [ADDED_OPEN, ADDED_CLOSE]) {
    for (let len = token.length - 1; len > 0; len--) {
      if (text.endsWith(token.slice(0, len))) return text.slice(0, text.length - len)
    }
  }
  return text
}

/**
 * Converts literal <br> tags to real line breaks OUTSIDE table rows. <br>
 * tags inside markdown pipe-table cells are preserved so rehype-raw can
 * render them as in-cell line breaks without breaking the table structure.
 */
function convertBreaks(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const isTableRow = line.trimStart().startsWith('|')
      return isTableRow ? line : line.replace(/<br\s*\/?>/gi, '\n')
    })
    .join('\n')
}

/**
 * Single shared preprocessing step for enhanced-article markdown:
 * <br> → real line breaks (outside table cells) and [+ADDED]…[/ADDED] →
 * inline <mark> highlights (progressive while streaming). Raw marker tokens
 * never reach the renderer.
 */
export function preprocessArticleContent(content: string): string {
  const safe = stripTrailingPartialMarker(content)
  const segments = splitArticleSegments(safe)
  const rebuilt = segments
    .map((segment) => {
      if (!segment.added) return segment.text
      // Wrap each non-empty line separately so <mark> stays inline-safe
      // across multi-line added blocks.
      return segment.text
        .split('\n')
        .map((line) => (line.trim() ? `<mark>${line}</mark>` : line))
        .join('\n')
    })
    .join('')
  return convertBreaks(rebuilt)
}

/**
 * Strips [+ADDED]/[/ADDED] marker tokens (and converts <br> outside tables)
 * for clean clipboard text and word counting — no highlight markup included.
 */
export function stripArticleMarkers(content: string): string {
  const withoutMarkers = content.split(ADDED_OPEN).join('').split(ADDED_CLOSE).join('')
  return convertBreaks(stripTrailingPartialMarker(withoutMarkers))
}
