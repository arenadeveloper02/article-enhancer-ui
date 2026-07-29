# Repository Summary: article-enhancer-ui

> Auto-maintained by Sim Development. Last updated: 2026-07-29T13:44:54.909Z.

## Overview

Article Enhancer Agent UI with streaming enhancement results and a History view backed by the Arena build-history workflow.

**Repository:** `article-enhancer-ui`  
**File count:** 43

## Features

- Streaming article enhancement with live progress checklist
- Gap analysis, recommendations, and coverage verification tabs
- History view of previous runs fetched per Arena email
- Read-only viewing of past generated outputs
- Export / print of the full enhancement output

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

- **Updated at:** 2026-07-29T13:44:54.909Z
- **Request:** Add a "History" section to this Article Recommendation Agent tool. Requirements:

1. Location & trigger: Add a "History" button/tab in the header area (next to or near the title) that toggles between the main "Generator" view and a "History" view.
2. What gets saved: Every time the user clicks "Get Recommendations" and a result is generated, save a history entry containing:
- Target Keyword
- Client / Brand
- Timestamp (date + time of generation)
- The full generated output (the H1, headings, and article recommendations)
3. History view UI:
Show entries as a reverse-chronological list (newest first), each as a card showing: keyword, client, timestamp, and a short preview of the H1/title generated.
Each card should have:
- A "View" button/click action that loads that entry's full output back into the main results view (read-only, non-editable)
If there's no history yet, show an empty state message like "No previous runs yet — generate your first recommendation to see it here."
4. Persistence: Store history using in-memory React state (use useState/array), since browser storage isn't available in this environment. Note in a comment that this resets on page reload, and if the user wants persistence across sessions, they'd need to connect a backend/database.
5. Styling: Match the existing design — same rounded cards, purple/indigo accent color, clean spacing, and typography already used in the tool.

Keep the existing Generator view and functionality fully intact — just add History as an additional view/tab.

History : 

curl -X POST \
  -H "X-API-Key: use the same key " \
  -H "Content-Type: application/json" \
  -d '{"email":"example","type":"article_enhancer","stream":false,"selectedOutputs":["buildhistory.result"]}' \
  https://agent.thearena.ai/api/workflows/38458816-0871-4c2f-8545-39654a5530cc/execute


and in the 
API 
 https://agent.thearena.ai/api/workflows/03418966-7c53-40da-86ea-597e9926e302/execute

Add email in the payload
