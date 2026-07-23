# Article Enhancer Agent

A single-page, streaming article enhancement UI. Paste an article URL and text, pick a content type, and watch an AI agent stream back an enhanced, Markdown-formatted version live.

## Features

- Validated form (Article URL, Article Text, Content Type with an "Other" free-text option)
- Server-side `/api/enhance` proxy — the workflow API key stays on the server, never in the client bundle
- Live SSE / chunked-text streaming with progressive token rendering
- Graceful non-streamed JSON fallback
- Unicode escape sequences (e.g. `\u2013`) are always decoded into real characters, even when double-escaped
- Heartbeat / progress messages are routed into a pulsing status chip with a live elapsed timer — never mixed into the answer
- Animated gradient progress line on the result card while streaming (respects `prefers-reduced-motion`)
- Markdown rendering via `react-markdown` + `remark-gfm`
- Loading skeleton, on-brand error card with retry, visible keyboard focus states
- Request logging to Postgres via Prisma (non-blocking)

## Tech stack

- Next.js 15 (App Router) + React 19 + TypeScript (strict)
- Tailwind CSS 3
- react-markdown + remark-gfm
- Prisma + Neon Postgres

## Local setup

```bash
npm install
cp .env.example .env   # set DATABASE_URL to a Postgres connection string
npm run dev
```

Open http://localhost:3000.

## Build & deploy

```bash
npm run build   # runs prisma generate && prisma db push && next build
npm start
```

On Vercel with a connected Neon database, `DATABASE_URL` is injected automatically.
