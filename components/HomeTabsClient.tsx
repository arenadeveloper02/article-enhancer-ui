"use client"

import { useState } from 'react'
import { EnhancerClient } from '@/components/EnhancerClient'
import { HistoryClient } from '@/components/HistoryClient'

type HomeView = 'generator' | 'history'

const TABS: Array<{ key: HomeView; label: string }> = [
  { key: 'generator', label: 'Generator' },
  { key: 'history', label: 'History' },
]

export function HomeTabsClient() {
  const [view, setView] = useState<HomeView>('generator')

  return (
    /* Spacing system: 48px top header padding (pt-12), 32px between the
       header block and the first card (header mb-8). No horizontal overflow
       anywhere — the workflow grid inside ResultTabs wraps on small screens. */
    <main className="min-h-screen w-full overflow-x-hidden px-4 pb-10 pt-12 sm:px-6">
      {/* Shared content container: every major section (header, toggle,
          Generator form/results, History list/detail) aligns to the same
          width — ~92% of the viewport on desktop, capped at 1600px. Tablet
          and mobile stay full width (minus padding); the page is never
          full-bleed. */}
      <div className="mx-auto w-full max-w-[1600px] lg:w-[92%]">
        {/* screen-only: hidden inside @media print so the exported PDF contains
            only the PrintableReport rendered by the active view. Compact,
            balanced header: centered title, centered description capped at
            760px, and the Generator/History toggle aligned to the shared
            content width — 32px gap down to the first card. */}
        <header className="screen-only mb-8 text-center">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Article Enhancer Agent
          </h1>
          <p className="mx-auto mt-2.5 max-w-[760px] text-base leading-relaxed text-ink-soft">
            Paste your article, tell the agent what kind of content it is, and watch an enhanced
            version stream in live — properly formatted and ready to publish.
          </p>
          <div className="mt-4 flex justify-center">
            <div
              role="tablist"
              aria-label="Switch between Generator and History"
              className="inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-card"
            >
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={view === tab.key}
                  onClick={() => setView(tab.key)}
                  className={`rounded-full px-5 py-2 text-sm font-semibold transition focus:outline-none focus-visible:outline-2 focus-visible:outline-accent ${
                    view === tab.key
                      ? 'bg-accent text-white shadow-sm'
                      : 'text-ink-soft hover:text-ink'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </header>

        {/* The Generator stays mounted (hidden) while History is open so an
            in-flight streaming run and its results are never lost when the
            user toggles tabs. The hidden wrapper also keeps the Generator's
            print mirror out of History exports. The `enhancer-wide` class
            widens the Generator form/results column to the full shared
            container width via app/globals.css. */}
        <div className={view === 'generator' ? 'enhancer-wide' : 'enhancer-wide hidden'}>
          <EnhancerClient />
        </div>
        {/* HistoryClient manages its own screen-only wrappers internally so its
            Export (print) mirror can render inside @media print. The
            `history-wide` class widens its internal max-w-* column caps to the
            shared container width via app/globals.css. */}
        {view === 'history' && (
          <div className="history-wide">
            <HistoryClient />
          </div>
        )}
      </div>
    </main>
  )
}
