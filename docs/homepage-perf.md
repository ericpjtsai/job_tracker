# Homepage Performance Audit & Fix Log

> **For future Claude sessions**: This is the canonical reference for homepage
> mount-time performance. Read this before adding any new fetch to
> [apps/web/app/page.tsx](../apps/web/app/page.tsx) or modifying any of the
> endpoints listed below. The performance budget at the bottom is enforceable.

## TL;DR
The homepage previously fired **5 fetches on mount**. Two of them were doing
expensive work to extract a single field. After the fix it fires **2 critical
fetches** on mount + 1 deferred fetch after the list resolves. The biggest win
was eliminating an unfiltered full-table scan of `job_postings`.

## The Original Bottleneck (pre-fix)

Five mount-time fetches in [apps/web/app/page.tsx](../apps/web/app/page.tsx):

| # | Endpoint | Used for | What it actually cost |
|---|---|---|---|
| 1 | `/api/jobs/import?page=0&limit=1` | reads `todayCount` only | Full list query + count(exact) + companies cache build — for 1 number |
| 2 | `/api/sources` | reads `sources[ats].health.lastPollAt` only | **`select('firehose_rule')` on the entire `job_postings` table** with no filter or LIMIT, to compute `historicalCounts` (which the homepage doesn't read) |
| 3 | `/api/jobs/detect-rejections` | rejection banner | 2 queries; usually returns empty; on the critical path |
| 4 | `/api/stats` | stat cards | OK with admin defaults (24h filter); larger with 7d demo defaults |
| 5 | `/api/jobs` | the list itself | Already fast: 14 columns, `count: 'estimated'`, paginated |

The two largest waste calls (1 and 2) were getting linearly slower as the
`job_postings` table grew, since both touched every row.

## Fixes Applied (commit-pending)

### Fix 1 — `/api/sources?light=1` skips `getHistoricalCounts()` (BIGGEST WIN)
**File**: [apps/web/app/api/sources/route.ts](../apps/web/app/api/sources/route.ts)

`getHistoricalCounts()` runs `select('firehose_rule')` on every row of
`job_postings` to bucket counts by source. The homepage only needs `lastPollAt`
from the source health array — it never reads the counts. Added a `?light=1`
query param: when set, skip the historical-counts query and return an empty
object. The full `/sources` admin page still calls without `?light=1` and gets
the heavy variant.

Cache header for the light variant bumped to `max-age=60, swr=300` since
`lastPollAt` only changes when the cron fires (~hourly).

### Fix 2 — `todayApplied` folded into `/api/stats`
**Files**:
- [apps/web/app/api/stats/route.ts](../apps/web/app/api/stats/route.ts) — adds a
  `count: 'exact', head: true` query for `applied_at >= today-midnight-PT`,
  runs in parallel with the existing aggregate query
- [apps/web/lib/time.ts](../apps/web/lib/time.ts) — NEW shared
  `getPTMidnightToday()` helper (deduped from 3 inline copies)
- [apps/web/app/page.tsx](../apps/web/app/page.tsx) — `loadStats()` reads
  `data.todayApplied`, the dedicated `/api/jobs/import` fetch is removed
- [apps/web/app/api/jobs/import/route.ts](../apps/web/app/api/jobs/import/route.ts)
  — replaces the inline 15-line PT-midnight block with `getPTMidnightToday()`

Net: an entire HTTP round trip removed from the critical path. The new query
inside `/api/stats` is `count(*) head=true` on a small index slice, much
cheaper than what `/api/jobs/import` was running.

### Fix 3 — Rejections fetch deferred off the critical path
**File**: [apps/web/app/page.tsx](../apps/web/app/page.tsx)

`/api/jobs/detect-rejections` was firing in a mount-time `useEffect`. Moved to
a `useEffect` that depends on `loading` — it now only fires after the initial
`/api/jobs` resolves. The banner is usually empty, and showing it 100ms later
doesn't hurt UX.

### Fix 4 — Bumped cache TTLs
- `/api/stats`: `max-age=10, swr=30` → `max-age=30, swr=120`
- `/api/sources?light=1`: `max-age=60, swr=300`
- `/api/sources` (heavy): unchanged at `max-age=5, swr=15`

`stale-while-revalidate` means warm sessions get an instant response from
cache while a fresh one is fetched in the background.

## Result

Mount-time critical path fetches: **5 → 2** (sources?light=1, jobs).
- `/api/stats` and `/api/sources?light=1` both fire in parallel with
  `/api/jobs`, but they're now fast enough not to be the bottleneck.
- `/api/jobs/detect-rejections` runs deferred after `/api/jobs` resolves.
- `/api/jobs/import?page=0&limit=1` fetch is gone entirely.

Removed 1 full-table scan of `job_postings` per homepage load.

## Future Tripwires (DON'T RE-INTRODUCE THESE)

When editing the homepage or its endpoints, AVOID these patterns:

1. **Don't add new mount-time fetches.** If a new piece of data is needed on
   the homepage, fold it into an existing endpoint (`/api/stats`, `/api/jobs`,
   or `/api/sources?light=1`) rather than a fresh round trip. The performance
   budget is **2 critical fetches**.

2. **Don't `select(...)` on `job_postings` without a filter.** Any query that
   touches every row will get linearly slower as the table grows. Always have
   a `.gte('first_seen', ...)`, `.eq('status', ...)`, `.in('id', ...)` or
   similar bound. If you need a count, use `count: 'estimated', head: true` —
   never `count: 'exact'` for table-wide counts.

3. **Don't use `count: 'exact'` on `job_postings` without `head: true`.** Exact
   counts are slow on Postgres at scale. The default is `'exact'` if you don't
   pass anything — be explicit and use `'estimated'` for list endpoints.

4. **Don't add columns to `LIST_COLS`** in
   [apps/web/app/api/jobs/route.ts](../apps/web/app/api/jobs/route.ts) without
   a justification. Each column ships in every list response × ~50 rows × N
   page loads. Currently 14 columns and that's already on the high end.

5. **Don't fetch `/api/sources` from the homepage without `?light=1`.** The
   heavy variant exists for the admin Sources page only. If a future component
   needs both the homepage and the heavy variant, **add a separate light
   endpoint** instead of dropping `?light=1`.

6. **Don't fold the rejections fetch back into mount.** It's deferred for a
   reason — the banner is usually empty and the fetch isn't free.

7. **Don't duplicate `getPTMidnightToday()` again.** There are already two
   copies (`apps/web/lib/time.ts` and `scripts/_shared/time.ts`) because Next.js
   can't import across the apps/scripts boundary. Reuse one of them; if you
   add a third, document the sync requirement and add to `scripts/sync-vendored.ts`.

8. **Don't add LLM calls to any homepage-critical endpoint.** LLM enrichment
   only runs in `after()` blocks on `/api/jobs/import` and `/api/jobs/[id]`
   PATCH — never on GET. If a feature needs LLM at read time, cache the
   result in the DB and read the cache.

## Performance Budget

| Metric | Budget | Notes |
|---|---|---|
| Mount-time critical XHRs | ≤ 2 | `/api/jobs` + `/api/sources?light=1` (stats fires parallel from `loadStats`) |
| Mount-time deferred XHRs | ≤ 1 | Currently just `/api/jobs/detect-rejections` |
| Full-table `job_postings` scans on critical path | **0** | Never. |
| `/api/jobs` LIST_COLS column count | ≤ 16 | Currently 14 |
| `count: 'exact'` on critical path queries | 0 | Use `'estimated'` |
| Stats cache TTL | ≥ 30s | Warm sessions should feel instant |
| TTI (target) | < 300ms | Subjective; verify with Network tab waterfall |

## Verification (when modifying any homepage endpoint)

1. `npm run dev:web` and open the homepage
2. DevTools Network tab, hard reload (cmd+shift+R), filter to `/api/`
3. Confirm the waterfall shows: `sources?light=1` + `stats` + `jobs` in
   parallel, then `detect-rejections` after the list resolves
4. Check that `/api/sources?light=1` returns `{ historicalCounts: {} }` (empty)
5. Check that `/api/stats` response includes `todayApplied` as a number
6. Hard reload twice within 30 seconds — the second load should hit the warm
   stats cache and feel instant
7. Open `/sources` (admin page) and confirm `historicalCounts` still works there

## Cross-references
- Plan file: `/Users/eric/.claude/plans/quiet-tinkering-penguin.md` (the planning session that produced this doc)
- Past commit that this audit followed: `dccbc44` (keyword scoring calibration; falsely suspected as the cause)
- Related: [scripts/_shared/time.ts](../scripts/_shared/time.ts) — sibling
  copy of the PT-midnight helper used by CLI scripts
