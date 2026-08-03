import type { RequestPhase } from '@/lib/types'

interface StatusChipProps {
  message: string
  /** Elapsed run time in seconds. */
  elapsedSeconds?: number
  /** Alternate prop name for elapsed seconds — resolved identically. */
  elapsed?: number
  /** Overall request phase (accepted for caller compatibility; not rendered). */
  phase?: RequestPhase
}

export function StatusChip({ message, elapsedSeconds, elapsed }: StatusChipProps) {
  const seconds = elapsedSeconds ?? elapsed ?? 0
  return (
    <div
      role="status"
      aria-live="polite"
      className="inline-flex max-w-full items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50/80 px-3 py-1.5 text-xs font-medium text-indigo-800"
    >
      <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60 motion-reduce:hidden" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
      </span>
      <span className="truncate">{message}</span>
      <span className="text-indigo-300" aria-hidden="true">
        ·
      </span>
      <span className="shrink-0 tabular-nums">{seconds}s elapsed</span>
    </div>
  )
}
