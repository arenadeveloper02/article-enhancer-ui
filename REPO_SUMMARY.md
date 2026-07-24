# Repository Summary: article-enhancer-ui

> Auto-maintained by Sim Development. Last updated: 2026-07-24T05:23:59.350Z.

## Overview

Article Enhancer Agent — submits an article to an SEO enhancement pipeline and renders live streaming results (enhanced article, gap analysis, recommendations, coverage verification) with blockId-routed SSE parsing, defensive normalizers, staged panel reveal, and a polished streaming UX.

**Repository:** `article-enhancer-ui`  
**File count:** 32

## Features

- Server-side streaming proxy to the enhancement workflow with hardcoded server-only API key
- SSE parsing routed by blockId prefixes with [DONE] sentinel handling
- Four purpose-built result sections: Enhanced Article (live-typed markdown), Gap Analysis, Recommendations, Coverage Verification
- Shared defensive normalizers in lib/normalize.ts (never render raw JSON)
- Per-stage progress checklist with pending/active/done states
- Heartbeat/status events routed to a live status chip with elapsed timer
- Optimistic UI with Cancel (AbortController) and Retry
- Client-side inline validation for URL, text, and content type
- Copy-article button, live word count, blinking streaming caret
- Responsive indigo/violet theme with reduced-motion support

## Tech Stack

- Next.js ^15.3.3 (App Router)
- React ^19.0.0
- Tailwind CSS v3
- TypeScript
- Prisma + PostgreSQL (Neon on Vercel)

## Infrastructure

- **DATABASE_URL:** set on Vercel when Neon is connected — do not commit real credentials

## Routes & Pages

- `/` — `app/page.tsx`

## Database Models

- `EnhancementLog`

## File Inventory

### App pages

- `app/error.tsx`
- `app/globals.css`
- `app/layout.tsx`
- `app/not-found.tsx`
- `app/page.tsx`

### API routes

- `app/api/enhance/route.ts`

### Components

- `components/CoverageCard.tsx`
- `components/EnhancerClient.tsx`
- `components/ErrorCard.tsx`
- `components/GapAnalysisCard.tsx`
- `components/MarkdownRenderer.tsx`
- `components/ProgressChecklist.tsx`
- `components/RecommendationsCard.tsx`
- `components/ResultCard.tsx`
- `components/SectionHeader.tsx`
- `components/StageChecklist.tsx`
- `components/StatusChip.tsx`

### Libraries

- `lib/normalize.ts`
- `lib/prisma.ts`
- `lib/stream.ts`
- `lib/types.ts`
- `prisma/schema.prisma`

### Config

- `.env.example`
- `next-env.d.ts`
- `next.config.ts`
- `package-lock.json`
- `package.json`
- `postcss.config.mjs`
- `tailwind.config.ts`
- `tsconfig.json`

### Other

- `README.md`
- `REPO_SUMMARY.md`

## Complete File Index

- `.env.example`
- `README.md`
- `REPO_SUMMARY.md`
- `app/api/enhance/route.ts`
- `app/error.tsx`
- `app/globals.css`
- `app/layout.tsx`
- `app/not-found.tsx`
- `app/page.tsx`
- `components/CoverageCard.tsx`
- `components/EnhancerClient.tsx`
- `components/ErrorCard.tsx`
- `components/GapAnalysisCard.tsx`
- `components/MarkdownRenderer.tsx`
- `components/ProgressChecklist.tsx`
- `components/RecommendationsCard.tsx`
- `components/ResultCard.tsx`
- `components/SectionHeader.tsx`
- `components/StageChecklist.tsx`
- `components/StatusChip.tsx`
- `lib/normalize.ts`
- `lib/prisma.ts`
- `lib/stream.ts`
- `lib/types.ts`
- `next-env.d.ts`
- `next.config.ts`
- `package-lock.json`
- `package.json`
- `postcss.config.mjs`
- `prisma/schema.prisma`
- `tailwind.config.ts`
- `tsconfig.json`

## Latest Change

- **Updated at:** 2026-07-24T05:23:59.350Z
- **Request:** Generate a production-quality Next.js (App Router, TypeScript) single-page web app called "Article Enhancer" that submits an article to an SEO enhancement pipeline and renders the LIVE streaming results with a polished, interactive UX. Implement ALL of the following exactly.

=== SERVER ROUTE: app/api/enhance/route.ts ===
Hardcode the API key SERVER-SIDE ONLY (never expose it in the client bundle or any NEXT_PUBLIC var):
  const SIM_API_KEY = 'sk-sim-jYKjvV7VAToCX_MNfI00-2sGNmcyDZAS';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
