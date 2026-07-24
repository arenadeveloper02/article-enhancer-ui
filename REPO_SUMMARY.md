# Repository Summary: article-enhancer-ui

> Auto-maintained by Sim Development. Last updated: 2026-07-24T08:11:43.217Z.

## Overview

Article Enhancer Agent — paste an article, pick a content type, and watch an AI agent enhance it live with streaming Markdown output.

**Repository:** `article-enhancer-ui`  
**File count:** 35

## Features

- Streaming article enhancement with live stage progress
- Gap analysis, recommendations, and coverage verification panels
- Relative link resolution against the submitted article URL with safe plain-text fallback
- Heuristic boilerplate/nav list-block filtering in the rendered enhanced article
- Enhancement request logging via Prisma

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

- `lib/boilerplate.ts`
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
- `lib/boilerplate.ts`
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

- **Updated at:** 2026-07-24T08:11:43.217Z
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


=== FIX: STRIP BOILERPLATE/NAV CONTENT FROM ENHANCED ARTICLE, AND VALIDATE/RESOLVE LINKS ===

1. Link validation (rendering bug): when rendering the Enhanced Article markdown, any link href that is relative (does not start with http:// or https://) must NOT be left as-is or silently broken. Resolve it against the original `article_url` the user submitted (via `new URL(href, article_url).toString()`) so it becomes a valid absolute link, wrapped in try/catch — if resolution fails for any reason, render the link text as plain non-clickable text rather than a dead/broken href. Never pass a bare relative path straight into an `<a href>`.

2. Boilerplate detection (content bug, defensive filter): before rendering, run the accumulated article markdown through a lightweight boilerplate-likelihood check on candidate list blocks: a bullet/numbered list where the majority of items are SHORT (under ~4 words), each item is ONLY a link with no surrounding sentence, and there are more than ~6 such consecutive items, is very likely a nav/footer/location menu, not article content. Flag such a block (console.warn, dev-only) and exclude it from the rendered article rather than displaying it as if it were body copy. This is a heuristic safety net, not a content editor — it should only strip blocks matching this specific pattern, never touch legitimate short lists (e.g. a real 3-5 item bullet list with prose) or single links inline in a paragraph.

3. Scope: this fix touches only the article content pre-processing/rendering step. Do not change tab layout, positions, styling, or any other section.
