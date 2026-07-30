# article-enhancer-ui

Article Enhancer UI — fixed the Recommendations tab normalization so Citation Opportunities, FAQ Suggestions, and Recommendations are always populated from any upstream payload shape (keyed envelopes, nested recommendations objects, keyless JSON array sequences, and per-item field-shape classification). No UI or unrelated logic changes.

## Features

- Streaming article enhancement with live progress
- Gap Analysis, Recommendations, and Coverage Verification tabs
- Recommendations tab always populates citation opportunities, FAQ suggestions, and recommendations
- History view with structured run detail
- Print/PDF export mirror
- Arena email gate with access-denied page

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