Accept POST { article_url, article_text, content_type } from the client. Proxy to the upstream exactly as this curl reference specifies (same endpoint, header, and body shape — do not alter field names or casing):

  curl -X POST \
    -H "X-API-Key: $SIM_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"article_url":"example","article_text":"example","content_type":"example","stream":true,"selectedOutputs":["recommendations.recommendations","enhancedarticlewriter.content","coverageverifier.criteria","coverageverifier.overall_score","coverageverifier.passed","coverageverifier.summary","gapanalysis.competitor_strengths","gapanalysis.coverage_gaps","gapanalysis.underdeveloped_sections"]}' \
    https://test-agent.thearena.ai/api/workflows/9aafe5d7-1d24-477a-ad3f-0be9bf79c04f/execute

  Concretely: POST https://test-agent.thearena.ai/api/workflows/9aafe5d7-1d24-477a-ad3f-0be9bf79c04f/execute
  Headers: { 'X-API-Key': SIM_API_KEY, 'Content-Type': 'application/json' }
  Body (JSON): {
    article_url, article_text, content_type,
    stream: true,
    selectedOutputs: [
      'recommendations.recommendations',
      'enhancedarticlewriter.content',
      'coverageverifier.criteria',
      'coverageverifier.overall_score',
      'coverageverifier.passed',
      'coverageverifier.summary',
      'gapanalysis.competitor_strengths',
      'gapanalysis.coverage_gaps',
      'gapanalysis.underdeveloped_sections'
    ]
  }
