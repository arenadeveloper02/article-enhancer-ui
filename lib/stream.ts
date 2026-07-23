import type { SelectedOutputKey, StageId } from '@/lib/types'

const STATUS_TYPE_VALUES = new Set(['status', 'progress', 'heartbeat', 'ping', 'keepalive', 'keep-alive', 'info'])

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

export const STAGE_ORDER: StageId[] = [
  'gapanalysis',
  'recommendations',
  'enhancedarticlewriter',
  'coverageverifier',
]

export const SELECTED_OUTPUT_KEYS: SelectedOutputKey[] = [
  'recommendations.recommendations',
  'enhancedarticlewriter.content',
  'coverageverifier.criteria',
  'gapanalysis.competitor_strengths',
  'gapanalysis.coverage_gaps',
  'gapanalysis.underdeveloped_sections',
  'coverageverifier.overall_score',
  'coverageverifier.passed',
  'coverageverifier.summary',
]

/**
 * Decodes literal unicode escape sequences (e.g. \u2013) into real characters.
 * Handles both single-escaped and double-escaped payloads so raw sequences
 * never leak into rendered content.
 */
export function decodeUnicodeEscapes(input: string): string {
  let result = input.replace(/\\\\u([0-9a-fA-F]{4})/g, '\\u$1')
  result = result.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  )
  return result
}

/**
 * Returns true when a short line of text looks like a heartbeat / progress
 * message (e.g. "This usually takes 1-2 minutes · 15s elapsed") rather than
 * real answer content.
 */
export function isHeartbeatMessage(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (trimmed.length > 220) return false
  return HEARTBEAT_PATTERNS.some((pattern) => pattern.test(trimmed))
}

/**
 * Walks a parsed JSON value looking for the first string content in common
 * token/answer fields used by streaming APIs.
 */
export function extractToken(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value === null || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractToken(item)
      if (found !== null) return found
    }
    return null
  }
  const obj = value as Record<string, unknown>
  const keys = [
    'chunk',
    'delta',
    'content',
    'text',
    'token',
    'output',
    'answer',
    'response',
    'message',
    'result',
    'data',
  ]
  for (const key of keys) {
    if (key in obj) {
      const found = extractToken(obj[key])
      if (found !== null) return found
    }
  }
  return null
}

/**
 * If a parsed JSON chunk is explicitly typed as a status/heartbeat event,
 * returns its human-readable message; otherwise returns null.
 */
export function extractStatusMessage(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const obj = value as Record<string, unknown>
  const candidates = [obj.type, obj.event, obj.kind]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && STATUS_TYPE_VALUES.has(candidate.toLowerCase())) {
      const message = extractToken(obj)
      return message ?? 'Working on it…'
    }
  }
  return null
}

/**
 * Tries to attribute a streamed event to one of the four pipeline stages by
 * inspecting common block-identifier fields.
 */
export function identifyStage(value: unknown): StageId | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const obj = value as Record<string, unknown>
  const fields = ['blockName', 'blockId', 'block', 'name', 'nodeName', 'nodeId', 'id', 'source', 'blockType']
  for (const field of fields) {
    const raw = obj[field]
    if (typeof raw !== 'string') continue
    const normalized = raw.toLowerCase().replace(/[^a-z]/g, '')
    if (normalized.includes('gapanalysis') || normalized.includes('gap')) return 'gapanalysis'
    if (normalized.includes('recommend')) return 'recommendations'
    if (normalized.includes('enhancedarticle') || normalized.includes('writer')) return 'enhancedarticlewriter'
    if (normalized.includes('coverage') || normalized.includes('verif')) return 'coverageverifier'
  }
  return null
}

/**
 * Walks a parsed JSON value and collects any of the nine selected pipeline
 * outputs, whether they arrive as dotted keys ("gapanalysis.coverage_gaps")
 * or nested objects ({ gapanalysis: { coverage_gaps: [...] } }).
 */
export function collectSelectedOutputs(value: unknown): Partial<Record<SelectedOutputKey, unknown>> {
  const results: Partial<Record<SelectedOutputKey, unknown>> = {}
  const keySet = new Set<string>(SELECTED_OUTPUT_KEYS)
  const stageNames = new Set<string>(STAGE_ORDER)

  const visit = (node: unknown, depth: number): void => {
    if (depth > 8 || node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1)
      return
    }
    const obj = node as Record<string, unknown>
    for (const [rawKey, rawValue] of Object.entries(obj)) {
      const key = rawKey.toLowerCase()
      if (keySet.has(key)) {
        results[key as SelectedOutputKey] = rawValue
        continue
      }
      if (
        stageNames.has(key) &&
        rawValue !== null &&
        typeof rawValue === 'object' &&
        !Array.isArray(rawValue)
      ) {
        for (const [innerKey, innerValue] of Object.entries(rawValue as Record<string, unknown>)) {
          const dotted = `${key}.${innerKey.toLowerCase()}`
          if (keySet.has(dotted)) results[dotted as SelectedOutputKey] = innerValue
        }
      }
      visit(rawValue, depth + 1)
    }
  }

  visit(value, 0)
  return results
}

function itemToString(item: unknown): string {
  if (typeof item === 'string') return decodeUnicodeEscapes(item.trim())
  if (typeof item === 'number' || typeof item === 'boolean') return String(item)
  if (item === null || item === undefined) return ''
  if (typeof item === 'object' && !Array.isArray(item)) {
    const obj = item as Record<string, unknown>
    const preferred = [
      'title',
      'name',
      'criterion',
      'recommendation',
      'text',
      'description',
      'summary',
      'item',
      'label',
      'content',
    ]
    const parts: string[] = []
    for (const key of preferred) {
      const candidate = obj[key]
      if (typeof candidate === 'string' && candidate.trim()) parts.push(decodeUnicodeEscapes(candidate.trim()))
      if (parts.length === 2) break
    }
    if (parts.length > 0) {
      const met = obj.met ?? obj.passed ?? obj.satisfied
      const suffix = typeof met === 'boolean' ? (met ? ' ✓' : ' ✗') : ''
      return parts.join(' — ') + suffix
    }
    return decodeUnicodeEscapes(JSON.stringify(item))
  }
  return decodeUnicodeEscapes(String(item))
}

/**
 * Normalizes any streamed value (array, JSON string, newline-separated text,
 * or object map) into a clean, decoded list of display strings.
 */
export function toStringList(value: unknown): string[] {
  if (value === null || value === undefined) return []
  if (Array.isArray(value)) return value.map(itemToString).filter((s) => s.length > 0)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    if (trimmed.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(trimmed)
        if (Array.isArray(parsed)) return parsed.map(itemToString).filter((s) => s.length > 0)
      } catch {
        // Fall through to newline splitting.
      }
    }
    return trimmed
      .split('\n')
      .map((line) => decodeUnicodeEscapes(line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()))
      .filter((line) => line.length > 0)
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map(itemToString)
      .filter((s) => s.length > 0)
  }
  return [itemToString(value)]
}

export function toScore(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(/[^\d.-]/g, ''))
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

export function toPassed(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase()
    if (['true', 'yes', 'pass', 'passed'].includes(lower)) return true
    if (['false', 'no', 'fail', 'failed'].includes(lower)) return false
  }
  return null
}

export function toText(value: unknown): string {
  if (typeof value === 'string') return decodeUnicodeEscapes(value)
  if (value === null || value === undefined) return ''
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return decodeUnicodeEscapes(JSON.stringify(value))
}
