interface RecommendationsCardProps {
  items: string[]
}

export function RecommendationsCard({ items }: RecommendationsCardProps) {
  return (
    <section
      aria-label="Recommendations"
      className="card-enter rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8"
    >
      <h2 className="mb-5 font-display text-lg font-semibold text-ink">Recommendations</h2>
      <ol className="space-y-3">
        {items.map((item, index) => (
          <li key={index} className="flex items-start gap-3 text-sm leading-relaxed text-ink">
            <span
              aria-hidden="true"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 font-display text-xs font-semibold text-accent"
            >
              {index + 1}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