The route MUST stream: return new Response(upstream.body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' } }). Pipe the upstream ReadableStream body straight through — DO NOT call upstream.json() or buffer the whole body. If upstream returns application/json (non-streamed fallback), forward it as JSON instead. Handle upstream !ok by forwarding status + error text.

=== CRITICAL: THE STREAM WIRE FORMAT (this is the part the old app got wrong) ===
The upstream emits Server-Sent Events. Each event line looks like:
  data: {"blockId":"<uuid>","chunk":"<partial text tokens>"}
The stream TERMINATES with a sentinel line:
  data: [DONE]
There are NO named-output keys like 'enhancedarticlewriter.content' in the stream — routing is BY blockId. The client MUST accumulate the 'chunk' strings per blockId (concatenate in arrival order), and map each blockId to its panel/stage using this EXACT map:
  '65f7256c' prefix => Theme Extractor  (internal; STATUS chip only, do NOT render into a panel)
  '648b01f8' prefix => Competitor Research (Exa) (internal; STATUS chip only)
  '0f239b6f' prefix => GAP ANALYSIS panel
  '5ae6657d' prefix => RECOMMENDATIONS panel
  '88db1a98' prefix => ENHANCED ARTICLE panel (live-typed markdown content)
  'c4bd5114' prefix => COVERAGE VERIFICATION panel
Match by blockId.startsWith(prefix) so full UUIDs still map correctly. Keep a fallback: any unknown blockId whose accumulated chunk is long-form prose is treated as the enhanced article; short JSON-ish blobs route by detected keys (see parsing rules below).

=== OUTPUT DATA CONTRACTS (defines exact shape + parsing/normalization for every panel) ===
Each JSON-bearing panel's accumulated text is parsed ONLY after it looks structurally complete (balanced braces/brackets — do not attempt JSON.parse on every partial chunk; attempt parse, catch failure silently, and keep showing the streaming/skeleton state until it succeeds). Once parsed, RUN IT THROUGH A NORMALIZER FUNCTION before it touches any component — never pass raw parsed JSON straight into JSX. Each normalizer must:
  - Guarantee every expected field exists on the returned object (fill missing scalars with null, missing arrays with []).
  - Coerce mismatched types defensively (e.g. a numeric string for overall_score gets Number()'d; a single object where an array is expected gets wrapped in [object]).
  - Never throw — wrap the whole normalizer body in try/catch and return a safe default shape on any failure.

Exact TypeScript interfaces + normalizer contracts (field names and casing are FINAL — do not rename, alias, or reshape these anywhere in the codebase):

  // Gap Analysis (blockId 0f239b6f)
  interface GapAnalysisData {
    competitor_strengths: string[] | { title: string; detail?: string }[];
    coverage_gaps: string[] | { title: string; detail?: string }[];
    underdeveloped_sections: string[] | { title: string; detail?: string }[];
  }
  function normalizeGapAnalysis(raw: unknown): GapAnalysisData // returns { competitor_strengths: [], coverage_gaps: [], underdeveloped_sections: [] } on any parse/shape failure
  Rendering rule: for each array, if an item is a string render it directly as a bullet/chip; if an item is an object render item.title as the bullet label and item.detail (if present) as secondary text underneath. Never render `{...}` or JSON.stringify output in the DOM.

  // Recommendations (blockId 5ae6657d)
  interface RecommendationItem {
    title: string;
    detail: string;
    priority?: 'high' | 'medium' | 'low' | string | null;
    category?: string | null;
  }
  interface RecommendationsData { recommendations: RecommendationItem[]; }
  function normalizeRecommendations(raw: unknown): RecommendationsData
  Normalization rule: if an item is a plain string, map it to { title: <string>, detail: '', priority: null, category: null }. If an item is an object missing `title`, derive title from the first ~60 chars of whatever text field is present (e.g. `detail`, `text`, `description`) and put the rest in detail. Sort order: if any item has a recognized priority, group high → medium → low → unlabeled; otherwise preserve arrival order. Numbering badges always reflect final rendered order, not raw array index.

  // Coverage Verification (blockId c4bd5114)
  interface CriteriaItem {
    name: string;
    passed: boolean | null;
    score?: number | null;
    notes?: string | null;
  }
  interface CoverageData {
    overall_score: number | null;
    passed: boolean | null;
    summary: string | null;
    criteria: CriteriaItem[];
  }
  function normalizeCoverage(raw: unknown): CoverageData
  Normalization rule: overall_score coerced to a finite number in [0,100] or null (clamp out-of-range values, reject NaN → null). passed coerced to strict boolean or null if absent/ambiguous. Each criteria item missing `name` is dropped (do not render a nameless row). `score`, if present on a criteria item, is clamped the same way as overall_score.

  // Enhanced Article (blockId 88db1a98)
  No JSON parsing — this panel is raw accumulated markdown text (string). Apply unicode-escape decoding (see below) on every re-render, not just at the end. Word count is computed by splitting the CURRENT decoded string on whitespace — recompute on every chunk, not once at [DONE].

All four normalizers live in a single shared `lib/normalize.ts` module (not duplicated per-component), each with an explicit, exported function signature and an explicit return type — no `any` in signatures. Components import and call these; components themselves must never contain ad-hoc JSON.parse or field-guessing logic.

Also decode raw unicode escapes (e.g. \u2013, \u2019) into real characters everywhere before display, whether values arrive as valid JSON or double-escaped plain text — do this decoding inside the normalizers/accumulator, once, not scattered redundantly across components.

=== TYPE SAFETY / NAMING CONVENTION (fixes prior build failure) ===
The previous build failed with:
  Type error: Property 'overall_score' does not exist on type 'CoverageData'. Did you mean 'overallScore'?
This happened because the TypeScript interface used camelCase field names while the parsed JSON (and JSX access) used the raw snake_case field names from the API. To prevent this class of bug:
  - Interfaces MUST use the exact snake_case keys defined in the OUTPUT DATA CONTRACTS section above — never introduce a parallel camelCase alias for the same field.
  - After generating all components, do a final pass checking every `data.<field>` access against its interface definition to confirm name and casing match exactly, and confirm every component only ever receives data that has already passed through its corresponding normalizer function. Run a mental (or actual) `tsc --noEmit` check — the build must compile with zero type errors before considering the code complete.

=== CLIENT: consuming the stream (app/page.tsx + components) ===
The form calls ONLY the local /api/enhance route (never the upstream directly). Use fetch + response.body.getReader() + TextDecoder to read incrementally. Buffer bytes and split on newlines — chunks WILL arrive split mid-line, so keep a leftover buffer until you hit a newline. For each complete line:
  1. Trim; if it does not start with 'data:' skip it.
  2. Take payload = line.slice(5).trim().
  3. If payload === '[DONE]' => mark the run complete, finalize all stages to done, and STOP. NEVER render '[DONE]' into any panel or the content — that was the previous bug.
  4. Otherwise JSON.parse(payload) inside try/catch (swallow parse errors on partial/non-JSON lines). On success you get { blockId, chunk }. Append chunk to that blockId's accumulator, mark that stage in-progress on first chunk, run the accumulated text through the relevant normalizer (see OUTPUT DATA CONTRACTS), and route the normalized result to the mapped panel, re-rendering on each chunk.

=== RESULTS OUTPUT — FOUR REQUIRED SECTIONS (THIS IS THE MOST IMPORTANT PART) ===
The results area MUST render EXACTLY these four sections, each as its own distinct, clearly-labeled card with a header (section title + icon + a status pill), in this vertical order. Every section must have a great, purpose-built UI — not a raw JSON dump. Handle empty/loading/error states per section (skeleton shimmer while pending, graceful 'No data' if a normalizer returns an empty/default shape after [DONE]).

1) ENHANCED ARTICLE section (blockId 88db1a98) — the primary, largest card, visually emphasized (accent border/heading).
   - Render the accumulated content as clean, readable Markdown (headings, bold, lists, links, blockquotes) in an article-typography container (comfortable measure ~68ch, generous line-height, styled h1-h4, ul/ol, code, blockquote).
   - LIVE TOKEN RENDERING: append tokens progressively so the article visibly types out in real time; re-render on each chunk; show a blinking caret at the end while streaming.
   - Include a 'Copy article' button (copies the raw markdown) and a word-count badge. Support marked/highlighted additions if the content includes them.

2) GAP ANALYSIS section (blockId 0f239b6f) — render the normalized GapAnalysisData as three clearly separated, labeled sub-groups, each a titled list with its own icon and count badge (count reflects the normalized array length):
   - Competitor Strengths
   - Coverage Gaps
   - Underdeveloped Sections
   Use distinct subtle color accents per sub-group. Never render raw JSON; if the normalizer returns an empty array for a group after [DONE], show a 'No data' placeholder for that specific sub-group (not the whole card).

