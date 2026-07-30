import type { ReactNode } from 'react'
import type { RecommendationItem, RecommendationsData, SectionStatus } from '@/lib/types'
import { SectionHeader } from '@/components/SectionHeader'

// normalizeRecommendations tags items sourced from the workflow's
// recommendations.citation_opportunities and recommendations.faq_suggestions
// outputs with these exact categories — the card partitions on them so the
// Recommendations tab always renders THREE titled sections:
//  1. Citation Opportunities — claim/stats, placement, source name, source URL
//  2. FAQ Suggestions — question, suggested answer, why it matters
//  3. Recommendations — recommendation, placement, priority, rationale
const CITATION_CATEGORY = 'Citation Opportunity'
const FAQ_CATEGORY = 'FAQ Suggestion'

type Bucket = 'citation' | 'faq' | 'main'

/**
 * Tolerant partitioning: exact category matches (CITATION_CATEGORY /
 * FAQ_CATEGORY) are honored first, and any loose category value that merely
 * mentions "citation" or "faq" routes to the matching section too. Everything
 * else lands in the main Recommendations section — so items never disappear
 * behind a category mismatch and the section never shows an empty placeholder
 * while data exists.
 */
function bucketOf(item: RecommendationItem): Bucket {
  const cat = (item.category ?? '').trim().toLowerCase()
  if (cat === CITATION_CATEGORY.toLowerCase() || cat.includes('citation')) return 'citation'
  if (cat === FAQ_CATEGORY.toLowerCase() || cat.includes('faq')) return 'faq'
  return 'main'
}

/**
 * Resolves the primary display text for a main-section recommendation item.
 * Some stream payloads lack a structured `recommendation` field; in that case
 * the normalizer stores a truncated (ellipsised) preview in `title` and the
 * FULL text in `detail`. Rendering the truncated preview looks like a broken
 * placeholder — so when the title is a truncated prefix of the detail text,
 * the full detail is shown as the main content instead.
 */
function resolveMainText(item: RecommendationItem): { main: string; extraDetail: string } {
  const rec = (item.recommendation ?? '').trim()
  const detail = item.detail.trim()
  if (rec) {
    return { main: rec, extraDetail: detail && detail !== rec ? detail : '' }
  }
  const title = item.title.trim()
  if (detail && title.endsWith('…')) {
    const prefix = title.slice(0, -1).trim()
    if (prefix && detail.replace(/\s+/g, ' ').startsWith(prefix.replace(/\s+/g, ' '))) {
      return { main: detail, extraDetail: '' }
    }
  }
  return { main: title, extraDetail: detail && detail !== title ? detail : '' }
}

interface RecommendationsCardProps {
  data: RecommendationsData | null
  status: SectionStatus
  embedded?: boolean
}

function priorityClasses(priority: string): string {
  const p = priority.toLowerCase()
  if (p === 'high') return 'bg-rose-100 text-rose-700'
  if (p === 'medium') return 'bg-amber-100 text-amber-700'
  if (p === 'low') return 'bg-emerald-100 text-emerald-700'
  return 'bg-slate-100 text-slate-600'
}

function SubHeading({ title, count }: { title: string; count: number }) {
  return (
    <div className="mb-2.5 flex items-center gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-soft">{title}</h3>
      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-100 px-1.5 text-[11px] font-semibold tabular-nums text-accent-deep">
        {count}
      </span>
    </div>
  )
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <span className="w-36 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <span className="min-w-0 flex-1 text-sm leading-relaxed text-ink-soft">{children}</span>
    </div>
  )
}

function ItemShell({ index, children }: { index: number; children: ReactNode }) {
  return (
    <li className="rounded-xl border border-slate-100 p-4 transition hover:border-indigo-100 hover:bg-indigo-50/30">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 font-display text-xs font-semibold text-accent"
        >
          {index + 1}
        </span>
        <div className="min-w-0 flex-1 space-y-2">{children}</div>
      </div>
    </li>
  )
}

// ── Section 1: Citation Opportunities ─────────────────────────────────────
function CitationItemList({ items }: { items: RecommendationItem[] }) {
  return (
    <ol className="space-y-3">
      {items.map((item, index) => {
        const claim = item.claim || item.title
        const showFallbackDetail =
          !item.placement && !item.sourceName && !item.sourceUrl && item.detail && item.detail !== claim
        return (
          <ItemShell key={index} index={index}>
            <h3 className="text-sm font-semibold leading-relaxed text-ink">{claim}</h3>
            <div className="space-y-1.5">
              {item.placement ? <FieldRow label="Placement">{item.placement}</FieldRow> : null}
              {item.sourceName ? <FieldRow label="Source name">{item.sourceName}</FieldRow> : null}
              {item.sourceUrl ? (
                <FieldRow label="Source URL">
                  {/^https?:\/\//i.test(item.sourceUrl) ? (
                    <a
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all font-medium text-accent underline decoration-indigo-200 underline-offset-2 transition hover:text-accent-deep hover:decoration-indigo-400"
                    >
                      {item.sourceUrl}
                    </a>
                  ) : (
                    <span className="break-all">{item.sourceUrl}</span>
                  )}
                </FieldRow>
              ) : null}
              {showFallbackDetail ? (
                <p className="text-sm leading-relaxed text-ink-soft">{item.detail}</p>
              ) : null}
            </div>
          </ItemShell>
        )
      })}
    </ol>
  )
}

