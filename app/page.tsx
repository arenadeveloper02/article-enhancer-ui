import { EnhancerClient } from '@/components/EnhancerClient'

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-12 sm:py-16 lg:px-10">
      <header className="mb-10 text-center">
        <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium tracking-wide text-ink-soft shadow-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
          AI-powered editing
        </p>
        <h1 className="font-display text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
          Article Enhancer Agent
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-ink-soft">
          Paste your article, tell the agent what kind of content it is, and watch an enhanced
          version stream in live — properly formatted and ready to publish.
        </p>
      </header>
      <EnhancerClient />
    </main>
  )
}
