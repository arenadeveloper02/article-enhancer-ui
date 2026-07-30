# Repository Summary: article-enhancer-ui

> Auto-maintained by Sim Development. Last updated: 2026-07-30T06:43:15.771Z.

## Overview

Article Enhancer Agent UI with full-screen result tabs (Enhanced Article, Coverage Verification, Gap Analysis, Recommendations with Citation Opportunities and FAQ Suggestions sections), streaming enhancement pipeline, and history view.

**Repository:** `article-enhancer-ui`  
**File count:** 44

## Features

- Full-screen result tabs for every section with a single Back action (no collapsible layout)
- Recommendations tab renders Citation Opportunities and FAQ Suggestions as dedicated sections
- Live streaming enhancement pipeline with progress checklist and status chip
- History view mirroring the same tabbed result format
- Print/PDF export reusing the exact on-screen components

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

- **Updated at:** 2026-07-30T06:43:15.771Z
- **Request:** Make the following changes only. Do not change any other styling, colors, spacing, copy, or layout beyond what's explicitly listed below.



In the view option or after running enhance article CTA,
 As the Enhanced Article tab is full screen, make all the tabs full screen ... 

Don't give the Collapsible option. 
Just give back option ... 
|

FOr the post request 

curl -X POST \
  -H "X-API-Key: $SIM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"article_url":"example","article_text":"example","content_type":"example","email":"example","stream":true,"selectedOutputs":["enhancedarticlewriter.content","coverageverifier.citations_count","coverageverifier.citations_found","coverageverifier.criteria","coverageverifier.faq_added","coverageverifier.faq_questions_added","coverageverifier.overall_score","coverageverifier.passed","coverageverifier.summary","recommendations.citation_opportunities","recommendations.faq_suggestions","recommendations.recommendations","gapanalysis.competitor_strengths","gapanalysis.coverage_gaps","gapanalysis.underdeveloped_sections"]}' \
  https://agent.thearena.ai/api/workflows/03418966-7c53-40da-86ea-597e9926e302/execute


recommendations.citation_opportunities
recommendations.faq_suggestions

these should come as a section in the recommendations tab.