// ── Section 2: FAQ Suggestions ─────────────────────────────────────────────
function FaqItemList({ items }: { items: RecommendationItem[] }) {
  return (
    <ol className="space-y-3">
      {items.map((item, index) => {
        const question = item.question || item.title
        const answer = item.answer || (item.detail !== question ? item.detail : '')
        return (
          <ItemShell key={index} index={index}>
            <h3 className="text-sm font-semibold leading-relaxed text-ink">{question}</h3>
            <div className="space-y-1.5">
              {answer ? <FieldRow label="Suggested answer">{answer}</FieldRow> : null}
              {item.whyItMatters ? <FieldRow label="Why it matters">{item.whyItMatters}</FieldRow> : null}
            </div>
          </ItemShell>
        )
      })}
    </ol>
  )
}

// ── Section 3: Recommendations ─────────────────────────────────────────────
function RecommendationItemList({ items }: { items: RecommendationItem[] }) {
  return (
    <ol className="space-y-3">
      {items.map((item, index) => {
        const { main, extraDetail } = resolveMainText(item)
        return (
          <ItemShell key={index} index={index}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="min-w-0 text-sm font-semibold leading-relaxed text-ink">{main}</h3>
              {item.priority ? (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${priorityClasses(item.priority)}`}
                >
                  {item.priority}
                </span>
              ) : null}
            </div>
            <div className="space-y-1.5">
              {item.placement ? <FieldRow label="Placement">{item.placement}</FieldRow> : null}
              {item.rationale ? <FieldRow label="Rationale">{item.rationale}</FieldRow> : null}
              {!item.rationale && extraDetail ? <FieldRow label="Detail">{extraDetail}</FieldRow> : null}
            </div>
          </ItemShell>
        )
      })}
    </ol>
  )
}

function EmptySectionNote({ done }: { done: boolean }) {
  return <p className="text-sm italic text-slate-400">{done ? 'No data' : 'Waiting for data…'}</p>
}

export function RecommendationsCard({ data, status, embedded = false }: RecommendationsCardProps) {
  const showSkeleton = data === null && status !== 'done' && status !== 'empty'
  const items = data ? data.recommendations : []
  const done = status === 'done' || status === 'empty'

  const citationItems = items.filter((item) => bucketOf(item) === 'citation')
  const faqItems = items.filter((item) => bucketOf(item) === 'faq')
  const mainItems = items.filter((item) => bucketOf(item) === 'main')

  return (
    <section
      aria-label="Recommendations"
      className={
        embedded
          ? ''
          : 'card-enter rounded-2xl border border-slate-200 bg-white p-6 shadow-card sm:p-8'
      }
    >
      <SectionHeader title="Recommendations" icon="☰" status={status} />
      {showSkeleton ? (
        <div className="space-y-3" aria-hidden="true">
          <div className="skeleton-bar h-14 w-full rounded-xl bg-slate-100" />
          <div className="skeleton-bar h-14 w-full rounded-xl bg-slate-100" />
          <div className="skeleton-bar h-14 w-5/6 rounded-xl bg-slate-100" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm italic text-slate-400">{done ? 'No data' : 'Waiting for data…'}</p>
      ) : (
        <div className="space-y-6">
          <div>
            <SubHeading title="Citation Opportunities" count={citationItems.length} />
            {citationItems.length === 0 ? (
              <EmptySectionNote done={done} />
            ) : (
              <CitationItemList items={citationItems} />
            )}
          </div>
          <div>
            <SubHeading title="FAQ Suggestions" count={faqItems.length} />
            {faqItems.length === 0 ? <EmptySectionNote done={done} /> : <FaqItemList items={faqItems} />}
          </div>
          <div>
            <SubHeading title="Recommendations" count={mainItems.length} />
            {mainItems.length === 0 ? (
              <EmptySectionNote done={done} />
            ) : (
              <RecommendationItemList items={mainItems} />
            )}
          </div>
        </div>
      )}
    </section>
  )
}
