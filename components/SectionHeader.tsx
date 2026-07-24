import type { ReactNode } from 'react'
import type { SectionStatus } from '@/lib/types'

interface SectionHeaderProps {
  title: string
  icon: ReactNode
  status: SectionStatus
  accent?: boolean
  actions?: ReactNode
}

export function SectionHeader({ title, icon, status, accent = false, actions }: SectionHeaderProps) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm ${
            accent ? 'bg-indigo-100 text-accent-deep' : 'bg-slate-100 text-ink-soft'
          }`}
        >
          {icon}
        </span>
        <h2 className={`font-display text-lg font-semibold ${accent ? 'text-accent-deep' : 'text-ink'}`}>
          {title}
        </h2>
      </div>
      <div className="flex items-center gap-2.5">
        {actions}
        {status === 'pending' && (
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Pending
          </span>
        )}
        {status === 'streaming' && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent-deep">
            <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60 motion-reduce:hidden" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
            </span>
            Streaming
          </span>
        )}
        {status === 'done' && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
            ✓ Done
          </span>
        )}
      </div>
    </div>
  )
}
