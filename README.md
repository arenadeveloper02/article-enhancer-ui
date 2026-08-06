# article-enhancer-ui

Article Enhancer Agent UI: paste an article or URL, pick a content type, and watch an AI agent enhance it live with streaming Markdown output. This edit applies presentation-only formatting rules to the rendered output: full-width Enhanced Article layout, no raw JSON in the UI, and em/en dash clause separators normalized to natural punctuation.

## Features

- Streaming enhancement with live tabbed results (Enhanced Article, Coverage Verification, Gap Analysis, Recommendations)
- Full-width Enhanced Article rendering with structured markdown (headings, lists, GFM tables)
- Defensive rendering filters: boilerplate nav/footer list stripping, raw JSON block removal, dash punctuation normalization
- Print/PDF export that mirrors the on-screen components
- History view backed by the upstream workflow with per-run detail tabs
- Arena email gating via middleware and cookie persistence

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
