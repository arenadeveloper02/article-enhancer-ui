# Repository Summary: article-enhancer-ui

> Auto-maintained by Sim Development. Last updated: 2026-07-30T10:37:28.238Z.

## Overview

Article Enhancer UI — paste an article URL, stream an AI-enhanced version live with gap analysis, recommendations, and coverage verification, plus a history view of previous runs.

**Repository:** `article-enhancer-ui`  
**File count:** 44

## Features

- Streaming article enhancement with live progress checklist
- Equal-width workflow tab navigation with no horizontal scroll
- Gap analysis, recommendations, and coverage verification panels
- History view of previous runs with the same tabbed result layout
- Print/PDF export mirror of on-screen results
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

- **Updated at:** 2026-07-30T10:37:28.238Z
- **Request:** Redesign the Article Enhancer History page to improve the desktop layout and eliminate unnecessary whitespace while keeping all existing functionality intact.

Requirements:

## 1. Increase Content Width
- Increase the main content container from its current width to approximately 90-92% of the viewport.
- Use a max-width between 1550px and 1650px.
- Reduce the excessive left and right margins.
- Every major section should align to the same width:
  - Header
  - URL Card
  - Progress Navigation
  - Recommendations
  - Footer

Do NOT make the page full width.

----------------------------------------------------

## 2. Fix Header Alignment

The top portion currently has too much whitespace.

Update it so that:

- The page title remains centered.
- The description is centered with a maximum width of 700-800px.
- Reduce vertical spacing above and below the title.
- Align the Generator/History toggle with the main content width.
- Keep consistent spacing between:
    Title
    Description
    Toggle
    URL Card

The page should feel balanced and compact.

----------------------------------------------------

## 3. Remove the Horizontal Scrollbar

The workflow navigation currently requires horizontal scrolling.

Remove the horizontal scrollbar completely.

Requirements:

- Display all workflow steps in one row on desktop.
- Use CSS Grid or Flexbox.
- Each step should share equal width.
- The workflow should automatically resize to fit available space.
- Do NOT use overflow-x.
- Do NOT create a scrollable container.

Workflow should look like:

✓ Enhanced Article
✓ Coverage Verification
✓ Gap Analysis (25)
✓ Recommendation

On smaller screens the layout may wrap into multiple rows.

----------------------------------------------------

## 4. Improve Workflow Layout

Current layout feels compressed.

Redesign it as:

--------------------------------------------------
| Enhanced | Coverage | Gap | Recommendation |
--------------------------------------------------

The selected step should remain visually highlighted.

Maintain all existing click functionality.

----------------------------------------------------

## 5. Improve Action Buttons

Move Export and Back so they no longer compete visually with the workflow.

Either:

Option A:
Place them right-aligned on the same row.

or

Option B:
Move them into the URL card.

Buttons should be secondary actions.

Reduce their overall size.

----------------------------------------------------

## 6. Improve Recommendations Layout

Expand the Recommendations container to use the newly available width.

Benefits:

- Reduce line wrapping.
- Increase readability.
- Keep consistent padding (32-40px).

Do not change any business logic.

----------------------------------------------------

## 7. Improve Overall Spacing

Use a consistent spacing system.

Recommended spacing:

Top Header:
48px

Between Header and URL Card:
32px

Between URL Card and Workflow:
20px

Between Workflow and Recommendation:
24px

Section Padding:
32-40px

Card Radius:
16-20px

----------------------------------------------------

## 8. Responsive Design

Desktop:
1550-1650px max width

Tablet:
90% width

Mobile:
100% width

Workflow should wrap naturally on smaller screens.

There must never be a horizontal scrollbar.

----------------------------------------------------

## 9. Preserve Existing Functionality

Do NOT modify:

- API calls
- State management
- Data fetching
- Recommendation logic
- Export functionality
- Navigation
- History loading

Only update the UI layout and styling.

----------------------------------------------------

## 10. Design Style

Maintain the existing premium SaaS design.

Use:

- Large clean cards
- Soft shadows
- 16-20px border radius
- Consistent spacing
- Proper visual hierarchy
- Minimalistic interface similar to Linear, Vercel, OpenAI Dashboard, or Notion.

The page should feel significantly wider, cleaner, and easier to scan while eliminating unnecessary whitespace and removing the horizontal scrolling experience.


CRITICAL:
Make sure that ONLY the above changes are done. Dont make any other Changes
