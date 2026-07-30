# Repository Summary: article-enhancer-ui

> Auto-maintained by Sim Development. Last updated: 2026-07-30T05:33:28.491Z.

## Overview

Article Enhancer Agent UI — widened Generator/History containers, real createdAt timestamps in History, full-screen History view with explicit Back and Export, and proper HTML table rendering for markdown tables.

**Repository:** `article-enhancer-ui`  
**File count:** 44

## Features

- Streaming article enhancement with live progress checklist
- Widened centered containers for Generator form and History list
- History runs show real createdAt date/time in readable local format
- History View always opens full-screen with explicit Back button
- Export (print) available in both Generator and History full-screen views
- Markdown tables rendered as real HTML tables with thead/tbody, preserving inline formatting and <br> in cells

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

- **Updated at:** 2026-07-30T05:33:28.491Z
- **Request:** Make the following changes only. Do not change any other styling, colors, spacing, copy, or layout beyond what's explicitly listed below.

1. Widen the containers

Increase the max-width of the main form container (Generator tab: Article URL, Article text, Content type, Enhance article button) — keep it centered, just wider.
Increase the max-width of the History tab container (the "PREVIOUS RUNS" list/cards) to match the same new width as the Generator form.

2. History — date/time

Replace the current "Unknown time" label with the actual date/time, sourced from the createdAt field in the API response for each run.
Format it in a readable local format (e.g., Jul 30, 2026, 10:38 AM) instead of showing the raw ISO string.

3. History — remove collapse, add explicit Back

Remove any collapsible/expand behavior on the history item.
Clicking "View" should always open the run's result in full-screen view (same full-screen behavior as the Enhanced Article view elsewhere in the app).
Inside that full-screen view, add a "Back" button/link that returns the user to the History list — do not rely on browser back or a collapse toggle.

4. Render markdown tables as actual HTML tables

When the article/response content contains markdown table syntax (e.g., lines starting with | and a | --- | separator row), parse and render it as a proper HTML <table> with <thead>/<tbody>, not as raw pipe-delimited text.
This applies wherever article content is displayed — Generator live view, Enhanced Article full-screen view, and History "View" full-screen view.
Preserve bold/inline formatting and <br> line breaks within table cells.

5. Export option in History

Add the same "Export" option/button that exists in the Enhanced Article view (Generator flow) to the History "View" full-screen view as well, with identical functionality (same export format/behavior).

Do not alter: the Generator/History pill toggle, form field labels/placeholders, the "Enhance article" button style, card styling, or any other existing UI element not mentioned above.
