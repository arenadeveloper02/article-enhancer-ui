/**
 * Presentation-only markdown formatting for enhanced-article output.
 *
 * These transforms change ONLY how content is rendered, never which content
 * is included:
 *  - Raw JSON never reaches the UI: fenced ```json blocks, bare
 *    paragraph-level JSON object/array dumps, AND trailing structured data
 *    dumps (coverage-verifier arrays, citation lists, bare booleans/scores
 *    appended after the article) are stripped before rendering.
 *  - Unicode escape sequences (\uXXXX) and literal \n sequences that leak
 *    through the stream are decoded to real characters so escape codes are
 *    never shown as visible text.
 *  - Markdown tables are normalized so every row has the same number of
 *    columns as the header row: missing cells are left blank, overflowing
 *    cells are merged into the last column with <br> — content is never
 *    dropped, summarized, or reordered.
 *  - Em dashes and en dashes used as clause separators are replaced with
 *    commas (or "to" for numeric ranges). Hyphens in compound words are
 *    untouched because only the unicode dash characters are matched.
 *
 * All transforms are conservative and streaming-safe: a JSON block is only
 * removed once it is structurally complete and actually parses (the trailing
 * dump detector matches unambiguous machine-payload signatures only), so
 * partial chunks are never mangled mid-stream, and legitimate prose, lists,
 * and markdown tables pass through byte-for-byte.
 */

import { decodeUnicodeEscapes } from '@/lib/normalize'

function isJsonParseable(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

/**
 * Removes fenced code blocks whose body is raw JSON. Explicit ```json fences
 * are always dropped; anonymous ``` fences are dropped only when their body
 * parses as a JSON object/array. Non-JSON code blocks are preserved exactly.
 */
export function stripJsonCodeBlocks(markdown: string): string {
  return markdown.replace(/```([\w-]*)[ \t]*\n([\s\S]*?)```/g, (match, lang: string, body: string) => {
    const language = lang.trim().toLowerCase()
    if (language === 'json') return ''
    if (!language && isJsonParseable(body)) return ''
    return match
  })
}

/**
 * Removes paragraph-level raw JSON dumps: a contiguous run of non-blank
 * lines that starts with `{` or `[` and parses as JSON in its entirety.
 * Inline JSON snippets inside prose sentences are never touched because the
 * whole paragraph must parse for removal.
 */
export function stripBareJsonBlocks(markdown: string): string {
  if (!markdown.includes('{') && !markdown.includes('[')) return markdown
  const lines = markdown.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const trimmed = lines[i].trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      let j = i
      const buf: string[] = []
      while (j < lines.length && lines[j].trim() !== '') {
        buf.push(lines[j])
        j++
      }
      if (isJsonParseable(buf.join('\n'))) {
        // Entire paragraph is a raw JSON dump: drop it from the UI.
        i = j
        continue
      }
    }
    out.push(lines[i])
    i++
  }
  return out.join('\n')
}

/**
 * Signature of a trailing machine-payload dump appended after the article:
 * an optional bare count (e.g. "6 ") followed by a JSON array of objects
 * ([{") or strings (["), or an object literal with a quoted key ({"key":).
 * These patterns do not occur in legitimate markdown prose (markdown links
 * start with `[` followed by text, never `[{"` or `["`), so matching them is
 * safe. Everything from the FIRST such signature to the end of the content
 * is dropped — coverage-verifier outputs (citations_found, criteria,
 * faq_questions_added, overall_score, passed, summary) stream AFTER the
 * article body, so the dump is always a trailing region.
 */
