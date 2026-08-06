# article-enhancer-ui

Article Enhancer with cleaned article output: raw JSON/coverage data dumps are stripped from the Enhanced Article tab, markdown tables are normalized to consistent column counts, and Unicode escape sequences are decoded to real characters before rendering.

## Features

- Streaming article enhancement with live Markdown output
- Raw JSON / coverage-verifier dumps never shown in the Enhanced Article tab
- Markdown tables preserved and normalized to consistent columns
- Unicode escapes decoded to real characters in rendered output
- Gap analysis, recommendations and coverage verification tabs
- History view and print/export report

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
