# article-enhancer-ui

Article Enhancer Agent — paste an article URL and/or the article text, pick a content type, and watch an AI agent enhance it live with streaming Markdown output. This edit makes Article URL and Article text both optional, requiring at least one of the two when the Enhance article CTA is clicked.

## Features

- Streaming article enhancement with live Markdown output
- Article URL and Article text are both optional — at least one required on submit
- Gap analysis, recommendations, and coverage verification tabs
- Run history view with printable report export
- Arena email gating with access-denied page

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
