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

// Categories the Recommendations tab partitions on. normalizeRecommendations
// tags items sourced from citation_opportunities / faq_suggestions with these
// EXACT values so the three sections (Citation Opportunities, FAQ Suggestions,
// Recommendations) are ALWAYS populated whenever the upstream payload carries
// the matching outputs — regardless of how the stream wrapped them.
const CITATION_CATEGORY = 'Citation Opportunity'
const FAQ_CATEGORY = 'FAQ Suggestion'

/**
 * Last-resort text mining: pulls the JSON value for `key` straight out of raw
 * accumulated stream text. Handles structured values ({...} / [...]) and
 * scalar values (strings, numbers, booleans, null). The character right after
 * the key token must be a colon so metadata VALUES that happen to equal the
 * key name (e.g. "blockName":"recommendations") are never mistaken for it.
 * Returns undefined when the key is absent or its value is still incomplete.
 */
function extractKeyFromText(text: string, key: string): unknown {
  const token = `"${key}"`
  let from = 0
  while (from < text.length) {
    const idx = text.indexOf(token, from)
    if (idx === -1) return undefined
    const afterToken = text.slice(idx + token.length)
    const colonMatch = afterToken.match(/^\s*:/)
    if (!colonMatch) {
      from = idx + token.length
      continue
    }
    const rest = afterToken.slice(colonMatch[0].length).replace(/^\s+/, '')
    if (rest.startsWith('{') || rest.startsWith('[')) {
      const structured = extractBalancedJson(rest)
      if (structured !== null) return structured
    } else {
      const scalar = rest.match(/^(?:"((?:[^"\\]|\\.)*)"|(-?\d+(?:\.\d+)?)|(true|false)|null)/)
      if (scalar) {
        if (scalar[1] !== undefined) return decodeUnicodeEscapes(scalar[1].replace(/\\"/g, '"'))
        if (scalar[2] !== undefined) return Number(scalar[2])
        if (scalar[3] !== undefined) return scalar[3] === 'true'
        return null
      }
    }
    from = idx + token.length
  }
  return undefined
}

/**
 * Classifies a keyless JSON array by inspecting its item fields so runs that
 * emit citation_opportunities / faq_suggestions / recommendations as bare
 * arrays (no wrapping keys) still land in the right section.
 */
function classifyRecommendationArray(arr: unknown[]): 'citation' | 'faq' | 'main' {
  for (const item of arr) {
    if (!isRecord(item)) continue
    const keys = Object.keys(item).map((k) => k.toLowerCase())
    if (
      keys.some(
        (k) => k.includes('claim') || k.includes('source_url') || k.includes('source_name') || k === 'source' || k.includes('sourceurl') || k.includes('sourcename'),
      )
    ) {
      return 'citation'
    }
    if (keys.some((k) => k.includes('question') || k.includes('answer') || k.includes('faq'))) {
      return 'faq'
    }
    if (keys.some((k) => k.includes('recommendation') || k.includes('rationale') || k.includes('priority'))) {
      return 'main'
    }
  }
  return 'main'
}

function mergeLists(existing: unknown, extra: unknown[]): unknown[] {
  return Array.isArray(existing) ? [...existing, ...extra] : extra
}

export function normalizeRecommendations(raw: unknown): RecommendationsData {
  try {
    const parsed = parseMaybe(raw)
    let citations = lookup(parsed, ['citation_opportunities', 'citationopportunities', 'citation_opportunity', 'citations'])
    let faqs = lookup(parsed, ['faq_suggestions', 'faqsuggestions', 'faq_suggestion', 'faqs'])
    let recs = lookup(parsed, ['recommendations', 'recommendation_list', 'suggestions', 'items'])

    // A bare array payload IS the main recommendations list.
    if (recs === undefined && Array.isArray(parsed)) recs = parsed

    // Streamed-text salvage: the recommendations block frequently streams as
    // concatenated raw JSON text — {"citation_opportunities":[...]},
    // {"faq_suggestions":[...]}, {"recommendations":[...]}, or bare arrays —
    // so mine the accumulated text directly whenever key-based lookup found
    // nothing. This is what keeps Citation Opportunities and FAQ Suggestions
    // populated during and after a live Enhance run.
    if (typeof raw === 'string') {
      if (citations === undefined) citations = extractKeyFromText(raw, 'citation_opportunities')
      if (faqs === undefined) faqs = extractKeyFromText(raw, 'faq_suggestions')
      if (recs === undefined) recs = extractKeyFromText(raw, 'recommendations')
      if (citations === undefined && faqs === undefined && recs === undefined) {
        const arrays = extractAllBalancedJson(raw).filter((entry): entry is unknown[] => Array.isArray(entry))
        for (const arr of arrays) {
          const kind = classifyRecommendationArray(arr)
          if (kind === 'citation') citations = mergeLists(citations, arr)
          else if (kind === 'faq') faqs = mergeLists(faqs, arr)
          else recs = mergeLists(recs, arr)
        }
      }
    }

    // The "recommendations" value can itself be the envelope object carrying
    // all three arrays — unwrap it.
    if (isRecord(recs)) {
      if (citations === undefined && 'citation_opportunities' in recs) citations = recs['citation_opportunities']
      if (faqs === undefined && 'faq_suggestions' in recs) faqs = recs['faq_suggestions']
      if ('recommendations' in recs) recs = recs['recommendations']
    }

    // Force the exact partition categories the Recommendations tab renders —
    // items sourced from the citation/FAQ outputs must never leak into the
    // main section because of a loose per-item "type" value.
    const citationItems = toRecommendationItems(citations, CITATION_CATEGORY).map((item) => ({
      ...item,
      category: CITATION_CATEGORY,
    }))
    const faqItems = toRecommendationItems(faqs, FAQ_CATEGORY).map((item) => ({
      ...item,
      category: FAQ_CATEGORY,
    }))
    // Per-item signature fallback: citation/FAQ entries embedded inside the
    // main list still land in their sections.
    const mainItems = toRecommendationItems(recs, null).map((item) => {
      if (!item.category) {
        if (item.claim || item.sourceUrl || item.sourceName) return { ...item, category: CITATION_CATEGORY }
        if (item.question || item.answer) return { ...item, category: FAQ_CATEGORY }
      }
      return item
    })
    const rankOf = (item: RecommendationItem): number => {
      const p = (item.priority ?? '').toLowerCase()
      return p in PRIORITY_RANK ? PRIORITY_RANK[p] : 3
    }
    const sortedMain = mainItems
      .map((item, index) => ({ item, index }))
      .sort((a, b) =>
        rankOf(a.item) === rankOf(b.item) ? a.index - b.index : rankOf(a.item) - rankOf(b.item),
      )
      .map((entry) => entry.item)
    return { recommendations: [...citationItems, ...faqItems, ...sortedMain] }
  } catch {
    return { recommendations: [] }
  }
}

function toBoolOrNull(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase()
    if (v === 'true' || v === 'pass' || v === 'passed' || v === 'yes') return true
    if (v === 'false' || v === 'fail' || v === 'failed' || v === 'no') return false
  }
  return null
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number(value.trim())
    if (Number.isFinite(n)) return n
  }
  return null
}

