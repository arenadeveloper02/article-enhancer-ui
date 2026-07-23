import type { GapAnalysisData } from '@/lib/types'

interface GapAnalysisCardProps {
  data: GapAnalysisData
}

interface ListSectionProps {
  title: string
  items: string[]
}

function ListSection({ title, items }: ListSectionProps) {
  if (items.length === 0) return null
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-soft">{title}</h3>
      <ul className="space-y-2">
        {items.map((item, index) => (
          <li key={index} className="flex items-start gap-2 text-sm leading-relaxed text-ink">
            <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function GapAnalysisCard({ data }: GapAnalysisCardProps) {
  return (
    <section
      aria-label="Gap analysis"
      className="card-enter rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8"
    >
      <h2 className="mb-5 font-display text-lg font-semibold text-ink">Gap Analysis</h2>
      <div className="space-y-5">
        <ListSection title="Competitor strengths" items={data.competitorStrengths} />
        <ListSection title="Coverage gaps" items={data.coverageGaps} />
        <ListSection title="Underdeveloped sections" items={data.underdevelopedSections} />
      </div>
    </section>
  )
}
