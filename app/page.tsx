import { EnhancerClient } from '@/components/EnhancerClient'

export default function HomePage() {
  return (
    <main className="min-h-screen w-full px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-8 text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          Article Enhancer Agent
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-ink-soft">
          Paste your article, tell the agent what kind of content it is, and watch an enhanced
          version stream in live — properly formatted and ready to publish.
        </p>
      </header>
      <EnhancerClient />
    </main>
  )
}
