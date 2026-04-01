# Job Tracker

Real-time B2B Product Design job search agent.

## Stack

- **Web**: Next.js (Vercel) at `apps/web/`
- **Listener**: Node.js SSE daemon (Railway) at `apps/listener/`
- **Scoring**: Shared package at `packages/scoring/`
- **DB**: Supabase (Postgres + Storage)
- **Monorepo**: npm workspaces, `pnpm-workspace.yaml`

## Architecture

The listener is a persistent daemon — not serverless. It manages 9 data sources (Firehose SSE, ATS polling, LinkedIn scraper, Mantiks, SerpApi, HasData Indeed/Glassdoor, GitHub repos) and feeds jobs through `insertJobPosting()` in `processor.ts`. The processor handles title/seniority/location filtering, dedup, scoring, and async LLM enrichment.

The web app is a Next.js dashboard with API routes that proxy to the listener's control server (port 3002) and query Supabase directly.

## File map

### `apps/web/` — Next.js dashboard
```
app/
  layout.tsx              — Root layout, nav, cookie auth
  page.tsx                — Homepage: job list, stat cards, filters, swipe-delete
  import/page.tsx         — Manual import (form + file upload), import history
  jobs/[id]/page.tsx      — Job detail: header, Details tab (desc/link), notes
  resume/page.tsx         — Resume upload, keyword display, re-score
  sources/page.tsx        — Data source cards, health, scoring display
  settings/page.tsx       — (planned) Editable scoring config
  api/
    jobs/route.ts         — GET jobs list (filtered, paginated)
    jobs/[id]/route.ts    — GET/PATCH/DELETE single job
    jobs/import/route.ts  — GET history, POST import from markdown
    jobs/rescore/route.ts — POST trigger re-score, GET progress
    resume/route.ts       — GET versions, POST upload, PATCH set active
    sources/route.ts      — Proxy to listener /sources + historical DB counts
    stats/route.ts        — Aggregated stats (high/med/low counts)
    poll/route.ts         — Proxy to listener /poll
    scoring/route.ts      — (planned) GET/PATCH scoring config
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

### `apps/listener/` — Node.js daemon
```
src/
  index.ts                — Entry point: control server, scheduling, SSE streams
  processor.ts            — insertJobPosting(): filters, dedup, scoring, LLM enrichment
  rules.ts                — Firehose tap configs (7 taps, 78 Lucene rules)
  ats-poller.ts           — ATS API polling (Greenhouse, Lever, Ashby, SmartRecruiters)
  ats-companies.ts        — 236 company slugs
  linkedin-scraper.ts     — LinkedIn jobs via npm package
  linkedin-mantiks.ts     — Mantiks LinkedIn API
  linkedin-direct.ts      — Emergency LinkedIn HTML scraper
  serpapi-jobs.ts          — SerpApi Google Jobs
  hasdata-jobs.ts         — HasData Indeed + Glassdoor
  github-jobs.ts          — GitHub Jobright repos (design + H1B)
  sources/
    registry.ts           — DataSource registration map
    types.ts              — DataSource, SourceHealth, withHealthTracking
```

### `packages/scoring/` — Shared scoring logic
```
src/
  index.ts                — Package exports
  keywords.ts             — 6 keyword groups (~180 terms), weights
  score.ts                — scorePosting(), computeResumeFit(), matchKeywords()
  seniority.ts            — isRoleExcluded(), isSeniorityExcluded(), getSeniorityBonus()
  salary.ts               — Salary extraction from text
  company-tiers.ts        — Company tier bonuses
```

### `supabase/migrations/`
```
001_init.sql              — job_postings, resume_versions, listener_state tables
002_add_indexes.sql       — resume_fit, status, applied_at indexes
003_add_missing_columns.sql — applied_at, source_type, resume_type columns
```

### Key data flows
```
Source → insertJobPosting() → title/location/seniority filters → dedup (url, title+co+loc) → scorePosting() → resumeFit → DB insert → async LLM enrichment

Web PATCH /api/jobs/:id (page_content) → scorePosting() → LLM enrichment → DB update

Resume upload → PDF parse → extractResumeKeywords() → DB insert → optional re-score all jobs
```

## Key conventions

- UI separators use ` · ` (middot), not `|` or `/`
- Senior designer roles (Senior Product Designer, Senior UX Designer) should NOT be filtered out — only Staff/Principal/Director/VP/Manager are excluded
- `source_type: 'manual'` rows are never overwritten by automated sources
- All API GET routes should include `Cache-Control: private, max-age=5, stale-while-revalidate=15`
- Use `count: 'estimated'` instead of `'exact'` for pagination counts (faster on Postgres)
- Loading states: show a centered spinner before API data arrives

## Common commands

```bash
# Dev
npm run dev:web          # Next.js on :3000
npm run dev:listener     # Listener on :3002

# Trigger sources manually
curl -X POST http://localhost:3002/poll/github
curl -X POST http://localhost:3002/poll/linkedin
curl -X POST http://localhost:3002/poll/serpapi

# Check source health
curl http://localhost:3002/sources | python3 -m json.tool
```

## Don't

- Don't filter out Senior-level design roles
- Don't use `maybeSingle()` for dedup queries — use `.limit(1)` (fails silently with multiple matches)
- Don't insert jobs with unparseable dates — validate `publishedAt` and fall back to `now()`
- Don't commit `.env.local` files