function toCriteriaItems(value: unknown): CriteriaItem[] {
  let list = value
  if (typeof list === 'string') {
    list = extractBalancedJson(list)
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
    const passed = toBoolOrNull(pick(entry, ['passed', 'pass', 'met', 'status', 'result']))
    const score = toNumberOrNull(pick(entry, ['score', 'value', 'points']))
    const notes = firstString(entry, ['notes', 'justification', 'reason', 'explanation', 'detail', 'details', 'comment'])
    items.push({
      name: decodeUnicodeEscapes(name),
      passed,
      score,
      notes: notes ? decodeUnicodeEscapes(notes) : null,
    })
  }
  return items
}

export function normalizeCoverage(raw: unknown): CoverageData {
  try {
    const parsed = parseMaybe(raw)
    let scoreRaw = lookup(parsed, ['overall_score', 'overallscore', 'score'])
    let passedRaw = lookup(parsed, ['passed', 'pass'])
    let summaryRaw = lookup(parsed, ['summary'])
    let criteriaRaw = lookup(parsed, ['criteria', 'checks'])
    if (typeof raw === 'string') {
      if (scoreRaw === undefined) scoreRaw = extractKeyFromText(raw, 'overall_score')
      if (passedRaw === undefined) passedRaw = extractKeyFromText(raw, 'passed')
      if (summaryRaw === undefined) summaryRaw = extractKeyFromText(raw, 'summary')
      if (criteriaRaw === undefined) criteriaRaw = extractKeyFromText(raw, 'criteria')
    }
    const summary =
      typeof summaryRaw === 'string' && summaryRaw.trim()
        ? decodeUnicodeEscapes(summaryRaw.trim())
        : null
    return {
      overall_score: toNumberOrNull(scoreRaw),
      passed: toBoolOrNull(passedRaw),
      summary,
      criteria: toCriteriaItems(criteriaRaw),
    }
  } catch {
    return { overall_score: null, passed: null, summary: null, criteria: [] }
  }
}

