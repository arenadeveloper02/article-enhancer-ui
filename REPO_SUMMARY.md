# Repository Summary: Article Enhancer Agent

> Auto-maintained by Sim Development. Last updated: 2026-07-23T14:10:16.901Z.

## Overview

A single-page Next.js App Router app that enhances articles via a streaming AI agent, with live token rendering, heartbeat status chips, and Markdown output.

**Repository:** `article-enhancer-ui`  
**File count:** 25

## Features

- Streaming enhancement with live token rendering
- Server-side proxy route keeping the API key private
- Client-side form validation with inline errors
- Heartbeat/status messages routed to a live status chip
- Unicode escape decoding for clean rendered text
- Markdown rendering with styled result card
- Error card with retry and elapsed-time indicator

## Tech Stack

- Next.js ^15.3.3 (App Router)
- React ^19.0.0
- Tailwind CSS v3
- TypeScript
- Prisma + PostgreSQL (Neon on Vercel)

## Infrastructure

- **Neon project ID:** `patient-feather-02283586` — managed by Sim Development; do not delete or replace
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

- `components/EnhancerClient.tsx`
- `components/ErrorCard.tsx`
- `components/MarkdownRenderer.tsx`
- `components/ResultCard.tsx`
- `components/StatusChip.tsx`

### Libraries

- `lib/prisma.ts`
- `lib/stream.ts`
- `lib/types.ts`
- `prisma/schema.prisma`

### Config

- `.env.example`
- `.gitignore`
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
- `.gitignore`
- `README.md`
- `REPO_SUMMARY.md`
- `app/api/enhance/route.ts`
- `app/error.tsx`
- `app/globals.css`
- `app/layout.tsx`
- `app/not-found.tsx`
- `app/page.tsx`
- `components/EnhancerClient.tsx`
- `components/ErrorCard.tsx`
- `components/MarkdownRenderer.tsx`
- `components/ResultCard.tsx`
- `components/StatusChip.tsx`
- `lib/prisma.ts`
- `lib/stream.ts`
- `lib/types.ts`
- `next-env.d.ts`
- `next.config.ts`
- `package.json`
- `postcss.config.mjs`
- `prisma/schema.prisma`
- `tailwind.config.ts`
- `tsconfig.json`

## Latest Change

- **Updated at:** 2026-07-23T14:10:16.901Z
- **Request:** Build a production-ready Next.js (App Router, TypeScript) application called "Article Enhancer Agent".

Layout constraints:

No header/nav bar, no footer. Just a clean, centered, single-page interface with a max-width container.
Modern, minimal SaaS aesthetic — not a generic AI-template look. Avoid the default "cream background + terracotta accent" or "black background + neon accent" clichés. Use a considered palette (e.g., off-white background, ink-navy text, an indigo/violet accent for primary actions), pair a distinctive display font for headings with a clean body font (e.g., Space Grotesk + Inter), and add one signature detail — like an animated gradient/progress line on the result card while streaming, and a live "elapsed time" status chip with a pulsing dot.
Fully responsive, rounded corners, subtle card shadows, good spacing, visible keyboard focus states, respects reduced-motion.

Form:

Three inputs: Article URL (required text input), Article Text (required multi-line textarea), and Content Type (required — a select/dropdown with sensible options like Blog Post, Landing Page, Guide, News, Product Page, plus an "Other" free-text option).
An Enhance Article submit button with disabled/loading state.
Client-side validation with clear inline error states (not just browser default).

API integration:

Create a server-side route handler at /api/enhance that proxies to:
Endpoint: https://test-agent.thearena.ai/api/workflows/9aafe5d7-1d24-477a-ad3f-0be9bf79c04f/execute
Method: POST
Headers: { 'X-API-Key': 'sk-sim-T8eEbhp_o3qI01OEp5Ok_VdiwR4Q6Fht', 'Content-Type': 'application/json' }
Body: { "article_url": <article_url>, "article_text": <article_text>, "content_type": <content_type>, "stream": true }
The API key must be hardcoded server-side only — never exposed to the client bundle.
The client form calls only the local /api/enhance route.

Streaming handling:

Read the external response as a stream (SSE/chunked) and progressively render tokens as they arrive, so text appears live.
Also support a non-streamed JSON fallback gracefully.
Bug to fix: raw literal unicode escape sequences (e.g. \u2013) must never be shown to the user as text — they should always be decoded into real characters (e.g. an en dash), whether they arrive inside valid JSON or as double-escaped plain text.
Bug to fix: any heartbeat/progress/status messages from the stream (e.g. "This usually takes 1–2 minutes · 15s elapsed") must NOT be mixed into the rendered answer content. Detect and route these into a separate, subtle live status indicator/chip instead.

Rendering:

Render the final response as properly formatted Markdown (headings, bold, lists, links) using a markdown renderer, inside a well-styled result card.
Show a polished loading skeleton/spinner during streaming.
Show a clean, on-brand error card if the request fails, with a retry option.

Other requirements:
Clean, typed, production-quality code (proper component structure, error boundaries where relevant).
