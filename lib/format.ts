/**
 * Presentation-only markdown formatting for enhanced-article output.
 *
 * These transforms change ONLY how content is rendered, never which content
 * is included:
 *  - Raw JSON never reaches the UI: fenced ```json blocks and bare
 *    paragraph-level JSON object/array dumps are stripped before rendering.
 *  - Em dashes and en dashes used as clause separators are replaced with
 *    commas (or "to" for numeric ranges). Hyphens in compound words are
 *    untouched because only the unicode dash characters are matched.
 *
 * All transforms are conservative and streaming-safe: a JSON block is only
 * removed once it is structurally complete and actually parses, so partial
 * chunks are never mangled mid-stream, and legitimate prose, lists, and
 * markdown tables pass through byte-for-byte.
 */

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
  result = stripBareJsonBlocks(result)
  result = normalizeDashes(result)
  return result
}
