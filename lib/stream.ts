import type { PanelKey, StageId } from '@/lib/types'

export type BlockTarget = PanelKey | 'status-theme' | 'status-research'

export const STAGE_ORDER: StageId[] = [
  'gapanalysis',
  'recommendations',
  'enhancedarticlewriter',
  'coverageverifier',
]

// blockId prefix → panel/status routing map (match by startsWith so full UUIDs map).
const BLOCK_PREFIXES: Array<{ prefix: string; target: BlockTarget }> = [
  { prefix: '65f7256c', target: 'status-theme' },
  { prefix: '648b01f8', target: 'status-research' },
  { prefix: '0f239b6f', target: 'gapanalysis' },
  { prefix: '5ae6657d', target: 'recommendations' },
  { prefix: '88db1a98', target: 'article' },
  { prefix: 'c4bd5114', target: 'coverage' },
]

export function resolveBlockTarget(blockId: string): BlockTarget | null {
  const normalized = blockId.trim().toLowerCase()
  if (!normalized) return null
  for (const entry of BLOCK_PREFIXES) {
    if (normalized.startsWith(entry.prefix)) return entry.target
  }
  // Fallback: some stream payloads identify blocks by NAME or dotted output
  // key (e.g. "gapanalysis.coverage_gaps", "coverageverifier.criteria")
  // instead of the hardcoded UUID prefixes above. Route those semantically so
  // the Gap Analysis and Coverage Verification panels never stay empty when
  // upstream blockIds change. Order matters: gap analysis keys can contain
  // the word "coverage" (coverage_gaps), so it is checked first.
  const compact = normalized.replace(/[\s_-]/g, '')
  if (compact.includes('gapanalysis') || compact.includes('gap')) return 'gapanalysis'
  if (compact.includes('recommendation')) return 'recommendations'
  if (compact.includes('coverage') || compact.includes('verifier')) return 'coverage'
  if (compact.includes('article') || compact.includes('writer')) return 'article'
  return null
}

export function statusLabelFor(target: BlockTarget): string {
  if (target === 'status-theme') return 'Extracting article themes…'
  if (target === 'status-research') return 'Researching competitor coverage…'
  return 'Working on it…'
}

/**
 * Fallback classification for unknown blockIds: JSON-ish blobs route by
 * detected keys; long-form prose is treated as the enhanced article.
 */
export function classifyUnknownPayload(accumulated: string): PanelKey | null {
  const text = accumulated.trim()
  if (!text) return null
  const lower = text.toLowerCase()
  if (
    lower.includes('competitor_strengths') ||
    lower.includes('coverage_gaps') ||
    lower.includes('underdeveloped_sections') ||
    lower.includes('gapanalysis')
  ) {
    return 'gapanalysis'
  }
  if (lower.includes('"recommendations"') || lower.includes('recommendations":')) {
    return 'recommendations'
  }
  if (
    lower.includes('overall_score') ||
    lower.includes('coverageverifier') ||
    (lower.includes('criteria') && lower.includes('passed'))
  ) {
    return 'coverage'
  }
  const jsonish = text.startsWith('{') || text.startsWith('[')
  if (!jsonish && text.length > 160) return 'article'
  return null
}

const HEARTBEAT_PATTERNS: RegExp[] = [
  /usually takes/i,
  /\belapsed\b/i,
  /still (working|processing|running|thinking)/i,
  /\bheartbeat\b/i,
  /please wait/i,
  /working on (it|your)/i,
  /^processing\b/i,
  /hang tight/i,
]

/**
 * Returns true when a short line of text looks like a heartbeat / progress
 * message rather than real answer content.
 */
export function isHeartbeatMessage(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (trimmed.length > 220) return false
  return HEARTBEAT_PATTERNS.some((pattern) => pattern.test(trimmed))
}
