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
// their data — regardless of which envelope or shape it arrives in.
const CITATION_CATEGORY = 'Citation Opportunity'
const FAQ_CATEGORY = 'FAQ Suggestion'

type RecSectionKey = 'citation' | 'faq' | 'main'

/**
 * Classifies a keyless array of items by inspecting the field names of its
 * entries: claim/source-shaped items are citation opportunities,
 * question/answer-shaped items are FAQ suggestions, and
 * recommendation/priority/rationale-shaped items are main recommendations.
 * Returns null when nothing in the array is recognizably shaped.
 */
function classifyRecArray(arr: unknown[]): RecSectionKey | null {
  let citation = 0
  let faq = 0
  let main = 0
  for (const item of arr) {
    if (!isRecord(item)) continue
    const keys = Object.keys(item).map((key) => key.toLowerCase())
    if (keys.some((key) => key.includes('claim') || key.includes('source') || key.includes('citation'))) {
      citation++
    } else if (keys.some((key) => key.includes('question') || key.includes('answer') || key.includes('faq'))) {
      faq++
    } else if (
      keys.some(
        (key) =>
          key.includes('recommendation') ||
          key === 'rationale' ||
          key === 'priority' ||
          key === 'placement',
      )
    ) {
      main++
    }
  }
  if (citation === 0 && faq === 0 && main === 0) return null
  if (citation >= faq && citation >= main) return 'citation'
  if (faq >= main) return 'faq'
  return 'main'
}

/**
 * Ensures every item carries a category the Recommendations tab can partition
 * on. Items without an explicit category are routed by their structured
 * fields: claim/source data → Citation Opportunity, question/answer data →
 * FAQ Suggestion. Everything else stays in the main Recommendations section.
 * This guarantees citation/FAQ-shaped items never render as "0 — No data"
 * just because a payload flattened all three lists together.
 */
function withDerivedCategory(item: RecommendationItem): RecommendationItem {
  const cat = (item.category ?? '').trim()
  if (cat) return item
  if (item.claim || item.sourceName || item.sourceUrl) return { ...item, category: CITATION_CATEGORY }
  if (item.question || item.answer || item.whyItMatters) return { ...item, category: FAQ_CATEGORY }
  return item
}

export function normalizeRecommendations(raw: unknown): RecommendationsData {
  try {
    const parsed = parseMaybe(raw)

    // 1) Tolerant keyed lookups for each of the three structured sections
    //    (exact, dotted "recommendations.citation_opportunities", one nested
    //    level — all handled by lookup()).
    let citations = lookup(parsed, ['citation_opportunities', 'citationopportunities', 'citation_opportunity', 'citations'])
    let faqs = lookup(parsed, ['faq_suggestions', 'faqsuggestions', 'faq_suggestion', 'faqs'])
    let recs = lookup(parsed, ['recommendations', 'recommendation'])

    // 2) The block often nests ALL THREE sections under its own
    //    "recommendations" envelope — unwrap it so citation_opportunities and
    //    faq_suggestions are never lost behind the outer key.
    if (isRecord(recs)) {
      const inner: Record<string, unknown> = recs
      const innerCitations = lookup(inner, ['citation_opportunities', 'citationopportunities', 'citations'])
      const innerFaqs = lookup(inner, ['faq_suggestions', 'faqsuggestions', 'faqs'])
      const innerRecs = lookup(inner, ['recommendations', 'items', 'list'])
      if (citations === undefined && innerCitations !== undefined) citations = innerCitations
      if (faqs === undefined && innerFaqs !== undefined) faqs = innerFaqs
      if (innerRecs !== undefined) recs = innerRecs
    }

    // 3) Bare-array payloads: the whole payload is the main list; per-item
    //    category derivation below still routes citation/FAQ-shaped entries
    //    into their sections.
    if (citations === undefined && faqs === undefined && recs === undefined && Array.isArray(parsed)) {
      recs = parsed
    }

    // 4) Keyless / raw-text salvage: some stream runs emit the block output as
    //    a plain SEQUENCE of JSON values with no wrapping keys. Scan every
    //    balanced JSON value in the raw text, honor keyed objects, classify
    //    unkeyed arrays by their item shapes, then fall back to the upstream
    //    output order (citation_opportunities, faq_suggestions,
    //    recommendations) for anything still unclassified — so no section
    //    silently stays at "0 — No data" when its data streamed in.
    if (typeof raw === 'string' && (citations === undefined || faqs === undefined || recs === undefined)) {
      const values = extractAllBalancedJson(raw)
      const unkeyedArrays: unknown[][] = []
      for (const value of values) {
        if (isRecord(value)) {
          if (citations === undefined) {
            const found = lookup(value, ['citation_opportunities', 'citationopportunities', 'citations'])
            if (found !== undefined) citations = found
          }
          if (faqs === undefined) {
            const found = lookup(value, ['faq_suggestions', 'faqsuggestions', 'faqs'])
            if (found !== undefined) faqs = found
          }
          if (recs === undefined) {
            const found = lookup(value, ['recommendations'])
            if (found !== undefined) recs = found
          }
          continue
        }
        if (Array.isArray(value)) unkeyedArrays.push(value)
      }
      const unclassified: unknown[][] = []
      for (const arr of unkeyedArrays) {
        const section = classifyRecArray(arr)
        if (section === 'citation' && citations === undefined) citations = arr
        else if (section === 'faq' && faqs === undefined) faqs = arr
        else if (section === 'main' && recs === undefined) recs = arr
        else unclassified.push(arr)
      }
      if (unclassified.length === 1 && recs === undefined) {
        recs = unclassified[0]
      } else {
        for (const arr of unclassified) {
          if (citations === undefined) citations = arr
          else if (faqs === undefined) faqs = arr
          else if (recs === undefined) recs = arr
        }
      }
    }

    // 5) Build the combined list with the section categories the card
    //    partitions on, deriving categories for uncategorized items from
    //    their structured fields.
    const items: RecommendationItem[] = [
      ...toRecommendationItems(citations, CITATION_CATEGORY),
      ...toRecommendationItems(faqs, FAQ_CATEGORY),
      ...toRecommendationItems(recs, null),
    ].map(withDerivedCategory)

    const catOf = (item: RecommendationItem): string => (item.category ?? '').toLowerCase()
    const citationItems = items.filter((item) => catOf(item).includes('citation'))
    const faqItems = items.filter((item) => catOf(item).includes('faq'))
    const mainItems = items.filter(
      (item) => !catOf(item).includes('citation') && !catOf(item).includes('faq'),
    )
    // Stable priority ordering (high → medium → low → unranked) for the main
    // recommendations only; citation / FAQ items keep upstream order.
    const rankOf = (item: RecommendationItem): number => {
      const p = (item.priority ?? '').toLowerCase()
      return p in PRIORITY_RANK ? PRIORITY_RANK[p] : 3
    }
    const sortedMain = [...mainItems].sort((a, b) => rankOf(a) - rankOf(b))

    return { recommendations: [...citationItems, ...faqItems, ...sortedMain] }
  } catch {
    return { recommendations: [] }
  }
}

function toBooleanValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase()
    if (v === 'true' || v === 'yes' || v === 'pass' || v === 'passed' || v === 'y') return true
    if (v === 'false' || v === 'no' || v === 'fail' || v === 'failed' || v === 'n') return false
  }
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
  }
  return null
}

function toScoreValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const num = Number(value.trim())
    if (Number.isFinite(num)) return num
  }
  return null
}

function toCriteriaItems(value: unknown): CriteriaItem[] {
  let list = value
  if (typeof list === 'string') {
    const parsed = extractBalancedJson(list)
    list = parsed === null ? splitToLines(list) : parsed
  }
  let arr: unknown[]
  if (Array.isArray(list)) {
    arr = list
  } else if (isRecord(list)) {
    arr = Object.entries(list).map(([name, entry]) =>
      isRecord(entry) ? { name, ...entry } : { name, passed: entry },
    )
  } else {
    arr = []
  }
  const items: CriteriaItem[] = []
  for (const entry of arr) {
    if (typeof entry === 'string') {
      const name = decodeUnicodeEscapes(entry.trim())
      if (name) items.push({ name, passed: null, score: null, notes: null })
      continue
    }
    if (!isRecord(entry)) continue
    const name = firstString(entry, ['name', 'criterion', 'criteria', 'title', 'label', 'check'])
    const passed = toBooleanValue(pick(entry, ['passed', 'pass', 'met', 'satisfied', 'ok']))
    const score = toScoreValue(pick(entry, ['score', 'value', 'rating', 'points']))
    const notes = firstString(entry, ['notes', 'note', 'justification', 'reason', 'explanation', 'detail', 'details', 'comment', 'comments'])
    if (!name && !notes && passed === null && score === null) continue
    items.push({
      name: decodeUnicodeEscapes(name || 'Criterion'),
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
    const overall = toScoreValue(lookup(parsed, ['overall_score', 'overallscore', 'score']))
    const passed = toBooleanValue(lookup(parsed, ['passed', 'pass']))
    const summaryRaw = lookup(parsed, ['summary', 'overview'])
    const summary =
      typeof summaryRaw === 'string' && summaryRaw.trim() ? decodeUnicodeEscapes(summaryRaw.trim()) : null
    const criteria = toCriteriaItems(lookup(parsed, ['criteria', 'checks', 'criteria_results', 'criteria_list']))
    return { overall_score: overall, passed, summary, criteria }
  } catch {
    return { overall_score: null, passed: null, summary: null, criteria: [] }
  }
}

/**
 * Shared display preprocessing for enhanced-article markdown:
 *  - <br> tags OUTSIDE table rows become real markdown line breaks (inside
 *    table rows they are preserved so rehype-raw renders in-cell breaks)
 *  - [+ADDED]…[/ADDED] markers become inline <mark> highlights — progressive
 *    while streaming (an opened-but-unclosed marker still highlights), and a
 *    partially received trailing marker token is hidden until complete.
 * The raw marker tokens never reach the renderer.
 */
export function preprocessArticleContent(content: string): string {
  if (!content) return content
  const lines = content
    .split('\n')
    .map((line) => (line.includes('|') ? line : line.replace(/<br\s*\/?>/gi, '  \n')))
  let text = lines.join('\n')
  // Hide a partially streamed marker token at the very end of the text
  // (e.g. "[+ADD") so it never flashes as literal bracket characters.
  text = text.replace(/\[(?:\+|\/)?A?D?D?E?D?$/, '')
  text = text.replace(/\[\+ADDED\]/g, '<mark>').replace(/\[\/ADDED\]/g, '</mark>')
  const opens = (text.match(/<mark>/g) ?? []).length
  const closes = (text.match(/<\/mark>/g) ?? []).length
  for (let i = closes; i < opens; i++) text += '</mark>'
  return text
}

/**
 * Removes [+ADDED]…[/ADDED] marker tokens from article text and converts <br>
 * tags to plain line breaks — used for the clipboard copy and word counts so
 * raw tokens never leak outside the renderer.
 */
export function stripArticleMarkers(content: string): string {
  return content
    .replace(/\[\+ADDED\]/g, '')
    .replace(/\[\/ADDED\]/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
}
