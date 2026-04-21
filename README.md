# Job Tracker

Real-time B2B Product Design job search agent. Polls ATS boards (Greenhouse, Lever, Ashby, SmartRecruiters), scrapes LinkedIn, pulls from SerpApi + HasData + GitHub, scores postings with LLM keyword extraction, and surfaces them through a Next.js dashboard.

## Architecture

```
Sources                           Processing                    Frontend
─────────────────                ──────────────────             ──────────────
Greenhouse / Lever / Ashby ─┐
SmartRecruiters             ─┤    supabase/functions/          apps/web
LinkedIn (Mantiks, direct)  ─┤    ├─ poll-* (7 sources)        ├─ Dashboard (/)
SerpApi Google Jobs         ─┤    ├─ _shared/processor         ├─ Job detail (/jobs/[id])
HasData (Indeed, Glassdoor) ─┤    │   (filter, dedup, score)   ├─ Resume (/resume)
GitHub Jobright repos       ─┘    ├─ enrich-batch (queue)      ├─ Import (/import)
                                  └─ rescore (chunked)         └─ Sources (/sources)
      pg_cron + pg_net                     ↕
      schedules each fn               Supabase (Postgres + source_health)
```

All pollers run as stateless Edge Functions, scheduled by pg_cron. The old Node.js listener daemon at `apps/listener/` was retired in commit `292b499` and removed in commit `<this-commit>`. To restore it for rollback, see [docs/ROLLBACK.md](docs/ROLLBACK.md).

## Directory Structure

```
├── apps/
│   └── web/                    Next.js 15 frontend (Vercel)
│       ├── app/
│       │   ├── api/            API routes (jobs, resume, stats, poll, sources)
│       │   ├── jobs/[id]/      Job detail page
│       │   ├── resume/         Resume upload + keyword management
│       │   ├── import/         Manual job import
│       │   ├── sources/        Source health + config editor
│       │   └── page.tsx        Dashboard homepage
│       ├── components/         Reusable UI components
│       └── lib/
│           ├── supabase.ts     Supabase client, types, shared constants
│           └── utils.ts        Shared utilities
│
├── packages/
│   └── scoring/                Shared scoring engine (used by apps/web)
│       └── src/
│           ├── score.ts        Keyword matching, scoring formula, resume fit
│           ├── seniority.ts    Role exclusion + seniority filters
│           ├── keywords.ts     Keyword taxonomy
│           ├── llm-keywords.ts LLM keyword extraction (Haiku + Opus for resume)
│           ├── salary.ts       Salary range extraction
│           └── companies.ts    Company name normalization
│
└── supabase/
    ├── functions/              Edge Functions (Deno, deployed to Supabase)
    │   ├── _shared/            Shared helpers: handler, auth, llm, health, processor
    │   ├── poll-ats/           Greenhouse/Lever/Ashby/SmartRecruiters
    │   ├── poll-linkedin/      LinkedIn jobs (rewritten without npm package)
    │   ├── poll-linkedin-direct/ Emergency fallback HTML scraper
    │   ├── poll-mantiks/       Mantiks LinkedIn API
    │   ├── poll-serpapi/       SerpApi Google Jobs
    │   ├── poll-hasdata/       HasData Indeed + Glassdoor
    │   ├── poll-github/        GitHub Jobright repos
    │   ├── enrich-batch/       LLM enrichment queue worker (every 2 min)
    │   └── rescore/            Chunked full re-score, self-chains via waitUntil
    └── migrations/             Database schema + cron schedule
```

## Data Flow: How a Job Gets Processed

```
1. pg_cron triggers a poll-* Edge Function on schedule
2. Source module yields candidate jobs → _shared/processor.ts filter chain:
   ├─ isRoleExcluded(title)?     → drop (engineer, researcher, intern, etc.)
   ├─ isLocationBlocked(loc)?    → drop (non-US, unless US also listed)
   ├─ isArticleTitle(title)?     → drop (blog posts, guides)
   ├─ dedup by url?              → update last_seen
   ├─ dedup by title+company?    → merge descriptions
   ├─ isSeniorityExcluded()?     → insert with priority=skip
   └─ resume fit = 0%?           → drop (no keyword overlap)
3. Insert to Supabase with regex score, enrichment_status='pending'
4. Every 2 minutes, enrich-batch picks up pending rows:
   ├─ Call Claude Haiku (extractKeywordsLLM + validateKeywords)
   ├─ Compute role_fit (0-100, contextual assessment)
   ├─ Update keywords_matched, resume_fit, priority, enrichment_status='done'
5. Frontend receives via Supabase Realtime or polling
```

