# Job Tracker

Real-time B2B Product Design job search agent.

## Stack

- **Web**: Next.js (Vercel) at `apps/web/`
- **Listener**: Node.js SSE daemon (Railway) at `apps/listener/`
- **Scoring**: Shared package at `packages/scoring/`
- **DB**: Supabase (Postgres + Storage)
- **Monorepo**: npm workspaces, `pnpm-workspace.yaml`

## Architecture

The listener is a persistent daemon — not serverless. It manages 8+ data sources (Firehose SSE, ATS polling, LinkedIn scraper, SerpApi, HasData, GitHub repos) and feeds jobs through `insertJobPosting()` in `processor.ts`. The processor handles title/seniority/location filtering, dedup, scoring, and async LLM enrichment.

The web app is a Next.js dashboard with API routes that proxy to the listener's control server (port 3002) and query Supabase directly.

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
