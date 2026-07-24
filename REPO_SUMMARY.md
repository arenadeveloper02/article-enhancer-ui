# Repository Summary: article-enhancer-ui

> Auto-maintained by Sim Development. Last updated: 2026-07-24T07:14:17.198Z.

## Overview

Article Enhancer Agent with a full-tab results layout: an always-visible status + pipeline progress top bar with PDF export, four streaming result tabs (Enhanced Article, Coverage Verification, Gap Analysis, Recommendations) with live status indicators, and accurate done/empty stage states.

**Repository:** `article-enhancer-ui`  
**File count:** 34

## Features

- Centered input form for article URL, text, and content type
- Always-visible top bar with live status chip, compact horizontal pipeline progress strip, and Download as PDF button
- Four-tab results area (Enhanced Article, Coverage Verification, Gap Analysis, Recommendations) with sticky, horizontally scrollable tab strip
- Per-tab live status indicators: pending dot, pulsing streaming dot, done checkmark, muted no-data dash, and coverage pass/fail dot
- Background streaming accumulation continues for all sections regardless of active tab
- Stages only flip to done when their normalizer produced real data or the run ended via [DONE]
- Dev-only console warning when the coverage block accumulated content but normalized to the empty default shape
- Whole-output PDF export via print-ready document

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
- `components/InsightTabs.tsx`
- `components/MarkdownRenderer.tsx`
- `components/ProgressChecklist.tsx`
- `components/RecommendationsCard.tsx`
- `components/ResultCard.tsx`
- `components/ResultTabs.tsx`
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
- `components/InsightTabs.tsx`
- `components/MarkdownRenderer.tsx`
- `components/ProgressChecklist.tsx`
- `components/RecommendationsCard.tsx`
- `components/ResultCard.tsx`
- `components/ResultTabs.tsx`
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

- **Updated at:** 2026-07-24T07:14:17.198Z
- **Request:** === PAGE LAYOUT: FULL TABS FOR RESULT SECTIONS, PIPELINE PROGRESS ALWAYS VISIBLE (replaces previous two-column/partial-tab layout) ===
Do NOT split results into a wide article column + narrow sidebar with only Gap Analysis/Recommendations tabbed. Instead:

  - Overall page container: max-w-7xl mx-auto, responsive horizontal padding (px-6 mobile, px-10+ desktop).
  - The INPUT FORM stays a centered card at the top (max-w-3xl mx-auto), same as before.
  - Once results start streaming, render TWO regions stacked vertically:

    1. ALWAYS-VISIBLE TOP BAR (never tabbed, never hidden):
       - The live status chip (elapsed timer + pulsing dot + current activity text).
       - The PIPELINE PROGRESS checklist (Analyzing gaps / Generating recommendations / Writing enhanced draft / Verifying coverage), rendered as a compact horizontal or card-style strip directly below the status chip — this stays visible at all times regardless of which result tab is open, since it's the at-a-glance "is it still working" indicator.
       - The top-level 'Download as PDF' button (per the existing whole-output PDF spec) lives in this same bar.

    2. TABBED RESULTS AREA below the top bar — ONE tab strip with FOUR tabs, one per result section, in this fixed order:
         Tab 1: "Enhanced Article"
         Tab 2: "Coverage Verification"
         Tab 3: "Gap Analysis"
         Tab 4: "Recommendations"
       - Each tab label shows: a status indicator (pending dim dot / in-progress pulsing dot / done checkmark) and, where applicable, a count badge (e.g. Gap Analysis total items, Recommendations count). Coverage Verification's tab shows the PASS/FAIL state as a small colored dot once available.
       - A tab's dot pulses live whenever its section is actively receiving chunks, even if the user is looking at a different tab — so switching away never means missing that something is updating.
       - Switching tabs must NOT interrupt, discard, or pause any section's accumulation — all four keep streaming/accumulating in the background regardless of which tab is active. Only the visible tab's DOM is mounted/shown; the others keep their state.
       - Default active tab on load: "Enhanced Article" (the primary deliverable people came for).
       - Tab panel container: consistent max-width and padding across all four tabs so switching doesn't cause jarring width/height jumps; each panel keeps its own internal scroll if content is long, rather than growing the whole page unbomdedly.
       - Tab strip itself: sticky just below the always-visible top bar on scroll (position: sticky) so users can switch tabs without scrolling back up, respecting prefers-reduced-motion for the active-tab indicator transition.

  - Mobile (narrow viewports): tab strip becomes horizontally scrollable (not wrapped/stacked) so all four tab labels remain reachable without shrinking illegibly; top bar (status chip + pipeline progress + PDF button) stacks vertically above it.

  - Each of the four panels must still individually satisfy every requirement in the RESULTS OUTPUT section (empty/loading/error states, live token rendering for the article, etc.) — this layout section changes only WHERE/HOW they're navigated to, not their content requirements.

=== FIX: COVERAGE VERIFICATION SHOWING EMPTY DESPITE 'DONE' STATUS ===
A stage must only be marked "done" on the Pipeline Progress checklist AND its tab indicator once its normalizer has actually produced non-default data OR the run has genuinely ended via [DONE] with no data ever received for that blockId. Do not let a stage flip to "done" purely because the *next* stage started, if that would visually contradict its own panel state (e.g. showing "done" next to "No score yet / Not determined / No summary provided / No criteria provided" is a broken-looking state). Specifically for Coverage Verification:
  - Log (console.warn, dev-only) when the c4bd5114 accumulator exists but normalizeCoverage() returns the all-null/empty default shape at stream end — this signals the upstream sent unparseable or unexpected JSON for that block, and should be visible during development/debugging rather than silently rendering a fully-empty "done" card.
  - If, after [DONE], a panel's normalized data is still fully at its default/empty shape, its tab status indicator should show a distinct "no data returned" state (e.g. a muted dash icon) rather than a green done-checkmark, so users can visually tell "completed with nothing" apart from "completed successfully."
