import type { StageItem } from '@/lib/types'

interface StageChecklistProps {
  items: StageItem[]
}

export function StageChecklist({ items }: StageChecklistProps) {
  return (
    <section
      aria-label="Enhancement pipeline progress"
      className="card-enter rounded-2xl border border-slate-200 bg-white p-5 shadow-card sm:p-6"
    >
      <h2 className="mb-4 font-display text-xs font-semibold uppercase tracking-wider text-ink-soft">
        Pipeline progress
      </h2>
      <ol className="space-y-3">
        {items.map((item) => (
          <li
            key={item.id}
            className={`flex items-center gap-3 text-sm ${
              item.status === 'pending' ? 'text-slate-400' : 'text-ink'
            }`}
          >
            {item.status === 'done' ? (
              <span
                aria-hidden="true"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-white"
              >
                ✓
              </span>
            ) : item.status === 'active' ? (
              <span
                aria-hidden="true"
                className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-indigo-200 border-t-accent motion-reduce:animate-none"
              />
            ) : (
              <span aria-hidden="true" className="h-5 w-5 shrink-0 rounded-full border-2 border-slate-200" />
            )}
            <span className={item.status === 'active' ? 'font-medium text-accent-deep' : ''}>{item.label}</span>
            {item.status === 'active' && <span className="sr-only">in progress</span>}
            {item.status === 'done' && <span className="sr-only">complete</span>}
          </li>
        ))}
      </ol>
    </section>
  )
}
