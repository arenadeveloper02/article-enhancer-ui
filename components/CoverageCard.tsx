import type { CoverageData } from '@/lib/types'

interface CoverageCardProps {
  data: CoverageData
}

export function CoverageCard({ data }: CoverageCardProps) {
  return (
    <section
      aria-label="Coverage verification"
      className="card-enter rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-ink">Coverage Verification</h2>
        <div className="flex items-center gap-3">
          {data.passed !== null && (
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                data.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
              }`}
            >
              {data.passed ? 'Passed' : 'Needs work'}
            </span>
          )}
          {data.overallScore !== null && (
            <span
              aria-label={`Overall score ${Math.round(data.overallScore)}`}
              className="inline-flex h-12 w-12 items-center justify-center rounded-full border-4 border-indigo-100 bg-indigo-50 font-display text-sm font-bold text-accent"
            >
              {Math.round(data.overallScore)}
            </span>
          )}
        </div>
      </div>
      {data.summary && <p className="mt-4 text-sm leading-relaxed text-ink-soft">{data.summary}</p>}
      {data.criteria.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-soft">Criteria</h3>
          <ul className="space-y-2">
            {data.criteria.map((item, index) => (
              <li key={index} className="flex items-start gap-2 text-sm leading-relaxed text-ink">
                <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
