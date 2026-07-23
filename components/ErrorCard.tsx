"use client"

interface ErrorCardProps {
  message: string
  onRetry: () => void
}

export function ErrorCard({ message, onRetry }: ErrorCardProps) {
  return (
    <section
      role="alert"
      className="rounded-2xl border border-rose-200 bg-rose-50/70 p-6 shadow-card sm:p-8"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-100 text-base font-semibold text-rose-600"
        >
          !
        </span>
        <div>
          <h2 className="font-display text-lg font-semibold text-rose-900">Enhancement failed</h2>
          <p className="mt-1 text-sm leading-relaxed text-rose-800">{message}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 inline-flex items-center rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700"
          >
            Try again
          </button>
        </div>
      </div>
    </section>
  )
}
