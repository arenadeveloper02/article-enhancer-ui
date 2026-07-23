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
