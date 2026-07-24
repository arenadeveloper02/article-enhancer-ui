/**
 * Heuristic boilerplate filter for enhanced-article markdown.
 *
 * Nav/footer/location menus scraped alongside real article content typically
 * surface as long bullet/numbered lists where nearly every item is a short,
 * link-only entry (e.g. "- [Home](/)", "- [Contact](/contact)"). This module
 * detects that exact pattern — more than ~6 consecutive list items where the
 * majority are link-only entries with fewer than 4 words of label text — and
 * strips those blocks from the rendered article.
 *
 * It is intentionally conservative: legitimate short lists (a real 3–5 item
 * bullet list, lists with prose around the links, or single inline links in
 * paragraphs) are never touched.
 */

const LIST_ITEM_RE = /^\s*(?:[-*+\u2022]|\d+[.)])\s+(.+)$/

interface LinkItemInfo {
  linkOnly: boolean
  wordCount: number
}

function inspectListItem(text: string): LinkItemInfo {
  // ADDED-highlight markers are converted to <mark> tags before this filter
  // runs — ignore them when deciding whether an item is link-only.
  const stripped = text.replace(/<\/?mark>/gi, '').trim()
  const match = stripped.match(/^\[([^\]]*)\]\([^)]*\)[.,;:!?]?$/)
  if (!match) {
    return { linkOnly: false, wordCount: stripped.split(/\s+/).filter(Boolean).length }
  }
  const label = match[1].trim()
  return { linkOnly: true, wordCount: label ? label.split(/\s+/).filter(Boolean).length : 0 }
}

/**
 * Removes list blocks that look like scraped navigation/footer boilerplate
 * from article markdown. Returns the markdown unchanged when no such block
 * is found.
 */
export function stripBoilerplateListBlocks(markdown: string): string {
  if (!markdown.includes('[')) return markdown
  const lines = markdown.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    if (!LIST_ITEM_RE.test(lines[i])) {
      out.push(lines[i])
      i++
      continue
    }
    // Gather the run of consecutive list-item lines.
    let j = i
    const items: string[] = []
    while (j < lines.length) {
      const m = lines[j].match(LIST_ITEM_RE)
      if (!m) break
      items.push(m[1])
      j++
    }
    let shortLinkOnly = 0
    for (const item of items) {
      const info = inspectListItem(item)
      if (info.linkOnly && info.wordCount < 4) shortLinkOnly++
    }
    // Boilerplate signature: more than ~6 short link-only items making up the
    // majority of the block.
    const isBoilerplate = shortLinkOnly > 6 && shortLinkOnly * 2 > items.length
    if (isBoilerplate) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          `[article-enhancer] Stripped a likely boilerplate/nav list block (${items.length} items, ${shortLinkOnly} short link-only) from the rendered article.`,
        )
      }
      // Skip the block entirely — it is almost certainly nav/footer content.
    } else {
      for (let k = i; k < j; k++) out.push(lines[k])
    }
    i = j
  }
  return out.join('\n')
}