3) RECOMMENDATIONS section (blockId 5ae6657d) — render the normalized RecommendationsData as an ORDERED, prioritized list of recommendation cards. Each shows a number/priority badge (reflecting final sorted order), a title/headline, and its detail/body text. If `priority` or `category` is present, surface as a colored pill. Keep it scannable with clear spacing and hover states. Never show raw JSON.

4) COVERAGE VERIFICATION section (blockId c4bd5114) — render the normalized CoverageData as a summary/scorecard layout:
   - overall_score shown as a prominent circular score gauge or large score badge (X/100) with color grading (red/amber/green by threshold); if null, show a neutral 'pending/no score' state instead of 0 or NaN.
   - passed shown as a clear PASS / FAIL pill (green/red) with an icon; if null, show a neutral 'not determined' pill.
   - summary shown as readable prose beneath the score, or a 'No summary provided' placeholder if null.
   - criteria[] rendered as a checklist: each row with a pass/fail check or X icon, the criterion name, and any score/notes. Use a table or list with clear row separation. Never show raw JSON.

=== PER-STAGE PROGRESS CHECKLIST ===
A vertical checklist mapped from block events, shown above or beside the results:
   - Analyzing gaps (gapanalysis / 0f239b6f)
   - Generating recommendations (recommendations / 5ae6657d)
   - Writing enhanced draft (enhancedarticlewriter / 88db1a98)
   - Verifying coverage (coverageverifier / c4bd5114)
   Each item shows pending (dim), in-progress (animated spinner/pulse), done (checkmark). A stage flips to in-progress on its first chunk and to done when the next stage begins or on [DONE]. (Theme Extractor + Competitor Research feed the status chip, not the checklist.)

=== STAGED REVEAL OF PANELS ===
Render each of the four result sections the MOMENT its data starts arriving, not at the end. Cards animate in (fade/slide up) as they populate, and each section header's status pill flips pending → streaming → done. The section order stays fixed even if data arrives out of order.

=== HEARTBEAT/STATUS EVENTS TO A STATUS CHIP, NOT CONTENT ===
Detect heartbeat/progress/status/keepalive events and messages like 'This usually takes 1-2 minutes - 15s elapsed' and route them to a subtle live status chip with a pulsing dot showing current activity + a live elapsed-time counter that ticks every second on the client. NEVER render these (or [DONE]) into the article content or any result card.

=== OPTIMISTIC UI ===
On Enhance click: immediately disable the button, switch it to a loading state, start the elapsed-time chip and the progress checklist right away (before the first byte), and clear/reset previous results (all four sections reset to their pending/skeleton state, including resetting all accumulators and normalized data to their empty defaults). Provide a Cancel button that aborts the fetch via AbortController and restores idle state. On error, show an on-brand error card with a Retry action that re-submits the same inputs.

=== INPUTS / VALIDATION ===
Three inputs with client-side inline validation:
  - Article URL (required, valid-URL check)
  - Article Text (required, non-empty)
  - Content Type (required select: Blog Post / Landing Page / Guide / News / Product Page + an Other free-text option)

=== LAYOUT / THEME ===
No header/nav/footer. Centered single-page max-width container. Considered palette: off-white background, ink-navy text, indigo/violet accent. Fonts: Space Grotesk (headings) + Inter (body). Animated gradient/progress line on the result area while streaming. Each of the four sections is a rounded card with subtle shadow, a clear section header (icon + title + status pill), consistent internal spacing, and clear visual separation between sections. Fully responsive, rounded corners, subtle shadows, visible focus states, respects prefers-reduced-motion. Clean, typed, production-quality React/TypeScript with proper component structure (one component per section) and an error boundary.

=== NON-GOALS ===
No database/persistence needed — this app is stateless (do not require Neon/Prisma). No auth.
