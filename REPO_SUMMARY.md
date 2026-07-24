# Repository Summary: article-enhancer-ui

> Auto-maintained by Sim Development. Last updated: 2026-07-24T07:24:59.170Z.

## Overview

Article Enhancer Agent — paste an article, pick a content type, and watch an AI agent enhance it live with streaming Markdown output, gap analysis, recommendations, and coverage verification.

**Repository:** `article-enhancer-ui`  
**File count:** 34

## Features

- Streaming enhanced-article rendering with live Markdown output
- <br> tags rendered as real line breaks, never literal text
- [+ADDED]…[/ADDED] spans rendered as accent-tinted inline highlights with progressive streaming extension
- Clean marker-free 'Copy article' output
- PDF export renders added spans with visual background highlights
- Gap analysis, recommendations, and coverage verification panels
- Pipeline progress checklist with per-stage status

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

- **Updated at:** 2026-07-24T07:24:59.170Z
- **Request:** === FIX: RENDER <br> AS LINE BREAKS, AND [+ADDED]...[/ADDED] AS VISUAL HIGHLIGHTS, NOT LITERAL TEXT ===
The Enhanced Article content may contain two things that must NEVER be shown to the user as raw literal text:

  1. Literal `<br>` (or `<br/>`, `<br />`) tags — these must render as actual line breaks within the paragraph/list item they appear in, not as the visible characters "<br>". Since the content is rendered as Markdown, ensure the markdown renderer is configured to allow this specific safe HTML passthrough (e.g. enable raw HTML rendering for `<br>` tags only via the markdown library's HTML option, or pre-process the accumulated text to convert `<br>`, `<br/>`, `<br />` into actual newline characters — either double newline for a paragraph break or a single trailing-space-plus-newline for a soft break, matching how the source content uses them — before handing the string to the markdown renderer).

  2. `[+ADDED]...[/ADDED]` marker pairs — these denote text the enhancement pipeline added versus the original draft. Do NOT render the literal bracket tokens. Instead:
     - Before markdown parsing, transform every `[+ADDED]...[/ADDED]` span in the accumulated text into a semantic inline highlight (e.g. wrap the inner text in a `<mark>` element or a styled `<span>` with a distinct background) so it renders as visually highlighted "added" text inline with the rest of the paragraph — comparable to a subtle yellow/violet highlighter-pen look, consistent with the app's accent palette (e.g. a soft accent-tinted background with slightly deeper text color, not a jarring color).
     - This transform must work correctly on PARTIAL/STREAMING text too: if `[+ADDED]` has arrived but `[/ADDED]` has not yet streamed in, do not leave a dangling unclosed highlight or crash the renderer — either hold that fragment back until the closing tag arrives, or treat an unclosed `[+ADDED]` at the current streaming boundary as "highlighted from here to the current end of text, extend as more arrives" and close it visually once `[/ADDED]` is seen. Pick the second approach (progressive highlight extension) so the live-typing effect isn't interrupted by buffering.
     - Do the same transform in the 'Copy article' output and the whole-output PDF export, but there, since highlight styling doesn't always translate cleanly: strip the `[+ADDED]`/`[/ADDED]` markers entirely for 'Copy article' (leave clean plain markdown, no visible markers), and in the PDF render the added spans with an actual visual highlight (background shading behind the text) matching the on-screen treatment, not literal brackets.
     - This bracket-to-highlight transform and the `<br>`-to-linebreak transform both happen in a single shared text-preprocessing step (e.g. `preprocessArticleContent()` in `lib/normalize.ts` or a sibling file) applied to the accumulated article string BEFORE it's handed to the markdown renderer on every re-render — not duplicated ad hoc in the component.
     - Under no circumstances should the raw substrings "<br>", "[+ADDED]", or "[/ADDED]" ever appear as visible text anywhere in the rendered article, the copied markdown, or the exported PDF.
