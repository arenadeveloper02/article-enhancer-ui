# Repository Summary: article-enhancer-ui

> Auto-maintained by Sim Development. Last updated: 2026-07-28T12:01:30.469Z.

## Overview

Article Enhancer Agent — paste an article, pick a content type, and watch an AI agent enhance it live with streaming output. This edit fixes the 'data arrives but never renders' bug by making the stream client tolerant of every upstream payload shape: dotted selected-output keys (e.g. gapanalysis.coverage_gaps, enhancedarticlewriter.content), nested output/result/data envelopes, non-streamed JSON fallbacks, unrouted chunks, and a final raw-transcript salvage pass — panels now populate as soon as usable data appears anywhere in the stream.

**Repository:** `article-enhancer-ui`  
**File count:** 40

## Features

- Streaming article enhancement with live Markdown rendering
- Tolerant stream parser: per-block chunks, dotted output keys, nested final outputs, JSON fallback, transcript salvage
- Gap analysis, recommendations, and coverage verification panels
- Pipeline progress checklist and live status chip
- Export / print of the full enhancement report
- Arena email gate with access-denied page

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

### Components

- `components/CoverageCard.tsx`
- `components/EnhancerClient.tsx`
- `components/ErrorCard.tsx`
- `components/GapAnalysisCard.tsx`
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

- **Updated at:** 2026-07-28T12:01:30.469Z
- **Request:** the data is coming but its not getting rendered in the UI 

curl 'https://article-enhancer-ui.vercel.app/api/enhance' \
  -H 'accept: */*' \
  -H 'accept-language: en-GB,en-US;q=0.9,en;q=0.8,kn;q=0.7' \
  -H 'content-type: application/json' \
  -b 'arena_email_id=anush.ms%40position2.com' \
  -H 'origin: https://article-enhancer-ui.vercel.app' \
  -H 'priority: u=1, i' \
  -H 'referer: https://article-enhancer-ui.vercel.app/?emailId=anush.ms%40position2.com' \
  -H 'sec-ch-ua: "Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"' \
  -H 'sec-ch-ua-mobile: ?0' \
  -H 'sec-ch-ua-platform: "macOS"' \
  -H 'sec-fetch-dest: empty' \
  -H 'sec-fetch-mode: cors' \
  -H 'sec-fetch-site: same-origin' \
  -H 'sec-fetch-storage-access: active' \
  -H 'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36' \
  --data-raw '{"article_url":"https://www.gentledental.com/resources/articles/tooth-sensitivity","article_text":"Sharp, sudden tooth pain can truly be a nuisance to experience and is more common than you may think. Tooth sensitivity may temporarily occur when exposed to triggers like cold air, or foods and beverages that are hot, cold, sweet, or acidic. It commonly occurs due to worn tooth enamel or gum recession from issues like decay/cavities, gum disease, aggressive toothbrushing, teeth grinding, or acidic diets. The good news is that there are several tooth sensitivity treatment options to stop the pain, for good. In this blog, we explore sensitive teeth causes, remedies, and solutions.","content_type":"Landing Page"}'
