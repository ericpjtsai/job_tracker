# Job Tracker

Real-time B2B Product Design job search agent. Monitors the web via Firehose SSE, polls ATS boards (Greenhouse, Lever, Ashby), scrapes LinkedIn, scores postings with LLM keyword extraction, and surfaces them through a Next.js dashboard.

## Architecture

```
Sources                          Processing                    Frontend
─────────────────               ──────────────────            ──────────────
Firehose SSE (real-time)  ─┐
Greenhouse / Lever / Ashby ─┤    apps/listener               apps/web
LinkedIn (Mantiks, scraper)─┤    ├─ Filter (title, location,  ├─ Dashboard (/)
SerpApi, HasData (Indeed,  ─┤    │   seniority, dedup)        ├─ Job detail (/jobs/[id])
  Glassdoor)               ─┘    ├─ Score (regex keywords)    ├─ Resume (/resume)
                                  ├─ LLM enrich (Gemini/Claude)└─ Import (/import)
                                  └─ Upsert → Supabase
                                                ↕
                                        Supabase (Postgres + Realtime)
```

## Directory Structure

```
├── apps/
│   ├── web/                    Next.js 15 frontend (Vercel)
│   │   ├── app/
│   │   │   ├── api/            API routes (jobs, resume, stats, poll, sources)
│   │   │   ├── jobs/[id]/      Job detail page
│   │   │   ├── resume/         Resume upload + keyword management
│   │   │   ├── import/         Manual job import via JSON
│   │   │   └── page.tsx        Dashboard homepage
│   │   ├── components/         Reusable UI components
│   │   │   ├── ui/             shadcn/ui primitives (Badge, Button, Input, Table)
│   │   │   ├── status-chip.tsx Status dropdown with color-coded styles
│   │   │   ├── fit-badge.tsx   Resume fit percentage display
│   │   │   ├── stat-card.tsx   Priority stat cards (high/medium/low)
│   │   │   ├── sort-header.tsx Sortable column header with tooltip
│   │   │   ├── info-tooltip.tsx Positioned tooltip component
│   │   │   ├── drop-zone.tsx   Drag-and-drop file upload
│   │   │   └── nav.tsx         Top navigation bar
│   │   └── lib/
│   │       ├── supabase.ts     Supabase client, types, shared constants
│   │       └── utils.ts        Shared utilities (timeAgo, formatDate, cn, etc.)
│   │
│   └── listener/               Node.js event processor (Railway)
│       └── src/
│           ├── index.ts        SSE connections, control server, rescore, scheduling
│           ├── processor.ts    Filter → score → dedup → upsert → LLM enrich
│           ├── rules.ts        Firehose tap/rule sync
│           ├── ats-poller.ts   Greenhouse/Lever/Ashby API polling
│           ├── ats-companies.ts Company list for ATS polling
│           ├── linkedin-*.ts   LinkedIn data sources (Mantiks, scraper, direct)
│           ├── serpapi-jobs.ts  SerpApi Google Jobs integration
│           ├── hasdata-jobs.ts  Indeed + Glassdoor via HasData API
│           └── sources/        Source registry + health tracking
│
├── packages/
│   └── scoring/                Shared scoring engine (used by both web + listener)
│       └── src/
│           ├── score.ts        Keyword matching, scoring formula, resume fit
│           ├── seniority.ts    Role exclusion + seniority filters
│           ├── keywords.ts     Keyword taxonomy (B2B, AI, design, methods, tools)
│           ├── llm-keywords.ts LLM keyword extraction (Gemini Flash + Claude Haiku)
│           ├── salary.ts       Salary range extraction
│           └── companies.ts    Company name normalization, domain extraction
│
└── supabase/
    └── migrations/             Database schema + indexes
```

## Data Flow: How a Job Gets Processed

```
1. Source emits job (Firehose event, ATS poll, LinkedIn scrape)
2. processor.ts filter chain:
   ├─ isRoleExcluded(title)?     → drop (engineer, researcher, intern, etc.)
   ├─ isLocationBlocked(loc)?    → drop (non-US, unless US also listed)
   ├─ isArticleTitle(title)?     → drop (blog posts, guides)
   ├─ dedup by url_hash?         → update last_seen
   ├─ dedup by title+company?    → merge descriptions
   ├─ isSeniorityExcluded()?     → insert with priority=skip
   └─ resume fit = 0%?           → drop (no keyword overlap)
3. Insert to Supabase with regex score + resume_fit
4. Async LLM enrichment (Gemini Flash, Claude Haiku fallback):
   ├─ Extract matched + missing keywords
   ├─ Compute role_fit (0-100, contextual assessment)
   └─ Update resume_fit + priority in DB
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

**Priority mapping:** `role_fit ≥ 60` → high, `≥ 30` → medium, `≥ 1` → low, `0` → skip

## Environment Variables

### Web App (`apps/web/.env.local`)
| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anonymous key (client-side) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (server-side) |
| `GEMINI_API_KEY` | No | Gemini API key for LLM enrichment on JD edit |
| `ANTHROPIC_API_KEY` | No | Claude API key (fallback) |
| `LISTENER_URL` | No | Listener control server URL (default: http://localhost:3001) |

### Listener (`apps/listener/.env.local`)
| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key |
| `FIREHOSE_MANAGEMENT_KEY` | Yes | Firehose API management key |
| `FIREHOSE_TAP_TOKEN` | Yes | Firehose tap token for SSE streaming |
| `GEMINI_API_KEY` | Recommended | Gemini Flash for LLM keyword extraction |
| `ANTHROPIC_API_KEY` | No | Claude Haiku fallback |
| `MANTIKS_API_KEY` | No | Mantiks LinkedIn Jobs API |
| `SERPAPI_API_KEY` | No | SerpApi Google Jobs |
| `HASDATA_API_KEY` | No | HasData API (Indeed + Glassdoor) |

## Quick Start

```bash
# Install
npm install

# Set up env
cp .env.example .env.local  # fill in required vars

# Database
npx supabase db push  # or run migrations manually

# Run
cd apps/listener && npm run dev   # Terminal 1
cd apps/web && npm run dev        # Terminal 2 → http://localhost:3000
```

## Deploy

- **Frontend:** Vercel — root dir `apps/web`, add env vars
- **Listener:** Railway — root dir `apps/listener`, start cmd `npm start`, restart policy: Always
- **Database:** Supabase — enable Realtime on `job_postings`, create `resumes` storage bucket

## Key Design Decisions

- **LLM over regex:** `resume_fit` uses LLM `role_fit` (contextual) over keyword overlap (mechanical). Resume upload no longer auto-recalculates all scores — use rescore button instead.
- **Two-tier filtering:** Role exclusion (hard block, never inserted) vs seniority exclusion (soft block, inserted as `priority: skip`). Both consolidated in `packages/scoring/src/seniority.ts`.
- **Pre-compiled regexes:** All 500+ keyword patterns compiled once at module load, not per-job.
- **Parallel DB queries:** Stats use 6 parallel HEAD count queries instead of fetching all rows.
- **Cache strategy:** Stats 120s, job list 60s, job detail 60s. Listener caches resume keywords for 5min with manual invalidation endpoint (`POST /cache/invalidate`).
