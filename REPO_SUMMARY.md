# Repository Summary: article-enhancer-ui

> Auto-maintained by Sim Development. Last updated: 2026-08-06T12:09:17.680Z.

## Overview

Article Enhancer UI — paste an article URL or text, pick a content type, and watch an AI agent stream back an enhanced article with gap analysis, recommendations, and coverage verification.

**Repository:** `article-enhancer-ui`  
**File count:** 45

## Features

- Streaming enhanced-article generation with live progress checklist
- Gap analysis, recommendations, and coverage verification tabs
- History view backed by the build-history workflow
- Print/PDF export mirroring the on-screen UI
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

- **Updated at:** 2026-08-06T12:09:17.680Z
- **Request:** **CRITICAL: Don't change any Other functionality or UI other than the below-mentioned points.

0) Article enhancer tab after generating the response its showing this way: manage the data 
6 [{"claim":"A national survey of 494 Indian dentists found sterilization methods vary considerably, with about 53.8% reporting boiling water and 53.8% reporting autoclaving, while 93.5% agreed universal precautions should apply to every patient.","source_name":"Current biomedical waste management practices and cross-infection control procedures of dentists in India","source_url":"https://pmc.ncbi.nlm.nih.gov/articles/PMC9374936/"},{"claim":"A pilot study of Indian dental clinicians found awareness of updated infection-control protocols is around 90%, while actual implementation was closer to 61% in some reports.","source_name":"Assessing the Compliance of Dental Clinicians towards Regulatory Infection Control Guidelines Using a Newly Developed Survey Tool: A Pilot Cross-Sectional Study in India","source_url":"https://www.mdpi.com/2227-9032/10/10/1877"},{"claim":"India's Ministry of Health and Family Welfare operational guidelines call for timely sterilization of instruments, maintained clinic cleanliness, and proper bio-medical waste management as core components of quality dental care delivery.","source_name":"Operational Guidelines for Oral Health Care at Health and Wellness Centres","source_url":"https://aam.mohfw.gov.in/download/document/Oral_Health_(Inner)-Brown(FINAL).pdf"},{"claim":"A systematic review found limited access to dental facilities, long wait times, and inadequate infrastructure reduce dental care utilization in India, while availability of private clinics helps enable access.","source_name":"Factors influencing dental care services utilization in India using Andersen health behaviour model: a systematic review","source_url":"https://link.springer.com/article/10.1186/s12913-025-13252-0"},{"claim":"A meta-analysis found pooled dental care utilization in India at about 24%, with the South Zone showing the highest regional utilization at roughly 30%.","source_name":"Utilization of dental care services among adult Indian population: A meta-analysis of evidence from 2011 to 2022","source_url":"https://pmc.ncbi.nlm.nih.gov/articles/PMC9958237/"},{"claim":"Aseptic and sterilization-conscious protocols are aligned with standards recommended in national infection-control guidelines for Indian dental practices.","source_name":"Operational Guidelines for Oral Health Care at Health and Wellness Centres","source_url":"https://aam.mohfw.gov.in/download/document/Oral_Health_(Inner)-Brown(FINAL).pdf"}] [{"justification":"Most major gaps were addressed: services, doctor credentials, second doctor, phone, timings, sterilization detail, FAQ, differentiation, landmark/directions, ratings mention, and emergency mention. Still weak or incomplete on parking/accessibility specifics, broken map not truly fixed in-page, pricing transparency remains partial, and testimonials appear likely fabricated/unattributed.","name":"gap_coverage","score":85},{"justification":"The original article content appears preserved in place, with additions appended rather than replacing/deleting existing text.","name":"original_preserved","score":98},{"justification":"All visible new substantive additions are wrapped in ... blocks.","name":"additions_marked","score":100},{"justification":"Research citations use allowed sources, but several non-research factual additions lack attribution or rely on competitor/directory claims without inline source links: doctor experience/credentials, phone number, Practo rating/review count, fee range, Sunday timing comparison, and quoted testimonials. The three patient quotes appear invented or at least unsourced. There are also vague claims like 'served the community for years.'","name":"factual_grounding","score":52},{"justification":"Additions generally match the informational local-listing style and markdown structure, though some sections are more editorial/research-heavy than the original and slightly overextended for a clinic profile.","name":"tone_consistency","score":82},{"justification":"A clear FAQ section was added with 8 Q&A pairs, covering all suggested questions with real answers.","name":"faq_added","score":100},{"justification":"The enhanced article includes multiple genuine inline citations with links to authoritative sources from the allowed list. However, some important non-research claims still lack inline citations.","name":"citations_added","score":90}] true ["What dental services does Gentle Dental in Chandra Layout offer?","Does Gentle Dental have a second dentist besides Dr. Arvind and Dr. Anitha?","What is the consultation fee at Gentle Dental Chandra Layout?","What are Gentle Dental's Sunday timings?","Is Gentle Dental good for emergency dental treatment?","How do I contact Gentle Dental to book an appointment?","Is Gentle Dental clinic accessible by public transport or does it have parking?","How many patients have reviewed Gentle Dental and what is its rating?"] 87 true The enhancement substantially improves coverage and includes a strong FAQ plus multiple authoritative inline citations. Original content was preserved and additions were properly marked. The main quality issue is factual grounding: several clinic-specific claims are not attributed inline, and the added testimonial quotes appear unsupported. Despite that, the article meets the pass threshold because it has robust gap coverage, a qualifying FAQ, and at least 3 inline citations.

1) ### Preserve tables

- If the source contains a table (or tabular data: rows/columns, matrix,
  comparison, schedule, specs), reproduce it as a single markdown table —
  never as paragraphs, prose, or standalone bullet lists.

- One source row = one markdown table row. Never split a single row's
  content into multiple rows.

- One source cell = one markdown table cell. If a cell contains multiple
  items (a bullet list, multiple lines, multiple facts), keep them INSIDE
  that one cell by joining them with "<br>" — do NOT let them break out
  into separate rows or top-level bullets outside the table.

- Every row must have the same number of columns as the header row. If a
  value is missing, leave that cell blank — never shift other columns to
  compensate.

- Do not merge, reorder, or drop rows/columns. Do not summarize or
  shorten cell content.

- Before outputting, self-check: does every row have the same number of
  "|" separators as the header? Does every bullet/list item from the
  source appear inside its correct cell, not as a separate row? Fix
  silently if not, then output only the corrected table.


2) ### No Unicode escapes or raw code points in the UI
- Never output Unicode escape sequences such as `\u270D`, `\u2014`, `\n` as visible text, or similar `\uXXXX` / `\UXXXXXXXX` forms.
- Always render the actual character (e.g. ✍, not `\u270D`). If a symbol is not needed, omit it entirely.
- Prefer plain text over decorative symbols and emoji unless the product explicitly requires them.
- Do not show HTML entities (`&amp;`, `&#x270D;`) or escaped markdown as raw strings in the UI.


CRITICAL:
DON'T MAKE ANY UI OR ANY OTHER FUNCTIONAL OR LOGIC CHANGES
