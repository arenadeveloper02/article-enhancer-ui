import { MarkdownRenderer } from '@/components/MarkdownRenderer'

interface ResultCardProps {
  content: string
  streaming: boolean
}

export function ResultCard({ content, streaming }: ResultCardProps) {
  return (
    <section
      aria-label="Enhanced article"
      className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card"
    >
      {streaming && <div className="gradient-line absolute inset-x-0 top-0 h-1" aria-hidden="true" />}
      <div className="p-6 sm:p-8">
        {content ? (
          <MarkdownRenderer content={content} />
        ) : streaming ? (
          <div className="space-y-3" aria-hidden="true">
            <div className="skeleton-bar h-6 w-2/3 rounded-lg bg-slate-100" />
            <div className="skeleton-bar h-4 w-full rounded-lg bg-slate-100" />
            <div className="skeleton-bar h-4 w-11/12 rounded-lg bg-slate-100" />
            <div className="skeleton-bar h-4 w-4/5 rounded-lg bg-slate-100" />
            <div className="skeleton-bar mt-6 h-5 w-1/2 rounded-lg bg-slate-100" />
            <div className="skeleton-bar h-4 w-full rounded-lg bg-slate-100" />
            <div className="skeleton-bar h-4 w-3/4 rounded-lg bg-slate-100" />
          </div>
        ) : (
          <p className="text-sm text-slate-400">No content yet.</p>
        )}
      </div>
    </section>
  )
}
