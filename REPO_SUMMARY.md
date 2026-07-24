# Repository Summary: article-enhancer-ui

> Auto-maintained by Sim Development. Last updated: 2026-07-24T08:00:17.179Z.

## Overview

Paste an article, pick a content type, and watch an AI agent enhance it live with streaming Markdown output, gap analysis, recommendations, and coverage verification.

**Repository:** `article-enhancer-ui`  
**File count:** 34

## Features

- Streaming article enhancement with live Markdown rendering
- Gap analysis and recommendations panels
- Coverage verification with per-criterion score and expandable justification
- Pipeline progress checklist
- Printable export of all results

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

- **Updated at:** 2026-07-24T08:00:17.179Z
- **Request:** === SCOPE LOCK: BUG-FIX-ONLY MODE ===
This is a bug-fix request, not a redesign request. Apply ONLY the specific fix(es) described below. Do not use this as an opportunity to also improve, refactor, reposition, restyle, resize, reorder, rename, or "clean up" anything else in the app, even if you notice something else that looks improvable while you're in there.

Hard rules for this change:
  1. Touch ONLY the code paths directly responsible for the bug(s) described below. If a fix requires touching a shared file (e.g. lib/normalize.ts, a shared Tabs component), edit only the specific function/section relevant to the bug — do not reformat, restructure, or "tidy" the rest of that file.
  2. Do NOT change: layout structure, column/grid arrangement, tab order or grouping, section placement, spacing/padding values, colors, fonts, component hierarchy, or any element's position — UNLESS the bug report explicitly describes a layout/position/style problem. If it doesn't mention position or visuals, assume position and visuals are correct and untouchable.
  3. Do NOT rename existing variables, interfaces, props, functions, or files as a "improvement" side-effect of the fix. Keep every existing name exactly as-is unless the bug itself is a naming/type mismatch.
  4. Do NOT add new UI elements, badges, states, animations, or copy changes beyond what's minimally needed to fix the described behavior. If the fix requires a new state (e.g. an error state), keep its visual style consistent with existing patterns already in the app rather than introducing a new visual language.
  5. If fixing the bug seems to require a layout or design change to work correctly, STOP and flag this explicitly back to me before making that change — don't silently decide a bigger change is "better" and do it anyway.
  6. After making the fix, do a mental diff: everything in the UI that was NOT mentioned in the bug report should look and behave pixel-identical to before. If you can't be sure of that, say so rather than assuming it's fine.

Bug(s) to fix in this change (and ONLY these):

- Inside the coverage verification page, currently its showing name and score. Can we also show the Justification as wel?
Justification can show only if the user wants to see . Give a small cursor which can be expand and collapse
