# Repository Summary: article-enhancer-ui

> Auto-maintained by Sim Development. Last updated: 2026-07-30T06:03:27.137Z.

## Overview

Streamed AI article enhancement UI with gap analysis, recommendations (including citation opportunities and FAQ suggestions), coverage verification, and persisted run history timestamps.

**Repository:** `article-enhancer-ui`  
**File count:** 44

## Features

- Streaming article enhancement with live panel updates
- Gap analysis, recommendations, and coverage verification tabs
- Citation opportunities and FAQ suggestions surfaced as recommendation entries
- History view with persisted createdAt timestamps formatted as local date/time
- PDF/print export mirroring the on-screen UI

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
- `/access-denied` — `app/access-denied/page.tsx`

## Database Models

- `EnhancementLog`

## File Inventory

### App pages

- `app/access-denied/page.tsx`
- `app/arena-ds-tokens.css`
- `app/error.tsx`
- `app/globals.css`
- `app/layout.tsx`
- `app/not-found.tsx`
- `app/page.tsx`

### API routes

- `app/api/enhance/route.ts`
- `app/api/history/route.ts`

### Components

- `components/CoverageCard.tsx`
- `components/EnhancerClient.tsx`
- `components/ErrorCard.tsx`
- `components/GapAnalysisCard.tsx`
- `components/HistoryClient.tsx`
- `components/HomeTabsClient.tsx`
- `components/InsightTabs.tsx`
- `components/MarkdownRenderer.tsx`
- `components/PrintableReport.tsx`
- `components/ProgressChecklist.tsx`
- `components/RecommendationsCard.tsx`
- `components/ResultCard.tsx`
- `components/ResultTabs.tsx`
- `components/SectionHeader.tsx`
- `components/StageChecklist.tsx`
- `components/StatusChip.tsx`
- `components/arena-email-provider.tsx`

### Libraries

- `lib/arena-email-constants.ts`
- `lib/arena-email.ts`
- `lib/boilerplate.ts`
- `lib/normalize.ts`
- `lib/prisma.ts`
- `lib/stream.ts`
- `lib/types.ts`
- `prisma/schema.prisma`

### Config

- `.env.example`
- `middleware.ts`
- `next-env.d.ts`
- `next.config.ts`
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
- `app/access-denied/page.tsx`
- `app/api/enhance/route.ts`
- `app/api/history/route.ts`
- `app/arena-ds-tokens.css`
- `app/error.tsx`
- `app/globals.css`
- `app/layout.tsx`
- `app/not-found.tsx`
- `app/page.tsx`
- `components/CoverageCard.tsx`
- `components/EnhancerClient.tsx`
- `components/ErrorCard.tsx`
- `components/GapAnalysisCard.tsx`
- `components/HistoryClient.tsx`
- `components/HomeTabsClient.tsx`
- `components/InsightTabs.tsx`
- `components/MarkdownRenderer.tsx`
- `components/PrintableReport.tsx`
- `components/ProgressChecklist.tsx`
- `components/RecommendationsCard.tsx`
- `components/ResultCard.tsx`
- `components/ResultTabs.tsx`
- `components/SectionHeader.tsx`
- `components/StageChecklist.tsx`
- `components/StatusChip.tsx`
- `components/arena-email-provider.tsx`
- `lib/arena-email-constants.ts`
- `lib/arena-email.ts`
- `lib/boilerplate.ts`
- `lib/normalize.ts`
- `lib/prisma.ts`
- `lib/stream.ts`
- `lib/types.ts`
- `middleware.ts`
- `next-env.d.ts`
- `next.config.ts`
- `package.json`
- `postcss.config.mjs`
- `prisma/schema.prisma`
- `tailwind.config.ts`
- `tsconfig.json`

## Latest Change

- **Updated at:** 2026-07-30T06:03:27.137Z
- **Request:** Make the following backend/frontend changes only. Do not change any other logic, styling, or response fields beyond what's listed below.

1. Add createdAt to the history response

The endpoint GET /api/history (called from https://article-enhancer-ui.vercel.app/api/history) currently does not return a createdAt field per run, which is why the UI falls back to showing "Unknown time".
When a workflow run is triggered via https://agent.thearena.ai/api/workflows/38458816-0871-4c2f-8545-39654a5530cc/execute, that execution response already includes a createdAt timestamp. Persist this createdAt value when the run is saved/logged (e.g., in the DB record or cache entry for that run), and include it in the /api/history response payload for each item, e.g.:
json
{
  "url": "https://www.gentledental.com/resources/articles/tooth-sensitivity",
  "type": "Landing Page",
  "createdAt": "2026-07-30T05:08:00.000Z",
  ...
}
On the frontend, replace the "Unknown time" label with this createdAt value, formatted as a readable local date/time (e.g., Jul 30, 2026, 10:38 AM) instead of the raw ISO string.

2. Surface additional recommendation fields from the second workflow

The workflow https://agent.thearena.ai/api/workflows/03418966-7c53-40da-86ea-597e9926e302/execute returns additional keys under recommendations that are currently not being read or displayed:
recommendations.citation_opportunities
recommendations.faq_suggestions
Update the response parsing/mapping layer to pick up these two keys (in addition to whatever is already being read from recommendations) and pass them through to the frontend.
In the Recommendations section of the UI, render these as additional entries/rows alongside the existing recommendation items — same list/card style already used for existing recommendation entries, no new UI pattern. If citation_opportunities or faq_suggestions is an array of objects, display each object's fields consistent with how other recommendation items are currently displayed (e.g., title + description), so it doesn't need a new layout.
If either key is missing or empty in the response, don't render an empty section — same behavior as if other recommendation types were empty.

Do not alter any other field mapping, tab layout, or existing recommendation types already being displayed.
