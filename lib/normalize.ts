import type {
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
 * primary recommendations list and the citation_opportunities /
 * faq_suggestions outputs. Alongside the tolerant title/detail fallbacks it
 * captures the STRUCTURED per-section fields the Recommendations tab renders:
 *  - citations: claim_or_stats → claim, placement, source_name → sourceName,
 *    source_url → sourceUrl
 *  - FAQs: question, suggested_answer → answer, why_it_matters → whyItMatters
 *  - recommendations: recommendation, placement, priority, rationale
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
    // Structured fields for the three Recommendations sections.
    const placement = firstString(entry, ['placement', 'where', 'location', 'section'])
    const rationale = firstString(entry, ['rationale', 'reason', 'justification', 'why'])
    const recommendation = firstString(entry, ['recommendation', 'suggestion', 'action', 'advice'])
    const claim = firstString(entry, ['claim_or_stats', 'claim_or_stat', 'claim', 'stat', 'stats', 'statistic', 'data_point'])
    const sourceName = firstString(entry, ['source_name', 'sourcename', 'source', 'publisher', 'publication'])
    const sourceUrl = firstString(entry, ['source_url', 'sourceurl', 'url', 'link', 'href'])
    const question = firstString(entry, ['question', 'faq_question', 'faq'])
    const answer = firstString(entry, ['suggested_answer', 'suggestedanswer', 'answer', 'proposed_answer'])
    const whyItMatters = firstString(entry, ['why_it_matters', 'why_this_matters', 'whyitmatters', 'impact'])

    let title = firstString(entry, ['title', 'headline', 'name', 'question', 'source', 'topic', 'citation', 'opportunity'])
    let detail = firstString(entry, ['detail', 'details', 'description', 'text', 'body', 'recommendation', 'rationale', 'answer', 'suggestion', 'reason', 'why_it_matters', 'url', 'link'])
    if (!title) {
      const fallback = recommendation || claim || question || detail
      if (!fallback) continue
      if (fallback.length > 60) {
        title = `${fallback.slice(0, 60).trim()}…`
      } else {
        title = fallback
        if (fallback === detail) detail = ''
      }
    }
    const rawPriority = firstString(entry, ['priority', 'importance', 'severity']).toLowerCase()
    const category = firstString(entry, ['category', 'type', 'area']) || (defaultCategory ?? '')
    items.push({
      title: decodeUnicodeEscapes(title),
      detail: decodeUnicodeEscapes(detail),
      priority: rawPriority ? rawPriority : null,
      category: category ? decodeUnicodeEscapes(category) : null,
      placement: placement ? decodeUnicodeEscapes(placement) : null,
      rationale: rationale ? decodeUnicodeEscapes(rationale) : null,
      recommendation: recommendation ? decodeUnicodeEscapes(recommendation) : null,
      claim: claim ? decodeUnicodeEscapes(claim) : null,
      sourceName: sourceName ? decodeUnicodeEscapes(sourceName) : null,
      sourceUrl: sourceUrl ? decodeUnicodeEscapes(sourceUrl) : null,
      question: question ? decodeUnicodeEscapes(question) : null,
      answer: answer ? decodeUnicodeEscapes(answer) : null,
      whyItMatters: whyItMatters ? decodeUnicodeEscapes(whyItMatters) : null,
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
    // They are tagged with fixed categories so the Recommendations tab can
    // partition them into their own titled sections; missing or empty keys
    // contribute nothing (same behavior as other empty types).
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

function toBooleanish(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase()
    if (lower === 'true' || lower === 'pass' || lower === 'passed' || lower === 'yes') return true
    if (lower === 'false' || lower === 'fail' || lower === 'failed' || lower === 'no') return false
  }
  return null
}

function toNumberish(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    if (value.trim() && Number.isFinite(parsed)) return parsed
  }
  return null
}

function toCriteria(value: unknown): CriteriaItem[] {
  let list = value
  if (typeof list === 'string') {
    const parsed = extractBalancedJson(list)
    list = Array.isArray(parsed) || isRecord(parsed) ? parsed : []
  }
  const arr: unknown[] = Array.isArray(list) ? list : isRecord(list) ? [list] : []
  const items: CriteriaItem[] = []
  for (const entry of arr) {
    if (typeof entry === 'string') {
      const text = decodeUnicodeEscapes(entry.trim())
      if (text) items.push({ name: text, passed: null, score: null, notes: null })
      continue
    }
    if (!isRecord(entry)) continue
    const name = firstString(entry, ['name', 'criterion', 'criteria', 'title', 'label', 'check'])
    if (!name) continue
    const notes = firstString(entry, ['notes', 'justification', 'reason', 'detail', 'details', 'explanation', 'comment'])
    items.push({
      name: decodeUnicodeEscapes(name),
      passed: toBooleanish(pick(entry, ['passed', 'pass', 'met', 'status'])),
      score: toNumberish(pick(entry, ['score', 'value', 'points', 'rating'])),
      notes: notes ? decodeUnicodeEscapes(notes) : null,
    })
  }
  return items
}

export function normalizeCoverage(raw: unknown): CoverageData {
  try {
    const parsed = parseMaybe(raw)
    const score = toNumberish(lookup(parsed, ['overall_score', 'overallscore', 'score']))
    const passed = toBooleanish(lookup(parsed, ['passed', 'pass']))
    const summaryRaw = lookup(parsed, ['summary', 'overview', 'assessment'])
    const summary =
      typeof summaryRaw === 'string' && summaryRaw.trim()
        ? decodeUnicodeEscapes(summaryRaw.trim())
        : null
    const criteria = toCriteria(lookup(parsed, ['criteria', 'checks', 'criterions']))
    return { overall_score: score, passed, summary, criteria }
  } catch {
    return { overall_score: null, passed: null, summary: null, criteria: [] }
  }
}

// ── Enhanced-article marker preprocessing ─────────────────────────────────
// The writer wraps pipeline-added text in [+ADDED]…[/ADDED] markers. These
// helpers convert them to inline <mark> highlights (progressively while
// streaming) and strip them entirely for the clipboard / word count. Literal
// <br> tags are converted to markdown hard breaks EXCEPT inside table rows,
// where rehype-raw renders them as in-cell line breaks.

const ADDED_OPEN = '[+ADDED]'
const ADDED_CLOSE = '[/ADDED]'

function countOccurrences(text: string, token: string): number {
  let count = 0
  let idx = text.indexOf(token)
  while (idx !== -1) {
    count++
    idx = text.indexOf(token, idx + token.length)
  }
  return count
}

/** Removes a partially streamed marker token dangling at the end of the text. */
function stripTrailingPartialMarker(text: string): string {
  for (const token of [ADDED_OPEN, ADDED_CLOSE]) {
    for (let len = token.length - 1; len >= 2; len--) {
      if (text.endsWith(token.slice(0, len))) {
        return text.slice(0, text.length - len)
      }
    }
  }
  return text
}

function convertBrOutsideTables(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.trimStart().startsWith('|') ? line : line.replace(/<br\s*\/?>/gi, '  \n')))
    .join('\n')
}

/**
 * Single shared preprocessing step for enhanced-article markdown:
 * <br> → real line breaks (outside tables) and [+ADDED]…[/ADDED] → inline
 * <mark> highlights. An unclosed opening marker (mid-stream) is closed at the
 * end so highlighting appears progressively. Raw marker tokens never reach
 * the renderer.
 */
export function preprocessArticleContent(content: string): string {
  let text = stripTrailingPartialMarker(convertBrOutsideTables(content))
  const opens = countOccurrences(text, ADDED_OPEN)
  const closes = countOccurrences(text, ADDED_CLOSE)
  text = text.split(ADDED_OPEN).join('<mark>').split(ADDED_CLOSE).join('</mark>')
  if (opens > closes) text += '</mark>'
  return text
}

/** Removes ADDED markers entirely — used for clipboard copy and word counts. */
export function stripArticleMarkers(content: string): string {
  return stripTrailingPartialMarker(content).split(ADDED_OPEN).join('').split(ADDED_CLOSE).join('')
}
