# Job Tracker

Real-time B2B Product Design job search agent for Eric Tsai. Monitors the entire web via Firehose, scores postings against a keyword taxonomy, and surfaces them through a hosted dashboard.

## Architecture

```
Firehose (web crawl events)
    ↓  SSE stream
apps/listener  (Railway, persistent Node.js)
    ↓  scored + deduped rows
Supabase (Postgres + Realtime)
    ↓  read by
apps/web  (Vercel, Next.js)
    ↑  upload
Resume PDF  →  keyword extraction  →  re-score all jobs
```

## Quick Start

### 1. Install dependencies

```bash
npm install -g pnpm
pnpm install
```

### 2. Set up environment

```bash
cp .env.example .env.local
# Fill in: FIREHOSE_TAP_TOKEN, SUPABASE_URL, NEXT_PUBLIC_SUPABASE_URL,
#          NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
```

### 3. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Run the migration:
   ```bash
   npx supabase db push --db-url "postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres"
   # Or paste supabase/migrations/001_init.sql into the SQL editor
   ```
3. Enable Realtime for the `job_postings` table: Dashboard → Database → Replication → toggle `job_postings`
4. Create a Storage bucket named `resumes` (private)

### 4. Run locally

```bash
# Terminal 1: Firehose listener
cd apps/listener
FIREHOSE_TAP_TOKEN=fh_... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run dev

# Terminal 2: Next.js frontend
cd apps/web
npm run dev
# Open http://localhost:3000
```

## Deploy

### Vercel (frontend)

1. Connect GitHub repo to Vercel
2. Set root directory: `apps/web`
3. Add env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
4. Enable Vercel Password Protection (Dashboard → Settings → Security)

### Railway (listener)

1. New project → Deploy from GitHub
2. Set root directory: `apps/listener`
3. Start command: `npm start`
4. Add env vars: `FIREHOSE_TAP_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
5. Set restart policy: Always

## Scoring

Postings are scored using the keyword taxonomy and formula from `CLAUDE.md §§3–4`:

| Category | Weight |
|---|---|
| B2B / Enterprise domain | 5× per match |
| AI & Emerging tech | 4× |
| Core design skills | 3× |
| Methods & process | 2× |
| Soft skills | 2× |
| Tools | 1× |
| Company tier bonus | +20 / +10 / +5 |
| Seniority bonus | +10 / +5 / 0 / -10 |
| Location bonus | +5 / +3 / 0 / -20 |

**Priority thresholds:** ≥50 HIGH · 30–49 MEDIUM · 15–29 LOW · <15 SKIP

## Slash Command

`/firehose-api` — loads the full Firehose API reference into context for implementing API calls.
