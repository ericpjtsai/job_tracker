# Job Tracker

Real-time B2B Product Design job search agent.

## Stack

- **Web**: Next.js (Vercel) at `apps/web/`
- **Polling + enrichment**: Supabase Edge Functions (Deno) at `supabase/functions/`, scheduled via pg_cron
- **Scoring**: Shared package at `packages/scoring/` (also vendored into `supabase/functions/_shared/scoring/` for Edge Function use)
- **DB**: Supabase (Postgres + Storage)
- **Monorepo**: npm workspaces

## Architecture

All data sources run as stateless Supabase Edge Functions, scheduled by pg_cron via pg_net. The old persistent Node.js listener daemon was retired in commit `292b499` and removed entirely from the repo. There is no standalone process — polling, dedup, scoring, and LLM enrichment all happen inside Edge Functions.

pg_cron calls each polling function on its own schedule (ATS every 15 min across 4 batches, LinkedIn/SerpApi/HasData/GitHub 2× daily, Mantiks weekly, `enrich-batch` every 2 min). Each function reports status via `markPolling`/`markHealthy`/`markError` helpers that write to the `source_health` table. The web app's `/sources` page reads directly from that table — no control server.

LLM enrichment uses a queue model: new rows land with `enrichment_status='pending'`, and the `enrich-batch` cron worker picks up the oldest 20 every 2 minutes, calls Claude Haiku, and marks them `'done'` / `'skipped'` / `'error'`.

## File map

### `apps/web/` — Next.js dashboard
```
app/
  layout.tsx              — Root layout, nav, cookie auth
  page.tsx                — Homepage: job list, stat cards, filters, swipe-delete
  import/page.tsx         — Manual import (form + file upload), import history
  jobs/[id]/page.tsx      — Job detail: header, Details tab (desc/link), notes
  resume/page.tsx         — Resume upload, keyword display, re-score
  sources/page.tsx        — Data source cards, health, config editor (Data Sources / Configuration tabs)
  api/
    jobs/route.ts         — GET jobs list (filtered, paginated)
    jobs/[id]/route.ts    — GET/PATCH/DELETE single job
    jobs/import/route.ts  — GET history, POST import from markdown
    jobs/rescore/route.ts — POST trigger re-score (invokes rescore Edge Function), GET progress
    resume/route.ts       — GET versions, POST upload, PATCH set active
    sources/route.ts      — GET source_health rows + historical DB counts
    stats/route.ts        — Aggregated stats (high/med/low counts)
    poll/route.ts         — POST: invokes poll-* Edge Functions on demand
    scoring/route.ts      — GET/PATCH scoring config (keyword groups, seniority, blocklists)
middleware.ts             — API auth gate (SECRET_API_TOKEN)
lib/
  supabase.ts             — Client + server Supabase clients, types
  utils.ts                — formatDate, timeAgo, capitalize
components/
  nav.tsx                 — Top nav bar
  score-badge.tsx         — StatusChip, FitBadge components
  stat-card.tsx           — Dashboard stat card
  drop-zone.tsx           — File upload drop zone
  ui/                     — Shared UI primitives (button, badge, input)
```

### `supabase/functions/` — Edge Functions (Deno)
```
_shared/
  handler.ts              — Common HTTP handler wrapper (auth, CORS, JSON)
  supabase.ts             — getServiceClient(), requireServiceAuth(), jsonResponse()
  llm.ts                  — Claude Haiku client; extractKeywordsLLM(), validateKeywords()
  health.ts               — markPolling(), markHealthy(), markError() → source_health rows
  processor.ts            — insertJobPosting(): filters, dedup, scoring, enqueues enrichment
  scoring/                — Vendored copy of packages/scoring/ with .ts extensions
poll-ats/index.ts         — ATS API polling (Greenhouse/Lever/Ashby/SmartRecruiters, batched 0-3)
poll-linkedin/index.ts    — LinkedIn jobs (rewritten without the npm package)
poll-linkedin-direct/     — Emergency LinkedIn HTML scraper (fallback)
poll-mantiks/index.ts     — Mantiks LinkedIn API
poll-serpapi/index.ts     — SerpApi Google Jobs
poll-hasdata/index.ts     — HasData Indeed + Glassdoor
poll-github/index.ts      — GitHub Jobright repos (design + H1B)
enrich-batch/index.ts     — Queue worker: picks enrichment_status='pending' rows, calls Claude, marks done
rescore/index.ts          — Chunked full-resume-fit rescore, self-chains via EdgeRuntime.waitUntil
```

