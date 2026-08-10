# article-enhancer-ui

Fixed the Enhanced Article tab blanking after streaming completes. components/ResultCard.tsx (lines ~20-55): the presentation formatter (formatEnhancedMarkdown) can strip the final post-stream payload entirely (e.g. when the closing chunk collapses into a structured JSON dump) or the parent momentarily clears `content` at [DONE], which emptied the rendered article right when the run finished. ResultCard now remembers the last non-empty formatted render in refs (lastDisplayRef / lastCleanRef) and keeps showing it whenever the freshly formatted output goes empty after content already rendered, with a raw preprocessed fallback for cold mounts. Render and copy-button conditions switched from `content` to the resolved displayContent/cleanContent so the article, word count, and Copy action survive stream completion. prisma/schema.prisma echoed unchanged (EnhancementLog model used by /api/enhance) — no columns added, removed, or altered.

## Features

- Streaming article enhancement with live Markdown output
- Tabbed results: Enhanced Article, Coverage Verification, Gap Analysis, Recommendations
- Enhanced Article content persists after streaming completes (post-stream blanking fixed)
- History view with per-run detail and export/print
- Arena email gating via middleware and cookie

## Tech Stack

- Next.js ^15.3.3 (App Router)
- React ^19.0.0
- Tailwind CSS v3
- TypeScript
- Prisma + PostgreSQL (Neon on Vercel)

## Routes

- `/`
- `/access-denied`

## Getting Started

```bash
npm install
cp .env.example .env
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Database

1. Copy `.env.example` to `.env` for local development
2. Set `DATABASE_URL` to your Postgres connection string
3. Run `npx prisma db push` before `npm run dev` if tables are missing

On Vercel, `DATABASE_URL` is injected when Neon is connected to the project.

## Scripts

- `npm run dev` — start the development server
- `npm run build` — production build (runs Prisma generate/push when configured)
- `npm run start` — run the production server locally

## Deploy

This project is intended for deployment on [Vercel](https://vercel.com). Connect the GitHub repository and deploy the `main` branch.