## Scoring Pipeline

**Two scoring systems** (LLM takes priority when available):

| System | Source | Score Range | Used For |
|--------|--------|-------------|----------|
| Regex keywords | `packages/scoring/src/score.ts` | 0-100+ (weighted sum) | Initial filter, fallback |
| LLM role_fit | `packages/scoring/src/llm-keywords.ts` | 0-100 (contextual fit) | Final resume_fit display |

**LLM role_fit rubric** (calibrated for mid-level B2B Product Designer):
- 90-100: Perfect match (B2B enterprise + AI + design systems)
- 75-89: Strong match (Product/UX at B2B/SaaS)
- 60-74: Good match (design role, some domain overlap)
- 45-59: Partial match (level/specialty mismatch)
- 30-44: Weak match (adjacent role)
- 0-29: Poor/no match

**Priority mapping:** `role_fit ≥ 80` → high, `≥ 50` → medium, `≥ 1` → low, `0` → skip

## Environment Variables

### Web App (`apps/web/.env.local`)
| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anonymous key (client-side) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (server-side) |
| `ANTHROPIC_API_KEY` | Recommended | Claude key for inline enrichment (JD edit, resume upload) |
| `SECRET_API_TOKEN` | Recommended | API auth gate token |
| `NEXT_PUBLIC_DEMO_MODE` | No | Set `true` to block write actions |

### Supabase Edge Functions (Dashboard → Project Settings → Edge Functions → Secrets)
| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude Haiku for enrich-batch queue worker |
| `MANTIKS_API_KEY` | No | Mantiks LinkedIn Jobs API |
| `SERPAPI_API_KEY` | No | SerpApi Google Jobs |
| `HASDATA_API_KEY` | No | HasData API (Indeed + Glassdoor) |
| `HASDATA_API_KEY_BACKUP` | No | Fallback key used automatically when the primary fails (quota, auth, rate limit) |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto | Provided by Supabase runtime |

pg_cron also needs Vault secrets `project_url` and `service_role_key` — see [supabase/migrations/007_cron_schedule.sql](supabase/migrations/007_cron_schedule.sql) header for setup commands.

## Quick Start

```bash
# Install
npm install

# Set up env
cp .env.example apps/web/.env.local  # fill in required vars

# Database
npx supabase db push  # or run migrations manually

# Run the web app locally
npm run dev:web       # http://localhost:3000

# Run Edge Functions locally (optional, usually tested in staging)
npm run functions:serve
```

## Deploy

- **Frontend:** Vercel — root dir `apps/web`, add env vars
- **Edge Functions:** `npm run functions:deploy` (or via Supabase Dashboard)
- **Database:** Supabase — enable Realtime on `job_postings`, create `resumes` storage bucket, run migrations

## Key Design Decisions

- **Edge Functions over persistent daemon:** Stateless, auto-scaling, no Railway cost, cron-driven. The old listener daemon at `apps/listener/` was retired in commit `292b499`.
- **Queue-based LLM enrichment:** New rows land with `enrichment_status='pending'`; `enrich-batch` cron worker processes them in batches every 2 minutes. No fire-and-forget inside the polling path.
- **LLM over regex:** `resume_fit` uses LLM `role_fit` (contextual) over keyword overlap (mechanical). Resume upload uses Claude Opus for extraction, all other enrichment uses Haiku.
- **Two-tier filtering:** Role exclusion (hard block, never inserted) vs seniority exclusion (soft block, inserted as `priority: skip`). Both consolidated in `packages/scoring/src/seniority.ts`.
- **Pre-compiled regexes:** All 500+ keyword patterns compiled once at module load, not per-job.
- **Parallel DB queries:** Stats use parallel HEAD count queries instead of fetching all rows.
- **Cache strategy:** API routes use `Cache-Control: private, max-age=5, stale-while-revalidate=15`.