### `packages/scoring/` — Shared scoring logic (used by apps/web/)
```
src/
  index.ts                — Package exports
  keywords.ts             — 6 keyword groups (~180 terms), weights
  score.ts                — scorePosting(), computeResumeFit(), matchKeywords()
  seniority.ts            — isRoleExcluded(), isSeniorityExcluded(), getSeniorityBonus()
  salary.ts               — Salary extraction from text
  company-tiers.ts        — Company tier bonuses
```
Note: this package is vendored into `supabase/functions/_shared/scoring/` for Edge Function use. No sync mechanism — keep both in sync manually when editing.

### `supabase/migrations/`
```
001_init.sql              — job_postings, resume_versions tables
002_add_indexes.sql       — resume_fit, status, applied_at indexes
003_add_missing_columns.sql — applied_at, source_type, resume_type columns
004_scoring_config.sql    — scoring_config table (editable keyword groups, filters, blocklists)
005_pending_rejections.sql — Gmail rejection detection table
006_source_health.sql     — source_health table + enrichment_status column (NOT NULL DEFAULT 'pending')
007_cron_schedule.sql     — pg_cron + pg_net setup, 18 scheduled jobs, call_edge() helper
```

### Key data flows
```
pg_cron → call_edge('poll-*') → source module → insertJobPosting()
  → title/location/seniority filters → dedup (url, title+co+loc)
  → scorePosting() → DB insert with enrichment_status='pending'

cron (every 2 min) → call_edge('enrich-batch')
  → SELECT WHERE enrichment_status='pending' LIMIT 20
  → extractKeywordsLLM() + validateKeywords() → UPDATE enrichment_status='done'

Web PATCH /api/jobs/:id (page_content)
  → scorePosting() → inline LLM enrichment → DB update

Resume upload → PDF parse → extractResumeKeywordsWithLLM() (Claude Opus)
  → DB insert → optional re-score (invokes rescore Edge Function)
```

## Key conventions

- UI separators use ` · ` (middot), not `|` or `/`
- Senior designer roles (Senior Product Designer, Senior UX Designer) should NOT be filtered out — only Staff/Principal/Director/VP/Manager are excluded
- `source_type: 'manual'` rows are never overwritten by automated sources
- All API GET routes should include `Cache-Control: private, max-age=5, stale-while-revalidate=15`
- Use `count: 'estimated'` instead of `'exact'` for pagination counts (faster on Postgres)
- Loading states: show a centered spinner before API data arrives
- **Never `export ANTHROPIC_API_KEY` in any shell where you run Claude Code** — it will bill Claude Code against your API account instead of your Pro/Max OAuth

## Auth & rate limits

Demo users (unauthenticated) can read but not write. Writes require an HMAC-signed `admin-session` cookie set by `POST /api/auth/login` after validating the server-only `ADMIN_PASSWORD` env. The cookie value cannot be forged client-side.

Required env vars (all three must be set on Vercel + `.env.local`):
- `SECRET_API_TOKEN` — middleware gate for `/api/*`
- `ADMIN_PASSWORD` — server-only password for admin login
- `ADMIN_SECRET` — ≥32 byte random string used to HMAC-sign the admin cookie
- `LLM_DAILY_BUDGET_USD` *(optional, default `2.5`)* — daily $ cap across all LLM routes

`NEXT_PUBLIC_ADMIN_PASSWORD` is **deprecated and must be removed**. It used to ship in the JS bundle, which let any visitor read the password or set `admin-session=true` to bypass demo.

