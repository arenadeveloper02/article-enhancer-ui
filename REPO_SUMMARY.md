# Repository Summary: article-enhancer-ui

> Auto-maintained by Sim Development. Last updated: 2026-07-23T14:49:47.022Z.

## Overview

Article Enhancer Agent — paste an article, pick a content type, and watch an AI pipeline analyze gaps, generate recommendations, write an enhanced draft live token-by-token, and verify coverage, with staged panels, a live progress checklist, heartbeat status chip, and cancellable optimistic UI.

**Repository:** `article-enhancer-ui`  
**File count:** 29

## Features

- Live token streaming of the enhanced article rendered as Markdown
- Per-stage pipeline progress checklist (gap analysis → recommendations → writer → verifier)
- Staged reveal of Gap Analysis, Recommendations, Enhanced Article, and Coverage Verification cards as data arrives
- Heartbeat/status events routed to a pulsing status chip with live elapsed timer — never into content
- Optimistic UI with instant loading state, Cancel via AbortController, and Retry on error
- Server-side streaming proxy keeps the API key out of the client bundle

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
- `components/StatusChip.tsx`

### Libraries

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
- `components/StatusChip.tsx`
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

- **Updated at:** 2026-07-23T14:49:47.022Z
- **Request:** Edit the existing Article Enhancer Agent app to make the "Enhance Article" flow feel fully interactive and live while the backend runs (it takes ~1–2 minutes). Implement ALL of the following.

=== SERVER ROUTE /api/enhance ===
Keep the API key hardcoded SERVER-SIDE ONLY (never in the client bundle):
  const SIM_API_KEY = 'sk-sim-T8eEbhp_o3qI01OEp5Ok_VdiwR4Q6Fht';
Proxy to:
  POST https://test-agent.thearena.ai/api/workflows/9aafe5d7-1d24-477a-ad3f-0be9bf79c04f/execute
  Headers: { 'X-API-Key': SIM_API_KEY, 'Content-Type': 'application/json' }
  Body (JSON): {
    article_url: <article_url>,
    article_text: <article_text>,
    content_type: <content_type>,
    stream: true,
    selectedOutputs: [
      'recommendations.recommendations',
      'enhancedarticlewriter.content',
      'coverageverifier.criteria',
      'gapanalysis.competitor_strengths',
      'gapanalysis.coverage_gaps',
      'gapanalysis.underdeveloped_sections',
      'coverageverifier.overall_score',
      'coverageverifier.passed',
      'coverageverifier.summary'
    ]
  }
The route MUST stream: read the upstream response body as a ReadableStream and pipe/forward the chunks straight through to the client (Content-Type: text/event-stream, no buffering, no await res.json()). Support a non-streamed JSON fallback if the upstream returns application/json. Never call res.json() on the whole thing before responding — that is what makes the button feel frozen.

=== CLIENT: consume the stream ===
The client form calls ONLY the local /api/enhance route. Use fetch + response.body.getReader() to read the SSE/chunked stream incrementally and update the UI as chunks arrive. Parse SSE lines (data: ...), tolerate partial chunks across reads (buffer until newline).

Apply ALL FIVE UX behaviors:

1) LIVE TOKEN RENDERING — as enhancedarticlewriter.content tokens arrive, append them progressively into the result card so the enhanced article visibly types out in real time (render as Markdown; re-render on each chunk). No waiting for the full payload.

2) PER-STAGE PROGRESS CHECKLIST — show a vertical checklist of the pipeline stages mapped from the streamed block events / selectedOutputs keys:
   - Analyzing gaps (gapanalysis)
   - Generating recommendations (recommendations)
   - Writing enhanced draft (enhancedarticlewriter)
   - Verifying coverage (coverageverifier)
   Each item shows: pending (dim), in-progress (animated spinner/pulse), done (checkmark). Advance a stage to done when that block's output arrives in the stream; mark the next as in-progress.

3) STAGED REVEAL OF PANELS — render each result section in its own card the moment its data arrives, not at the end:
   - Gap Analysis card (competitor_strengths, coverage_gaps, underdeveloped_sections as lists)
   - Recommendations card (recommendations list, ordered/prioritized)
   - Enhanced Article card (the live-typed markdown from #1)
   - Coverage Verification card (overall_score as a score badge/gauge, passed as a pass/fail pill, summary text, criteria list)
   Cards animate in (fade/slide) as they populate.

4) ROUTE HEARTBEAT/STATUS EVENTS TO A STATUS CHIP, NOT THE CONTENT — detect heartbeat/progress/status/keepalive events and any messages like 'This usually takes 1–2 minutes · 15s elapsed' and DO NOT render them into the article content or any result card. Instead feed them into a subtle live status chip with a pulsing dot showing the current activity + a live elapsed-time counter (ticking every second on the client). Also decode any raw unicode escape sequences (e.g. \u2013) into real characters everywhere before display, whether they arrive as valid JSON or double-escaped plain text.

5) OPTIMISTIC UI — on click of Enhance Article: immediately disable the button, switch it to a loading state, start the elapsed-time chip and the progress checklist right away (before the first byte returns), and clear/reset any previous results. Provide a Cancel button that aborts the fetch via AbortController and restores the idle state. On error, show the on-brand error card with a Retry action (re-submits the same inputs).

Keep the existing layout/theme constraints intact: no header/nav/footer, centered single-page max-width container, considered palette (off-white bg, ink-navy text, indigo/violet accent), Space Grotesk + Inter fonts, animated gradient/progress line on the result card while streaming, responsive, rounded corners, subtle shadows, visible focus states, respects reduced-motion. Keep the three inputs (Article URL required, Article Text required, Content Type required select with Blog Post/Landing Page/Guide/News/Product Page + Other free-text) with client-side inline validation. Clean, typed, production-quality React/TypeScript with proper component structure and error boundaries.
