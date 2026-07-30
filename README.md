# article-enhancer-ui

Article Enhancer Agent UI — widened Generator/History containers, real createdAt timestamps in History, full-screen History view with explicit Back and Export, and proper HTML table rendering for markdown tables.

## Features

- Streaming article enhancement with live progress checklist
- Widened centered containers for Generator form and History list
- History runs show real createdAt date/time in readable local format
- History View always opens full-screen with explicit Back button
- Export (print) available in both Generator and History full-screen views
- Markdown tables rendered as real HTML tables with thead/tbody, preserving inline formatting and <br> in cells

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
