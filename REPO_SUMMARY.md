# Repository Summary: article-enhancer-ui

> Auto-maintained by Sim Development. Last updated: 2026-08-06T11:01:03.796Z.

## Overview

Arena-embedded Article Enhancer UI: paste an article URL or text, pick a content type, and stream an enhanced article with gap analysis, recommendations, and coverage verification.

**Repository:** `article-enhancer-ui`  
**File count:** 45

## Features

- Streaming article enhancement with live status and progress checklist
- Tabbed results: Enhanced Article, Coverage Verification, Gap Analysis, Recommendations
- History view backed by the build-history workflow with createdAt enrichment from Prisma
- Print/PDF export mirror that reuses the on-screen components
- Arena email gate via middleware cookie and access-denied page

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
- `lib/format.ts`
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
- `lib/format.ts`
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

- **Updated at:** 2026-08-06T11:01:03.796Z
- **Request:** ## Output formatting (presentation only — do not change content selection, tone, or task behavior)

Keep the same substance and structure of what you already produce. Change only how it is rendered.

### Prefer structured markdown over paragraphs
- Do not flatten lists into prose. If the source has bullets, numbered steps, key takeaways, or distinct points, render them as real markdown lists (`-` or `1.`), not as comma-/semicolon-separated sentences inside a paragraph.
- Use short headings (`##` / `###`) to separate sections when the content has clear parts.
- Use paragraphs only for true narrative prose. Prefer list + heading layout whenever the material is point-based.
- Apply this the same way for published URLs and unpublished/draft/pasted article text. Source type must not change formatting quality.

### Preserve tables
- If the source contains a table (or tabular comparison: rows/columns, matrix, schedule, specs), reproduce it as a markdown table.
- Do not convert tables into paragraphs, bullet lists, or prose summaries unless the user explicitly asks for a summary instead of the table.
- Keep column headers and row alignment; omit a table only if the source truly has none.

### Show data only in relevant sections
- Place each piece of content only under the section it belongs to. Do not repeat the same facts, lists, or tables across unrelated sections.
- Do not dump mixed or leftover content into a catch-all paragraph. If something does not fit a section, omit it or put it only where it is relevant.
- Keep each section focused: one topic per section; no cross-section bleed of unrelated points.

### No JSON in the UI
- Never show raw JSON, JSON code blocks, or JSON-looking key/value dumps in the user-facing output.
- If you need structured data, render it as readable markdown: headings, bullets, numbered lists, or tables.
- Do not expose internal payloads, API responses, metadata objects, or debug structures in the UI.

### Enhanced Article layout and width usage
- This output is shown in the Enhanced Article tab. Structure it so it uses the full content width, not a narrow left-only column of paragraphs.
- Prefer width-friendly structure:
  - Comparison content → markdown tables (full width)
  - Types, options, steps, criteria → bulleted or numbered lists
  - Distinct topics → clear `##` / `###` headings with short sections
- Avoid long wall-of-text paragraphs when the material is comparative or list-like (e.g. sedation types should be a table or sectioned lists, not one dense paragraph).
- Do not leave large empty regions by dumping everything into a single narrow prose block. Distribute content across sections, lists, and tables that read clearly across the available width.
- Still show each piece of data only in its relevant section; do not fill space with repeated or unrelated content.


### No broken text
- Output must be complete, readable, and well-formed. No truncated sentences, cut-off mid-word text, or unfinished lists/tables.
- No broken markdown: unclosed bold/italic, orphan bullets, half-rendered tables, or fragmented headings.
- No garbled characters, duplicated fragments, or glued-together words from poor parsing.
- If source text is messy, clean and reconstruct it into coherent markdown; do not pass broken fragments through to the UI.

### Punctuation
- Do not use em dashes (—) or en dashes (–) as clause separators.
- Prefer commas, periods, colons, parentheses, or a short new sentence instead.
- Hyphens in compound words (e.g. "well-known") are fine.

### Non-goals (do not change)
- Do not alter what content you include or exclude beyond formatting rules above.
- Do not change voice, length targets, sections, or other existing behaviors unless required to apply these formatting rules.
