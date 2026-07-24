import type { RecommendationsData, SectionStatus } from '@/lib/types'
import { SectionHeader } from '@/components/SectionHeader'

interface RecommendationsCardProps {
  data: RecommendationsData | null
  status: SectionStatus
  embedded?: boolean
}

function priorityClasses(priority: string): string {
  const p = priority.toLowerCase()
  if (p === 'high') return 'bg-rose-100 text-rose-700'
  if (p === 'medium') return 'bg-amber-100 text-amber-700'
  if (p === 'low') return 'bg-emerald-100 text-emerald-700'
  return 'bg-slate-100 text-slate-600'
}

export function RecommendationsCard({ data, status, embedded = false }: RecommendationsCardProps) {
  const showSkeleton = data === null && status !== 'done' && status !== 'empty'
  const items = data ? data.recommendations : []
  const done = status === 'done' || status === 'empty'
  return (
    <section
      aria-label="Recommendations"
      className={
        embedded
          ? ''
          : 'card-enter rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8'
      }
    >
      <SectionHeader title="Recommendations" icon="☰" status={status} />
      {showSkeleton ? (
        <div className="space-y-3" aria-hidden="true">
          <div className="skeleton-bar h-14 w-full rounded-xl bg-slate-100" />
          <div className="skeleton-bar h-14 w-full rounded-xl bg-slate-100" />
          <div className="skeleton-bar h-14 w-5/6 rounded-xl bg-slate-100" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm italic text-slate-400">{done ? 'No data' : 'Waiting for data…'}</p>
      ) : (
        <ol className="space-y-3">
          {items.map((item, index) => (
            <li
              key={index}
              className="rounded-xl border border-slate-100 p-4 transition hover:border-indigo-100 hover:bg-indigo-50/30"
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 font-display text-xs font-semibold text-accent"
                >
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-ink">{item.title}</h3>
                    {item.priority ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${priorityClasses(item.priority)}`}
                      >
                        {item.priority}
                      </span>
                    ) : null}
                    {item.category ? (
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-deep">
                        {item.category}
                      </span>
                    ) : null}
                  </div>
                  {item.detail ? (
                    <p className="mt-1 text-sm leading-relaxed text-ink-soft">{item.detail}</p>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
