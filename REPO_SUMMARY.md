# Repository Summary: article-enhancer-ui

> Auto-maintained by Sim Development. Last updated: 2026-07-29T14:05:00.307Z.

## Overview

Article Enhancer Agent — article text is now optional, and the Export/Print feature reuses the exact same UI components via a dedicated @media print stylesheet so the PDF matches the on-screen rendering.

**Repository:** `article-enhancer-ui`  
**File count:** 44

## Features

- Optional article text — URL + content type are enough; the agent fetches content from the URL
- Export/Print now prints the SAME React components (ResultCard, CoverageCard, GapAnalysisCard, RecommendationsCard) that render the UI — no separate HTML template
- Dedicated @media print stylesheet: A4 page size with fixed margins, page-break-inside: avoid on cards/rows/list items, repeated table headers (thead as table-header-group), expanded scroll containers, no viewport-relative widths
- UI-only chrome (copy buttons, toggles, sticky tab bar, scrollbars, shadows, animations) removed from print output
- Poppins embedded automatically in print via next/font self-hosted @font-face; print waits for document.fonts.ready before window.print()
- print-color-adjust: exact preserves highlight marks and status colors in the PDF
- Known residual print-vs-UI differences to review: collapsed criteria justifications stay collapsed (matches UI state), box-shadows are intentionally dropped, and the animated streaming gradient/cursor are frozen

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

- **Updated at:** 2026-07-29T14:05:00.307Z
- **Request:** **Note: Don't change the UI**

1)Make the article text non-mandatory 
2)My app renders Article enhancer results in a web UI, and I have a "Export/Print" feature that currently uses a separate/inconsistent rendering path, causing the PDF to look broken compared to the UI (bad spacing, missing fonts, broken tables/cards, no consistent theme).

I want the PDF output to visually match the UI as closely as possible. Please:

Reuse the exact same HTML/CSS component that renders the UI for PDF generation, instead of building a separate PDF template — the goal is "print this view," not "generate new markup."
Add a dedicated @media print stylesheet that:
Fixes container widths (no vw/100% widths that assume a browser viewport) so tables and cards don't overflow or get clipped.
Sets explicit page-break-inside: avoid on cards, table rows, and any block that shouldn't split across pages.
Converts any flex/grid layouts that don't render well in the PDF engine into simpler block/table layouts if needed.
Removes UI-only elements (buttons, hover states, tooltips, scrollbars) that shouldn't appear in the PDF.
Explicitly loads/embeds the same fonts and icon sets used in the UI (as base64 or @font-face with a bundled file), since PDFs often fall back to default system fonts if fonts aren't embedded.
If using a headless-browser-based renderer (e.g., Puppeteer/Playwright), wait for all fonts, images, and dynamic content to fully load (waitUntil: 'networkidle0' or an explicit "ready" signal) before generating the PDF, so nothing is half-rendered.
Set a fixed page size (A4/Letter) and margins, and test long keyword lists/tables specifically for pagination — check that headers repeat on each page if the table spans multiple pages.
After generating, compare the PDF against the UI screenshot for the same data and list any visual differences (spacing, colors, fonts, alignment) so I can review before finalizing.
