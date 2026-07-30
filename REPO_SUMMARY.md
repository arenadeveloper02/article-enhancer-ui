# Repository Summary: article-enhancer-ui

> Auto-maintained by Sim Development. Last updated: 2026-07-30T12:14:09.863Z.

## Overview

Streaming Article Enhancer UI: paste an article URL, pick a content type, and watch gap analysis, recommendations (citations, FAQs, recommendations), the enhanced article, and coverage verification stream in live.

**Repository:** `article-enhancer-ui`  
**File count:** 44

## Features

- Streaming enhancement pipeline with live progress checklist
- Enhanced article rendered as formatted Markdown with added-content highlights
- Gap Analysis tab (competitor strengths, coverage gaps, underdeveloped sections)
- Recommendations tab with Citation Opportunities, FAQ Suggestions and Recommendations sections
- Coverage verification with score ring, pass/fail and criteria justifications
- History view backed by the build-history workflow with print/PDF export

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

- **Updated at:** 2026-07-30T12:14:09.863Z
- **Request:** Make the following changes only. Do not change any other styling, colors, spacing, copy, or layout beyond what's explicitly listed below.


Verify the API 

curl -X POST \
  -H "X-API-Key: use the same API key " \
  -H "Content-Type: application/json" \
  -d '{"article_url":"example","article_text":"example","content_type":"example","email":"example","stream":true,"selectedOutputs":["coverageverifier.citations_count","coverageverifier.citations_found","coverageverifier.criteria","coverageverifier.faq_added","coverageverifier.faq_questions_added","coverageverifier.overall_score","coverageverifier.passed","coverageverifier.summary","enhancedarticlewriter.content","recommendations.citation_opportunities","recommendations.faq_suggestions","recommendations.recommendations","gapanalysis.competitor_strengths","gapanalysis.coverage_gaps","gapanalysis.underdeveloped_sections"]}' \
  https://agent.thearena.ai/api/workflows/03418966-7c53-40da-86ea-597e9926e302/execute



the problem is with the citation_opportunities and faq_suggestions the data is not coming once the user click on Enhance article ... .. 
reset all data is fyn only these citation_opportunities and faq_suggestions  is not coming ... just verify the 
recommendations tab ... the 3 sections ... 
rrecommendations.citation_opportunities","recommendations.faq_suggestions","recommendations.recommendations"