// ── Enhanced-article preprocessing ─────────────────────────────────────────

const ADDED_OPEN = '[+ADDED]'
const ADDED_CLOSE = '[/ADDED]'

/**
 * Removes [+ADDED]/[/ADDED] marker tokens entirely — used for the clipboard
 * copy and word counting so the raw tokens never leave the app.
 */
export function stripArticleMarkers(content: string): string {
  return content.split(ADDED_OPEN).join('').split(ADDED_CLOSE).join('')
}

/**
 * Trims a trailing PARTIAL marker token (e.g. "[+AD") that can appear at the
 * very end of a still-streaming chunk so it never renders literally.
 */
function trimPartialMarkerTail(text: string): string {
  for (const token of [ADDED_OPEN, ADDED_CLOSE]) {
    for (let len = token.length - 1; len > 0; len--) {
      if (text.endsWith(token.slice(0, len))) return text.slice(0, text.length - len)
    }
  }
  return text
}

/**
 * Wraps each non-empty line of an ADDED region in <mark>, keeping markdown
 * structural prefixes (headings, list bullets, blockquotes) OUTSIDE the tag
 * so block-level markdown still parses correctly.
 */
function markAddedSegment(segment: string): string {
  return segment
    .split('\n')
    .map((line) => {
      const m = line.match(/^(\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)?)([\s\S]*)$/)
      if (m && m[2].trim()) return `${m[1]}<mark>${m[2]}</mark>`
      return line
    })
    .join('\n')
}

/**
 * Single shared preprocessing step for enhanced-article markdown:
 *  - literal <br> tags become real line breaks
 *  - [+ADDED]…[/ADDED] regions become inline <mark> highlights, including
 *    progressive (not-yet-closed) regions while streaming
 * The raw marker tokens never reach the renderer.
 */
export function preprocessArticleContent(content: string): string {
  const text = trimPartialMarkerTail(content.replace(/<br\s*\/?\s*>/gi, '\n'))
  let out = ''
  let cursor = 0
  while (cursor < text.length) {
    const open = text.indexOf(ADDED_OPEN, cursor)
    if (open === -1) {
      out += text.slice(cursor)
      break
    }
    out += text.slice(cursor, open)
    const close = text.indexOf(ADDED_CLOSE, open + ADDED_OPEN.length)
    if (close === -1) {
      // Progressive: the ADDED region is still streaming — highlight what has
      // arrived so far.
      out += markAddedSegment(text.slice(open + ADDED_OPEN.length))
      cursor = text.length
      break
    }
    out += markAddedSegment(text.slice(open + ADDED_OPEN.length, close))
    cursor = close + ADDED_CLOSE.length
  }
  // Defensive: drop any stray closing markers.
  return out.split(ADDED_CLOSE).join('')
}
