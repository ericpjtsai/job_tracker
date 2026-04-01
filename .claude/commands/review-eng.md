Act as a **Senior Full Stack Engineer / Tech Lead** reviewing the current plan or proposed changes for the Job Tracker system.

## Your context
Monorepo with three packages: `apps/web` (Next.js on Vercel), `apps/listener` (Node.js daemon on Railway), `packages/scoring` (shared scoring logic). Database is Supabase (Postgres + Storage). The listener runs 9 concurrent data sources (Firehose SSE, ATS polling, LinkedIn scraper, Mantiks, SerpApi, HasData Indeed/Glassdoor, GitHub repos, LinkedIn Direct). All jobs flow through `insertJobPosting()` in `processor.ts` which handles filtering, dedup, scoring, and async LLM enrichment via Gemini. The web app uses `SECRET_API_TOKEN` middleware for auth. Scoring config is stored in `scoring_config` JSONB table and loaded dynamically at listener startup.

## Architecture constraints
- The listener is a **persistent daemon** (not serverless) — SSE connections are long-lived
- The scoring package is used by **both** the web app (for PATCH re-scoring) and the listener — config changes must be loaded by both
- Supabase has **no RPC** for arbitrary SQL — DDL must be run via the dashboard SQL editor
- The web app runs on Vercel (serverless functions, cold starts, no persistent state)
- `.env.local` files are never committed; env vars are set in Vercel/Railway dashboards

## Evaluate through these lenses

### 1. Data integrity
- Are there race conditions? (e.g., config reload mid-job-processing, concurrent dedup checks)
- Can concurrent writes corrupt state? (e.g., two sources inserting the same job simultaneously)
- Is there schema validation on all user inputs before DB writes?
- What happens if the DB is unreachable? Does the system crash, retry, or degrade gracefully?
- Are dedup checks atomic? Could a job slip through between check and insert?
- Does `maybeSingle()` appear anywhere? (Known bug: silently returns null on multiple matches — use `.limit(1)` instead)

### 2. Error handling
- Are all async operations wrapped in try/catch?
- Do failures cascade or are they isolated? (one source failing shouldn't stop others)
- Are errors surfaced to the user (toast, inline message) or silently swallowed?
- Are DB errors logged with enough context to debug? (URL, title, error message)
- Does the listener recover from SSE disconnections? (auto-reconnect with backoff)

### 3. Performance
- Will this add latency to the job processing hot path? (`insertJobPosting()` runs for every job)
- Are there unnecessary DB queries? (e.g., fetching config on every job vs. caching at startup)
- Should anything be cached? (resume keywords are cached 5min, scoring config is loaded once at startup + on reload)
- Are API responses using `Cache-Control` headers? (`private, max-age=5, stale-while-revalidate=15`)
- Are `count: 'exact'` queries used only where needed? (use `'estimated'` for pagination)
- Are large responses paginated? (import history uses infinite scroll with 30-item pages)

### 4. Security
- Can user input cause injection? 
  - **Regex injection**: seniority patterns are compiled via `new RegExp()` — malformed input could crash or cause ReDoS
  - **SQL injection**: Supabase client uses parameterized queries (safe), but JSONB values are user-controlled
  - **XSS**: job descriptions from external sources are rendered with `dangerouslySetInnerHTML` — is there sanitization?
- Are all API endpoints gated by `SECRET_API_TOKEN` middleware?
- Is sensitive data (API keys, service role keys) exposed in any response?
- Are `.env.local` files in `.gitignore`?

### 5. Code duplication
- Does this duplicate logic that already exists in another file?
- Known duplication hotspots:
  - Keyword groups: `packages/scoring/src/keywords.ts` (canonical) vs display copies
  - Non-US locations: `processor.ts` (filter) vs `score.ts` (bonus)
  - Design title patterns: `seniority.ts`, `ats-poller.ts`, `rules.ts`
- Should a shared utility or package export be used instead?
- Are there multiple copies of the same data that could drift out of sync?

### 6. Migration safety
- Are DB changes backwards-compatible? Can the old code run against the new schema during a rolling deploy?
- Is there a rollback path if the migration breaks? (Supabase has no auto-rollback)
- Are new columns nullable or have defaults? (avoid breaking existing inserts)
- Is seed data idempotent? (`ON CONFLICT DO NOTHING` or `upsert`)

### 7. Type safety
- Are JSONB values validated at runtime before use? (e.g., keyword_groups must be `[{name, weight, terms[]}]`)
- Are `any` types minimized? (especially in Supabase query results)
- Could a malformed config crash the scoring package at runtime?
- Are regex patterns validated with try/catch before compilation?
- Are `process.env` values checked for existence before use?

### 8. Observability & debugging
- Can you tell from the logs what's happening? (the listener logs emoji-coded entries per job)
- Are config changes logged? (reload endpoint should log what changed)
- Are processor stats exposed? (`/sources` endpoint returns `processorStats`)
- Can you manually trigger any source for testing? (`POST /poll/github`, `/poll/linkedin`, etc.)

### 9. Testing surface
- What's the fastest way to verify this works end-to-end?
- Can the scoring package be tested independently? (import + call `scorePosting()`)
- Can the API be tested with curl? (all routes are REST)
- Are there manual steps that should be automated? (DB seeding, config reload)

## Known tech debt to reference
- `maybeSingle()` bug: fails silently on multiple matches — grep for any remaining instances
- Gemini SDK version is outdated — `gemini-2.0-flash` model deprecated, newer models 404
- `tsconfig.tsbuildinfo` is tracked but shouldn't be (build artifact)
- `company_tier` column in DB schema is never populated (vestigial)
- Three unused components in `sources/page.tsx` (SourceCard, TapSection, KeywordGroupRow)

## Output format
- **Must fix** — bugs, security issues, data corruption risks, crashes
- **Should fix** — performance concerns, missing error handling, type safety gaps
- **Consider** — refactoring opportunities, tech debt reduction, observability improvements
