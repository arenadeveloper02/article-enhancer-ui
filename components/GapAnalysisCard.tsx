import type { GapAnalysisData, SectionStatus } from '@/lib/types'
import { SectionHeader } from '@/components/SectionHeader'

type GapEntry = string | { title: string; detail?: string }

interface GapAnalysisCardProps {
  data: GapAnalysisData | null
  status: SectionStatus
}

interface SubGroupProps {
  title: string
  icon: string
  items: GapEntry[]
  done: boolean
  dotClass: string
  badgeClass: string
}

function SubGroup({ title, icon, items, done, dotClass, badgeClass }: SubGroupProps) {
  return (
    <div>
      <div className="mb-2.5 flex items-center gap-2">
        <span aria-hidden="true" className="text-sm">
          {icon}
        </span>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-soft">{title}</h3>
        <span
          className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${badgeClass}`}
        >
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm italic text-slate-400">{done ? 'No data' : 'Waiting for data…'}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item, index) => (
            <li key={index} className="flex items-start gap-2 text-sm leading-relaxed text-ink">
              <span aria-hidden="true" className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
              {typeof item === 'string' ? (
                <span>{item}</span>
              ) : (
                <span>
                  <span className="font-medium">{item.title}</span>
                  {item.detail ? <span className="mt-0.5 block text-ink-soft">{item.detail}</span> : null}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function GapAnalysisCard({ data, status }: GapAnalysisCardProps) {
  const showSkeleton = data === null && status !== 'done'
  const strengths: GapEntry[] = data ? data.competitor_strengths : []
  const gaps: GapEntry[] = data ? data.coverage_gaps : []
  const underdeveloped: GapEntry[] = data ? data.underdeveloped_sections : []
  const done = status === 'done'
  return (
    <section
      aria-label="Gap analysis"
      className="card-enter rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8"
    >
      <SectionHeader title="Gap Analysis" icon="▦" status={status} />
      {showSkeleton ? (
        <div className="space-y-3" aria-hidden="true">
          <div className="skeleton-bar h-4 w-1/3 rounded-lg bg-slate-100" />
          <div className="skeleton-bar h-4 w-full rounded-lg bg-slate-100" />
          <div className="skeleton-bar h-4 w-5/6 rounded-lg bg-slate-100" />
          <div className="skeleton-bar h-4 w-2/3 rounded-lg bg-slate-100" />
        </div>
      ) : (
        <div className="space-y-6">
          <SubGroup
            title="Competitor Strengths"
            icon="🏆"
            items={strengths}
            done={done}
            dotClass="bg-sky-500"
            badgeClass="bg-sky-100 text-sky-700"
          />
          <SubGroup
            title="Coverage Gaps"
            icon="🧩"
            items={gaps}
            done={done}
            dotClass="bg-amber-500"
            badgeClass="bg-amber-100 text-amber-700"
          />
          <SubGroup
            title="Underdeveloped Sections"
            icon="🌱"
            items={underdeveloped}
            done={done}
            dotClass="bg-violet-500"
            badgeClass="bg-violet-100 text-violet-700"
          />
        </div>
      )}
    </section>
  )
}
