import type { StageId, StageStatus } from '@/lib/types'

export interface ChecklistStage {
  id: StageId
  label: string
  status: StageStatus
}

interface ProgressChecklistProps {
  stages: ChecklistStage[]
}

export function ProgressChecklist({ stages }: ProgressChecklistProps) {
  return (
    <section
      aria-label="Enhancement progress"
      className="card-enter rounded-2xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"
    >
      <h2 className="mb-4 font-display text-xs font-semibold uppercase tracking-wider text-ink-soft">
        Pipeline progress
      </h2>
      <ol className="space-y-3">
        {stages.map((stage) => (
          <li key={stage.id} className="flex items-center gap-3">
            {stage.status === 'done' ? (
              <span
                aria-hidden="true"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"
              >
                <svg
                  viewBox="0 0 16 16"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 8.5l3.2 3L13 4.5" />
                </svg>
              </span>
            ) : stage.status === 'active' ? (
              <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-200 border-t-accent motion-reduce:animate-none" />
              </span>
            ) : (
              <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center">
                <span className="h-2.5 w-2.5 rounded-full border-2 border-slate-300" />
              </span>
            )}
            <span
              className={
                stage.status === 'active'
                  ? 'animate-pulse text-sm font-semibold text-ink motion-reduce:animate-none'
                  : stage.status === 'done'
                    ? 'text-sm font-medium text-ink'
                    : 'text-sm text-slate-400'
              }
            >
              {stage.label}
            </span>
            {stage.status === 'active' && <span className="sr-only">in progress</span>}
            {stage.status === 'done' && <span className="sr-only">complete</span>}
          </li>
        ))}
      </ol>
    </section>
  )
}