const DUMP_TAIL_START = /(?:^|[\n\t ])(?:\d+[ \t]+)?(?:\[[ \t]*[{"]|\{[ \t]*"[\w-]+"[ \t]*:)/

/**
 * Truncates the article at the first trailing structured-data dump. Fenced
 * code blocks are skipped when searching so legitimate code samples that
 * happen to contain JSON-like text are never cut.
 */
export function stripTrailingStructuredDump(markdown: string): string {
  const parts = markdown.split(/(```[\s\S]*?```)/)
  let offset = 0
  for (const part of parts) {
    if (!part.startsWith('```')) {
      const match = DUMP_TAIL_START.exec(part)
      if (match) {
        return markdown.slice(0, offset + match.index).replace(/\s+$/, '')
      }
    }
    offset += part.length
  }
  return markdown
}

/**
 * Removes lines that consist ONLY of a bare boolean or bare number — these
 * are stray scalar outputs (scores, pass/fail flags, counts) leaked from the
 * stream, never legitimate article prose.
 */
function stripScalarNoiseLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^(?:true|false|-?\d+(?:\.\d+)?)$/.test(line.trim()))
    .join('\n')
}

/**
 * Decodes escape sequences that must never be shown as visible text:
 * \uXXXX unicode escapes become their real character, and literal \n
 * sequences become real line breaks.
 */
function decodeVisibleEscapes(text: string): string {
  return decodeUnicodeEscapes(text).replace(/\\n/g, '\n')
}

/** Applies a text transform to prose only, leaving fenced code blocks intact. */
function applyOutsideCodeFences(markdown: string, transform: (segment: string) => string): string {
  return markdown
    .split(/(```[\s\S]*?```)/)
    .map((part) => (part.startsWith('```') ? part : transform(part)))
    .join('')
}

// ── Markdown table normalization ──────────────────────────────────────────

function isTableRowLine(line: string): boolean {
  const t = line.trim()
  return t.startsWith('|') && t.indexOf('|', 1) !== -1
}

function isSeparatorLine(line: string): boolean {
  const t = line.trim()
  if (!t.startsWith('|')) return false
  const inner = t.slice(1, t.endsWith('|') ? t.length - 1 : t.length)
  const cells = inner.split('|')
  if (cells.length === 0) return false
  return cells.every((cell) => /^\s*:?-+:?\s*$/.test(cell))
}

/** Splits a markdown table row into cells, honoring escaped pipes (\|). */
function splitCells(line: string): string[] {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|')) t = t.slice(0, -1)
  const cells: string[] = []
  let current = ''
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (ch === '\\' && i + 1 < t.length && t[i + 1] === '|') {
      current += '\\|'
      i++
      continue
    }
    if (ch === '|') {
      cells.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  cells.push(current.trim())
  return cells
}

/**
 * Rebuilds one table block so every row has exactly as many cells as the
 * header row. Rows with too FEW cells are padded with blank cells (columns
 * never shift); rows with too MANY cells have the overflow merged into the
 * last cell joined with <br> (content never breaks out into extra rows).
 * Rows and columns are never merged across each other, reordered, dropped,
 * or shortened.
 */
function fixTableBlock(block: string[]): string[] {
  const header = splitCells(block[0])
  const n = header.length
  if (n === 0) return block
  const out: string[] = [`| ${header.join(' | ')} |`]
  const sepCells = splitCells(block[1]).filter((cell) => cell.length > 0)
  if (sepCells.length === n) {
    out.push(`| ${sepCells.join(' | ')} |`)
  } else {
    out.push(`| ${Array.from({ length: n }, () => '---').join(' | ')} |`)
  }
  for (let r = 2; r < block.length; r++) {
    let cells = splitCells(block[r])
    if (cells.length > n) {
      const merged = cells.slice(n - 1).filter((cell) => cell.length > 0).join('<br>')
      cells = [...cells.slice(0, n - 1), merged]
    }
    while (cells.length < n) cells.push('')
    out.push(`| ${cells.join(' | ')} |`)
  }
  return out
}

/**
 * Normalizes every markdown table (header row + separator row + body rows)
 * so all rows carry the same column count as the header. Streaming-safe: a
 * partially streamed final row is simply padded and re-padded as chunks
 * arrive. Tables inside fenced code blocks are left untouched.
 */
export function normalizeMarkdownTables(markdown: string): string {
  return applyOutsideCodeFences(markdown, (segment) => {
    const lines = segment.split('\n')
    const out: string[] = []
    let i = 0
    while (i < lines.length) {
      if (i + 1 < lines.length && isTableRowLine(lines[i]) && isSeparatorLine(lines[i + 1])) {
        const block: string[] = [lines[i], lines[i + 1]]
        let j = i + 2
        while (j < lines.length && isTableRowLine(lines[j])) {
          block.push(lines[j])
          j++
        }
        out.push(...fixTableBlock(block))
        i = j
        continue
      }
      out.push(lines[i])
      i++
    }
    return out.join('\n')
  })
}

/**
 * Replaces em/en dashes used as clause separators with commas, and numeric
 * en/em dash ranges with "to". ASCII hyphens (compound words, markdown table
 * separator rows, horizontal rules) are never matched.
 */
export function normalizeDashes(text: string): string {
  let result = text
  // Numeric ranges first (10–20, 2019—2024) become "10 to 20".
  result = result.replace(/(\d)\s*[\u2013\u2014]\s*(\d)/g, '$1 to $2')
  // Spaced em/en dashes acting as clause separators.
  result = result.replace(/\s+[\u2013\u2014]\s+/g, ', ')
  // Em dash glued directly between words or closing/opening punctuation.
  result = result.replace(/([A-Za-z)\]"\u201D'\u2019])\u2014([A-Za-z(["\u201C'\u2018])/g, '$1, $2')
  // En dash glued between letters also reads as a clause separator.
  result = result.replace(/([A-Za-z])\u2013([A-Za-z])/g, '$1, $2')
  return result
}

/**
 * Full presentation cleanup applied to enhanced-article markdown right
 * before rendering (and before copying to the clipboard, so copied text
 * matches what the user sees).
 */
export function formatEnhancedMarkdown(markdown: string): string {
  if (!markdown) return markdown
  let result = stripJsonCodeBlocks(markdown)
  result = stripTrailingStructuredDump(result)
  result = stripBareJsonBlocks(result)
  result = applyOutsideCodeFences(result, (segment) => stripScalarNoiseLines(decodeVisibleEscapes(segment)))
  result = normalizeMarkdownTables(result)
  result = normalizeDashes(result)
  return result
}
