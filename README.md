# article-enhancer-ui

Article Enhancer with a wider, more compact desktop layout: ~92% viewport content width capped at 1600px, tightened header spacing (48px top, 32px to the first card), centered title and 760px description, aligned Generator/History toggle, and a wrap-friendly workflow grid with no horizontal scrollbar — all existing functionality preserved.

## Features

- Responsive UI with Tailwind CSS
- Next.js App Router pages and components
- Streaming article enhancement with live progress
- History view with tabbed result detail and PDF export
- Wide compact desktop layout (92% viewport, 1600px cap) with consistent spacing

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