Per-IP rate limits (in-memory; cold starts reset state — pair with the LLM budget cap for the hard wall). Adjust in `apps/web/lib/rate-limit.ts` callers:

| Route | Limit |
|---|---|
| POST `/api/auth/login` | 5 / 10 min |
| GET  `/api/jobs`, `/api/jobs/[id]` | 120 / min |
| GET  `/api/stats` | 60 / min |
| POST `/api/jobs/import` | 5 / hour |
| PATCH `/api/jobs/[id]` | 30 / hour |
| POST `/api/jobs/rescore` | 2 / hour |
| POST `/api/resume` | 5 / hour |
| POST `/api/poll` | 10 / hour |
| POST `/api/sources` | 20 / hour |
| PATCH `/api/scoring` | 20 / hour |

The daily LLM budget is tracked in `scoring_config.value` under key `llm_budget_daily` (`{date, spent, calls}`). When spend exceeds the cap, import still succeeds but `after()` Haiku enrichment is skipped; rescore refuses; resume upload falls back to regex keywords.

`/api/jobs` and `/api/stats` GETs 403 requests with empty/bot User-Agents (curl, wget, python-requests, etc.). Legit programmatic callers should send `Authorization: Bearer $SECRET_API_TOKEN` which bypasses the UA filter.

### Out-of-band walls (do these on first deploy)

1. Anthropic console → Usage & Limits → set **Monthly Spend Limit** (suggested: $10)
2. Gemini / Google AI Studio → same
3. Vercel Dashboard → Settings → **Spend Management** → enable (Hobby-compatible; auto-pauses the project at threshold)

### Deploy order for auth migration (one-time)

Rolling a version that removes `NEXT_PUBLIC_ADMIN_PASSWORD` and adds `ADMIN_PASSWORD` / `ADMIN_SECRET` is a breaking change. Ordering matters:

1. On Vercel, **add** `ADMIN_PASSWORD` (server-only) and `ADMIN_SECRET` (≥32 bytes, `openssl rand -hex 32`).
2. Deploy the code. The login route now reads the new envs; missing them hard-500s.
3. On Vercel, **remove** `NEXT_PUBLIC_ADMIN_PASSWORD`. (Safe to remove after deploy; no code reads it anymore.)
4. Existing admin users will be logged out — prior `admin-session=true` cookies were the forgery hole, and new signed cookies can't be minted without a password round-trip. Log in again with the password.

Rollback path: if the deploy breaks, revert code AND keep `NEXT_PUBLIC_ADMIN_PASSWORD` set until the rollback deploy is live, then re-remove. The server-only envs can stay; the old code ignores them.

## Common commands

```bash
# Dev
npm run dev:web          # Next.js on :3000

# Edge Functions (local)
npm run functions:serve  # Run all functions locally
npm run functions:deploy # Deploy all functions to Supabase

# Manually trigger a poll (via Supabase CLI)
supabase functions invoke poll-ats --body '{"batch":0}'
supabase functions invoke poll-github
supabase functions invoke enrich-batch

# Check source health (via Supabase SQL Editor or psql)
SELECT source_id, status, last_success_at, consecutive_failures, last_error
FROM source_health ORDER BY source_id;

# Check cron schedule
SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
```

## Don't

- Don't filter out Senior-level design roles
- Don't use `maybeSingle()` for dedup queries — use `.limit(1)` (fails silently with multiple matches)
- Don't insert jobs with unparseable dates — validate `publishedAt` and fall back to `now()`
- Don't commit `.env.local` files
- Don't edit `supabase/functions/_shared/scoring/` without mirroring the change to `packages/scoring/src/` (or vice versa) — there's no sync
- Don't `export ANTHROPIC_API_KEY` in any shell that will spawn `claude` — Claude Code auto-detects it and will bill against your API account
- Don't add `Co-Authored-By: Claude` (or any `@anthropic.com` co-author) trailers or `🤖 Generated with Claude Code` lines to commit messages or PR bodies. The `.githooks/commit-msg` hook strips them as a safety net — don't disable it. Run `git config core.hooksPath .githooks` in fresh clones to activate.
