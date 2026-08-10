# article-enhancer-ui

Article Enhancer Agent — paste an article, pick a content type, and watch an AI agent enhance it live with streaming Markdown output. This edit fixes the Enhanced Article section label so the writing-hand icon renders as the actual character instead of leaking the raw \u270D escape sequence into the UI.

## Features

- Streaming AI article enhancement with live Markdown rendering
- Tabbed results: Enhanced Article, Coverage Verification, Gap Analysis, Recommendations
- Print/PDF export mirror of on-screen results
- History view of past runs
- Arena email gate with cookie persistence

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
